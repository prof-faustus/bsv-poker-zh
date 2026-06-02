/**
 * 德州扑克(Texas Hold'em)GameModule —— 核心 §7.2 以及 §19.E 转移表。第一阶段的参考实现是
 * regtest 上的单挑无限注(D1),但本模块可泛化到 2–9 座位的范围。
 *
 * 确定性(P2 / REQ-ARCH-002):本模块是 (ruleset, 注入的牌堆,
 * 下注动作) 的纯函数。牌堆是洗牌后的顺序 —— 一个已记录(RECORDED)来源(核心 §4);本
 * 模块从不采样随机性。牌面为引擎已知以便结算,但在 UI/托管边界处“隐藏”
 *(核心 §11.5);选择性揭示和 N-of-N 公共牌
 * 揭示由密码学/交易层添加(核心 §4.6,§6.6)。这里协作式揭示
 * 路径会自动推进;其超时默认动作由 isTimeoutEligible 报告(核心 §6.4)。
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
import { bestHigh, compareHigh } from '@bsv-poker/hand-eval';
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

// §19.E 阶段。
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

export interface HoldemState extends GameState {
  /** 内部下注上下文(权威来源;GameState.seats/betting 由它投影得出)。 */
  readonly ctx: BettingCtx;
  /** 注入的洗牌后牌堆(已记录来源)。 */
  readonly deck: readonly Card[];
  /** 每个座位编号的、引擎已知的底牌;在 UI 边界处隐藏。 */
  readonly hole: Readonly<Record<number, readonly Card[]>>;
  /** 在 SETTLE 阶段计算的奖励(每个座位的毛赢额)。 */
  readonly payouts: Payouts;
}

interface HoldemConfig {
  /** 洗牌后的牌堆(>= 2*seats + 5 张牌)。真实一手牌所必需。 */
  readonly deck: readonly Card[];
  /** 庄家座位在升序座位顺序中的索引(跨手轮转,§19.E S13)。 */
  readonly buttonIndex?: number;
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
    holeSlots: [], // 槽位记账位于密码学/交易层
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

/** 单挑:庄家 = 小盲在翻牌前首先行动;非庄家在翻牌后首先行动。 */
function seatOrder(ctx: BettingCtx): number[] {
  return ctx.seats.map((s) => s.seat).sort((a, b) => a - b);
}

function nonButton(ctx: BettingCtx, button: number): number {
  // 用于单挑 / 翻牌后庄家左侧第一个活跃座位。
  const order = seatOrder(ctx);
  const idx = order.indexOf(button);
  return order[(idx + 1) % order.length]!;
}

/** 在 `startSeat` 处或其顺时针之后的第一个未弃牌、非全下的座位。 */
function firstActiveFrom(ctx: BettingCtx, startSeat: number): number {
  const order = seatOrder(ctx);
  const start = order.indexOf(startSeat);
  for (let i = 0; i < order.length; i++) {
    const seat = order[(start + i) % order.length]!;
    const s = ctx.seats.find((x) => x.seat === seat)!;
    if (!s.folded && !s.allIn) return seat;
  }
  return startSeat;
}

function freshState(base: HoldemState, ctx: BettingCtx, phase: string): HoldemState {
  return {
    ...base,
    ctx,
    phase,
    seats: projectSeats(ctx),
    betting: projectBetting(ctx),
  };
}

export type HoldemModule = GameModule<HoldemState> & { stateHash: (s: HoldemState) => string };

export function createHoldem(config: HoldemConfig): HoldemModule {
  const deck = config.deck;

  function init(ruleset: Ruleset, seatInits: SeatInit[]): HoldemState {
    if (ruleset.variant !== 'holdem') throw new Error('not a holdem ruleset');
    if (seatInits.length < 2) throw new Error('need >= 2 seats');
    const need = 2 * seatInits.length + 5;
    if (deck.length < need) throw new Error(`deck too small: need ${need}, got ${deck.length}`);

    const order = [...seatInits].sort((a, b) => a.seat - b.seat);
    const seatNums = order.map((s) => s.seat);
    const N = order.length;
    const bIdx = config.buttonIndex ?? 0; // 庄家座位索引(跨手轮转,§19.E S13)
    const buttonSeat = seatNums[bIdx % N]!;
    // 单挑:庄家 = 小盲且在翻牌前首先行动。3 人以上:小盲 = 庄家左侧,枪口位(UTG)首先行动。
    const sbIdx = N === 2 ? bIdx : bIdx + 1;
    const bbIdx = N === 2 ? bIdx + 1 : bIdx + 2;
    const preflopFirstIdx = N === 2 ? bIdx : bIdx + 3;
    const sb = seatNums[sbIdx % N]!;
    const bb = seatNums[bbIdx % N]!;

    // 从注入的牌堆发底牌(一次一张,从庄家开始)。
    const hole: Record<number, Card[]> = {};
    for (const s of order) hole[s.seat] = [];
    let p = 0;
    for (let k = 0; k < 2; k++) {
      for (const s of order) hole[s.seat]!.push(deck[p++]!);
    }

    // 构建下注座位并下盲注。
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
    ctx.toAct = firstActiveFrom(ctx, seatNums[preflopFirstIdx % N]!);

    const rulesetHashHex = ''; // 在绑定真实 ruleset 哈希时由 SDK 填充
    const base: HoldemState = {
      rulesetHash: rulesetHashHex,
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
    // 将 ruleset 存储在闭包上供 apply() 使用
    rulesetRef = ruleset;
    return base;
  }

  // 捕获的 ruleset(模块实例只对应一个 ruleset;与一张牌桌匹配)。
  let rulesetRef: Ruleset | null = null;

  /** 底牌之后,公共牌在牌堆中的索引。 */
  function boardSlots(state: HoldemState): { flop: Card[]; turn: Card; river: Card } {
    const n = state.ctx.seats.length;
    const start = 2 * n;
    return {
      flop: [state.deck[start]!, state.deck[start + 1]!, state.deck[start + 2]!],
      turn: state.deck[start + 3]!,
      river: state.deck[start + 4]!,
    };
  }

  /** 推进经过揭示/摊牌/结算,直到下一个等待玩家动作的状态。 */
  function autoAdvance(state: HoldemState): HoldemState {
    let s = state;
    for (;;) {
      // 弃牌结束:只剩一个存活玩家 → 无争议地授予(不揭示)。
      if (liveSeats(s.ctx).length <= 1 && !s.handComplete) {
        s = freshState(s, s.ctx, PHASES.SETTLE);
        return settleState(s);
      }
      if (BET_PHASES.has(s.phase)) {
        if (!isRoundClosed(s.ctx)) return s; // 等待动作
        s = nextStreet(s); // 回合结束 → 揭示 + 开启下一轮下注(或摊牌)
        continue;
      }
      if (s.phase === PHASES.SHOWDOWN) {
        s = freshState(s, s.ctx, PHASES.SETTLE);
        return settleState(s);
      }
      return s;
    }
  }

  function nextStreet(state: HoldemState): HoldemState {
    const { flop, turn, river } = boardSlots(state);
    const firstPost = firstActiveFrom(state.ctx, nonButton(state.ctx, state.buttonSeat));
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

  function settleState(state: HoldemState): HoldemState {
    const live = liveSeats(state.ctx);
    const pots: Pot[] = computePots(
      state.ctx.seats.map((s) => ({ seat: s.seat, contrib: s.committedThisHand, folded: s.folded })),
    );
    // 用于奇数筹码规则的庄家左侧座位顺序。
    const order = seatOrder(state.ctx);
    const bIdx = order.indexOf(state.buttonSeat);
    const leftOfButton = [...order.slice(bIdx + 1), ...order.slice(0, bIdx + 1)];

    // 按最佳 5 张高牌手牌(底牌 + 公共牌)比较座位的比较器。已弃牌的座位判负。
    const handValue = (seat: number) => bestHigh([...state.hole[seat]!, ...state.board]).value;
    const cmp = (a: number, b: number): -1 | 0 | 1 => {
      const fa = state.ctx.seats.find((x) => x.seat === a)!.folded;
      const fb = state.ctx.seats.find((x) => x.seat === b)!.folded;
      if (fa && fb) return 0;
      if (fa) return -1;
      if (fb) return 1;
      return compareHigh(handValue(a), handValue(b));
    };

    const awards = new Map<number, number>();
    for (const pot of pots) {
      // 无争议的弃牌结束:公共牌可能为空;若只剩一个存活座位,直接授予。
      if (pot.eligible.length === 1) {
        awards.set(pot.eligible[0]!, (awards.get(pot.eligible[0]!) ?? 0) + pot.amount);
        continue;
      }
      const a = awardPot(pot, cmp, leftOfButton);
      for (const [seat, amt] of a) awards.set(seat, (awards.get(seat) ?? 0) + amt);
    }

    // 将奖励应用到筹码量上。
    const ctx: BettingCtx = {
      ...state.ctx,
      seats: state.ctx.seats.map((s) => ({
        ...s,
        stack: s.stack + (awards.get(s.seat) ?? 0),
      })),
    };
    const payouts: Payouts = [...awards.entries()].map(([seat, amount]) => ({ seat, amount }));
    void live;
    return {
      ...freshState(state, ctx, PHASES.HAND_END),
      pots,
      payouts,
      handComplete: true,
    };
  }

  function getLegalActions(state: HoldemState, seat: number): LegalActions {
    if (!BET_PHASES.has(state.phase)) return { check: false, fold: false };
    if (state.ctx.toAct !== seat) return { check: false, fold: false };
    return legalActions(state.ctx, rulesetRef!, seat);
  }

  function apply(state: HoldemState, action: Action): HoldemState {
    if (!BET_PHASES.has(state.phase)) {
      throw new Error(`no player action accepted in phase ${state.phase}`);
    }
    if (state.ctx.toAct !== action.seat) throw new Error(`not seat ${action.seat}'s turn`);
    const ctx = applyAction(state.ctx, rulesetRef!, action);
    const advanced = freshState(state, ctx, state.phase);
    return autoAdvance(advanced);
  }

  function isTimeoutEligible(state: HoldemState, now: number): TimeoutResolution | null {
    void now; // “now”是锚定的高度/时间(核心 §6.4);调用方仅在成熟后才应用。
    if (!BET_PHASES.has(state.phase) || state.ctx.toAct === null) return null;
    const seat = state.ctx.toAct;
    const legal = legalActions(state.ctx, rulesetRef!, seat);
    // 安全默认动作:合法则看牌,否则弃牌 —— 绝不强制下注(核心 §6.4)。
    const defaultAction: Action = legal.check
      ? { kind: 'check', seat, amount: 0 }
      : { kind: 'fold', seat, amount: 0 };
    return { seat, defaultAction };
  }

  function isHandComplete(state: HoldemState): boolean {
    return state.handComplete;
  }

  function settle(state: HoldemState): Payouts {
    return state.payouts;
  }

  function serialize(state: HoldemState): Uint8Array {
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

  /** 公共状态的稳定哈希(用于分支绑定 / 重放等价性,核心 §6.3)。 */
  function stateHash(state: HoldemState): string {
    return bytesToHex(sha256(serialize(state)));
  }

  const module: HoldemModule = {
    id: 'holdem',
    init,
    getLegalActions,
    apply,
    isTimeoutEligible,
    isHandComplete,
    settle,
    serialize,
    stateHash, // 暴露以用于分支绑定 / 重放等价性
  };
  return module;
}
