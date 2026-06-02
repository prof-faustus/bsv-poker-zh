/**
 * 奥马哈 / 底池限注奥马哈(Pot-Limit Omaha)GameModule —— 核心 §7.3.1,REQ-FSM-006。
 *
 * 奥马哈就是德州扑克的状态机(§19.E),仅有两处重写(REQ-FSM-006):
 *   (i)  DEAL_HOLE 给每个座位发四张暗牌(而非两张);
 *   (ii) SHOWDOWN 使用奥马哈约束求值器进行评估 —— 恰好用 4 张底牌中的 2 张 + 恰好用
 *        5 张公共牌中的 3 张(§5.3.2,REQ-POKER-005)。通用的 best-of-7 对奥马哈来说
 *        可证明是错误的(§19.D),因此本模块的摊牌经由 `bestOmaha`。
 * 其余一切 —— 翻牌前/翻牌/转牌/河牌各街、3-1-1 的公共牌、边池、
 * 两出口超时默认动作规则(P4) —— 都与德州扑克相同。
 *
 * 确定性(P2 / REQ-ARCH-002):是 (ruleset, 注入的已记录牌堆, actions) 的纯函数;
 * 无随机性。牌堆是洗牌后的顺序(核心 §4)。牌面为引擎已知以便
 * 结算,但在 UI 边界处隐藏;协作式揭示会自动推进,其
 * 超时默认动作由 isTimeoutEligible 报告(核心 §6.4)。
 *
 * 常见结构是底池限注(PLO);本模块原样接受 ruleset 的结构(NL/PL/FL,
 * D3)—— 下注机已经实现了全部三种。
 *
 * 奥马哈高低牌(Omaha-8,REQ-FSM-007)—— ace-to-five 八或更好的低牌平分 —— 是一条
 * 独立的、有测试向量的路径,除非设置了 `ruleset.hiLo`,否则此处不实现;参见
 * 下方 SHOWDOWN 处的 TODO。hand-eval 包已经为此暴露了 `bestOmaha8Low`。
 */

import {
  type Action,
  type BettingState,
  type Card,
  type GameState,
  type LegalActions,
  type Payouts,
  type Pot,
  type Ruleset,
  type SeatState,
  ByteWriter,
  bytesToHex,
  sha256,
} from '@bsv-poker/protocol-types';
import { bestOmaha, compareHigh, bestOmaha8Low, compareLow } from '@bsv-poker/hand-eval';
import {
  type BettingCtx,
  type BettingSeat,
  type GameModule,
  type SeatInit,
  type TimeoutResolution,
  applyAction,
  computePots,
  awardPot,
  isRoundClosed,
  legalActions,
  openRound,
} from '@bsv-poker/engine';

/** 每个座位的暗底牌数量 —— 奥马哈的第一处重写(REQ-FSM-006)。 */
const HOLE_CARDS = 4;

// §19.E 阶段(与德州扑克图相同)。
export const PHASES = {
  TABLE_LOCKED: 'S0_TABLE_LOCKED',
  POST_BLINDS: 'S1_POST_BLINDS',
  SHUFFLE: 'S2_SHUFFLE',
  DEAL_HOLE: 'S3_DEAL_HOLE',
  BET_PREFLOP: 'S4_BET_PREFLOP',
  REVEAL_FLOP: 'S5_REVEAL_FLOP',
  BET_FLOP: 'S6_BET_FLOP',
  REVEAL_TURN: 'S7_REVEAL_TURN',
  BET_TURN: 'S8_BET_TURN',
  REVEAL_RIVER: 'S9_REVEAL_RIVER',
  BET_RIVER: 'S10_BET_RIVER',
  SHOWDOWN: 'S11_SHOWDOWN',
  SETTLE: 'S12_SETTLE',
  HAND_END: 'S13_HAND_END',
  FOLD_END: 'FOLD_END',
  RECOVERY: 'RECOVERY',
} as const;

export interface OmahaState extends GameState {
  readonly ctx: BettingCtx;
  readonly deck: readonly Card[];
  /** 每个座位编号的、引擎已知的底牌(各 4 张);在 UI 边界处隐藏。 */
  readonly hole: Readonly<Record<number, readonly Card[]>>;
  readonly payouts: Payouts;
}

interface OmahaConfig {
  /** 洗牌后的牌堆(>= 4*seats + 5 张牌)。真实一手牌所必需。 */
  readonly deck: readonly Card[];
}

const BET_PHASES = new Set<string>([
  PHASES.BET_PREFLOP,
  PHASES.BET_FLOP,
  PHASES.BET_TURN,
  PHASES.BET_RIVER,
]);

function projectSeats(ctx: BettingCtx): SeatState[] {
  return ctx.seats.map((s) => ({
    seat: s.seat,
    stack: s.stack,
    committedThisRound: s.committedThisRound,
    committedThisHand: s.committedThisHand,
    folded: s.folded,
    allIn: s.allIn,
    hasActedThisRound: s.hasActedThisRound,
    holeSlots: [],
  }));
}

function projectBetting(ctx: BettingCtx): BettingState {
  return {
    betToCall: ctx.betToCall,
    lastFullRaise: ctx.lastFullRaise,
    toAct: ctx.toAct,
    lastAggressor: ctx.lastAggressor,
    raisesThisStreet: ctx.raisesThisStreet,
  };
}

function liveSeats(ctx: BettingCtx): number[] {
  return ctx.seats.filter((s) => !s.folded).map((s) => s.seat);
}

function seatOrder(ctx: BettingCtx): number[] {
  return ctx.seats.map((s) => s.seat).sort((a, b) => a - b);
}

function nonButton(ctx: BettingCtx, button: number): number {
  const order = seatOrder(ctx);
  const idx = order.indexOf(button);
  return order[(idx + 1) % order.length]!;
}

function freshState(base: OmahaState, ctx: BettingCtx, phase: string): OmahaState {
  return {
    ...base,
    ctx,
    phase,
    seats: projectSeats(ctx),
    betting: projectBetting(ctx),
  };
}

export type OmahaModule = GameModule<OmahaState> & { stateHash: (s: OmahaState) => string };

export function createOmaha(config: OmahaConfig): OmahaModule {
  const deck = config.deck;
  let rulesetRef: Ruleset | null = null;

  function init(ruleset: Ruleset, seatInits: SeatInit[]): OmahaState {
    if (ruleset.variant !== 'omaha') throw new Error('not an omaha ruleset');
    if (seatInits.length < 2) throw new Error('need >= 2 seats');
    // 重写 (i):每个座位四张暗牌,然后是 5 张公共牌。
    const need = HOLE_CARDS * seatInits.length + 5;
    if (deck.length < need) throw new Error(`deck too small: need ${need}, got ${deck.length}`);

    const order = [...seatInits].sort((a, b) => a.seat - b.seat);
    const buttonSeat = order[0]!.seat; // 第一阶段:庄家位于最小座位
    const sb = buttonSeat;
    const bb = order[1 % order.length]!.seat;

    // 从注入的牌堆发底牌,一次一张,从庄家开始(4 轮)。
    const hole: Record<number, Card[]> = {};
    for (const s of order) hole[s.seat] = [];
    let p = 0;
    for (let k = 0; k < HOLE_CARDS; k++) {
      for (const s of order) hole[s.seat]!.push(deck[p++]!);
    }

    const bseats: BettingSeat[] = order.map((s) => ({
      seat: s.seat,
      stack: s.stack,
      committedThisRound: 0,
      committedThisHand: 0,
      folded: false,
      allIn: false,
      hasActedThisRound: false,
      mayRaise: true,
    }));
    const ctx: BettingCtx = {
      seats: bseats,
      betToCall: 0,
      lastFullRaise: 0,
      toAct: null,
      lastAggressor: null,
      raisesThisStreet: 0,
      betLevel: 'big',
    };
    const post = (seat: number, amount: number): void => {
      const s = ctx.seats.find((x) => x.seat === seat)!;
      const amt = Math.min(amount, s.stack);
      s.stack -= amt;
      s.committedThisRound += amt;
      s.committedThisHand += amt;
      if (s.stack === 0) s.allIn = true;
    };
    post(sb, ruleset.blinds.smallBlind);
    post(bb, ruleset.blinds.bigBlind);
    ctx.betToCall = ruleset.blinds.bigBlind;
    ctx.lastFullRaise = ruleset.blinds.bigBlind;
    ctx.lastAggressor = bb;
    ctx.toAct = sb; // 单挑:庄家/小盲在翻牌前首先行动

    const base: OmahaState = {
      rulesetHash: '',
      gid: '',
      phase: PHASES.BET_PREFLOP,
      handNumber: 0,
      buttonSeat,
      seats: projectSeats(ctx),
      board: [],
      betting: projectBetting(ctx),
      pots: [],
      handComplete: false,
      ctx,
      deck,
      hole,
      payouts: [],
    };
    rulesetRef = ruleset;
    return base;
  }

  /** 每座位 4 张底牌之后,公共牌在牌堆中的索引。 */
  function boardSlots(state: OmahaState): { flop: Card[]; turn: Card; river: Card } {
    const n = state.ctx.seats.length;
    const start = HOLE_CARDS * n;
    return {
      flop: [state.deck[start]!, state.deck[start + 1]!, state.deck[start + 2]!],
      turn: state.deck[start + 3]!,
      river: state.deck[start + 4]!,
    };
  }

  function autoAdvance(state: OmahaState): OmahaState {
    let s = state;
    for (;;) {
      if (liveSeats(s.ctx).length <= 1 && !s.handComplete) {
        s = freshState(s, s.ctx, PHASES.SETTLE);
        return settleState(s);
      }
      if (BET_PHASES.has(s.phase)) {
        if (!isRoundClosed(s.ctx)) return s;
        s = nextStreet(s);
        continue;
      }
      if (s.phase === PHASES.SHOWDOWN) {
        s = freshState(s, s.ctx, PHASES.SETTLE);
        return settleState(s);
      }
      return s;
    }
  }

  function nextStreet(state: OmahaState): OmahaState {
    const { flop, turn, river } = boardSlots(state);
    const firstPost = nonButton(state.ctx, state.buttonSeat);
    switch (state.phase) {
      case PHASES.BET_PREFLOP: {
        const board = [...flop];
        const ctx = openRound(state.ctx, firstPost, 'big');
        return { ...freshState(state, ctx, PHASES.BET_FLOP), board };
      }
      case PHASES.BET_FLOP: {
        const board = [...state.board, turn];
        const ctx = openRound(state.ctx, firstPost, 'big');
        return { ...freshState(state, ctx, PHASES.BET_TURN), board };
      }
      case PHASES.BET_TURN: {
        const board = [...state.board, river];
        const ctx = openRound(state.ctx, firstPost, 'big');
        return { ...freshState(state, ctx, PHASES.BET_RIVER), board };
      }
      case PHASES.BET_RIVER: {
        return freshState(state, state.ctx, PHASES.SHOWDOWN);
      }
      default:
        throw new Error(`nextStreet from non-betting phase ${state.phase}`);
    }
  }

  function settleState(state: OmahaState): OmahaState {
    const pots: Pot[] = computePots(
      state.ctx.seats.map((s) => ({ seat: s.seat, contrib: s.committedThisHand, folded: s.folded })),
    );
    const order = seatOrder(state.ctx);
    const bIdx = order.indexOf(state.buttonSeat);
    const leftOfButton = [...order.slice(bIdx + 1), ...order.slice(0, bIdx + 1)];

    // 重写 (ii):奥马哈约束的摊牌 —— 恰好 2 张底牌 + 3 张公共牌(REQ-POKER-005)。
    const folded = (s: number): boolean => state.ctx.seats.find((x) => x.seat === s)!.folded;
    const handValue = (seat: number) => bestOmaha(state.hole[seat]!, state.board).value;
    const cmpHigh = (a: number, b: number): -1 | 0 | 1 => {
      if (folded(a) && folded(b)) return 0;
      if (folded(a)) return -1;
      if (folded(b)) return 1;
      return compareHigh(handValue(a), handValue(b));
    };

    // 奥马哈高低牌(Omaha-8,REQ-FSM-007):平分每个底池 —— 高的一半归最佳高牌;低的一半
    // 归最佳合格的八或更好低牌(bestOmaha8Low);无合格低牌 ⇒ 高牌通吃。
    const lowOf = (seat: number) =>
      folded(seat) ? null : bestOmaha8Low(state.hole[seat]!, state.board);
    const cmpLow = (a: number, b: number): -1 | 0 | 1 => {
      const la = lowOf(a);
      const lb = lowOf(b);
      if (!la && !lb) return 0;
      if (!la) return -1; // a 无合格低牌 → 输掉低牌
      if (!lb) return 1;
      const c = compareLow(la.value, lb.value); // 越低越好
      return c === 0 ? 0 : c < 0 ? 1 : -1;
    };

    const awards = new Map<number, number>();
    const add = (seat: number, amt: number): void => {
      awards.set(seat, (awards.get(seat) ?? 0) + amt);
    };
    for (const pot of pots) {
      if (pot.eligible.length === 1) {
        add(pot.eligible[0]!, pot.amount);
        continue;
      }
      if (!rulesetRef!.hiLo) {
        for (const [s, amt] of awardPot(pot, cmpHigh, leftOfButton)) add(s, amt);
        continue;
      }
      // 高低牌:平分。奇数筹码归高的一半(惯例)。
      const anyLow = pot.eligible.some((s) => lowOf(s) !== null);
      if (!anyLow) {
        for (const [s, amt] of awardPot(pot, cmpHigh, leftOfButton)) add(s, amt); // 高牌通吃
        continue;
      }
      const lowHalf = Math.floor(pot.amount / 2);
      const highHalf = pot.amount - lowHalf;
      for (const [s, amt] of awardPot({ amount: highHalf, eligible: pot.eligible }, cmpHigh, leftOfButton)) add(s, amt);
      for (const [s, amt] of awardPot({ amount: lowHalf, eligible: pot.eligible }, cmpLow, leftOfButton)) add(s, amt);
    }

    const ctx: BettingCtx = {
      ...state.ctx,
      seats: state.ctx.seats.map((s) => ({ ...s, stack: s.stack + (awards.get(s.seat) ?? 0) })),
    };
    const payouts: Payouts = [...awards.entries()].map(([seat, amount]) => ({ seat, amount }));
    return { ...freshState(state, ctx, PHASES.HAND_END), pots, payouts, handComplete: true };
  }

  function getLegalActions(state: OmahaState, seat: number): LegalActions {
    if (!BET_PHASES.has(state.phase)) return { check: false, fold: false };
    if (state.ctx.toAct !== seat) return { check: false, fold: false };
    return legalActions(state.ctx, rulesetRef!, seat);
  }

  function apply(state: OmahaState, action: Action): OmahaState {
    if (!BET_PHASES.has(state.phase)) {
      throw new Error(`no player action accepted in phase ${state.phase}`);
    }
    if (state.ctx.toAct !== action.seat) throw new Error(`not seat ${action.seat}'s turn`);
    const ctx = applyAction(state.ctx, rulesetRef!, action);
    const advanced = freshState(state, ctx, state.phase);
    return autoAdvance(advanced);
  }

  function isTimeoutEligible(state: OmahaState, now: number): TimeoutResolution | null {
    void now;
    if (!BET_PHASES.has(state.phase) || state.ctx.toAct === null) return null;
    const seat = state.ctx.toAct;
    const legal = legalActions(state.ctx, rulesetRef!, seat);
    const defaultAction: Action = legal.check
      ? { kind: 'check', seat, amount: 0 }
      : { kind: 'fold', seat, amount: 0 };
    return { seat, defaultAction };
  }

  function isHandComplete(state: OmahaState): boolean {
    return state.handComplete;
  }

  function settle(state: OmahaState): Payouts {
    return state.payouts;
  }

  function serialize(state: OmahaState): Uint8Array {
    const w = new ByteWriter();
    w.str(state.phase);
    w.u32(state.handNumber);
    w.u8(state.buttonSeat);
    w.arr(state.board, (ww, c) => ww.u8(c));
    w.arr(state.seats, (ww, s) => {
      ww.u8(s.seat).u64(s.stack).u64(s.committedThisRound).u64(s.committedThisHand);
      ww.bool(s.folded).bool(s.allIn);
    });
    w.u64(state.betting.betToCall).u64(state.betting.lastFullRaise);
    w.bool(state.handComplete);
    return w.toBytes();
  }

  function stateHash(state: OmahaState): string {
    return bytesToHex(sha256(serialize(state)));
  }

  const module: OmahaModule = {
    id: 'omaha',
    init,
    getLegalActions,
    apply,
    isTimeoutEligible,
    isHandComplete,
    settle,
    serialize,
    stateHash,
  };
  return module;
}
