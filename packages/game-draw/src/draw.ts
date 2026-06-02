/**
 * 五张换牌扑克(Five-Card Draw)GameModule —— 核心 §7.3.3(S0..S8)。盲注;发 5 张暗牌;第一轮
 * 下注;换牌(DRAW);第二轮下注;以持有的 5 张牌进行摊牌(best-5,§5.3,
 * REQ-POKER-004)。
 *
 * 换牌阶段(REQ-FSM-004 / REQ-FSM-009):每个存活座位依次将其暗牌中选定的子集交还到一个死牌
 * 状态,且不揭示它们(部分弃牌),并从洗好的牌堆中尚未发出的部分发出相同数量的新暗牌。
 * 弃掉的牌永不揭示;替换牌仅向换牌者私下揭示。
 * 换牌的数量(COUNT)是公共对局信息;牌的身份(IDENTITIES)不是。换牌的
 * 超时默认动作是 STAND PAT —— 换零张(REQ-FSM-010):一个安全的默认动作,除了放弃提升手牌之外
 * 不放弃任何信息和任何权益。
 *
 * 换牌动作使用 Action.discard(指向座位 5 张手牌的槽位索引),kind:'draw';空操作的换牌
 * 表示为 kind:'stand'(或 kind:'draw' 且 discard 为空)。
 *
 * 确定性(P2 / REQ-ARCH-002):是 (ruleset, 注入的已记录牌堆, actions) 的纯函数;
 * 无随机性。牌堆是洗牌后的顺序(核心 §4);未发出的牌尾确定性地提供
 * 替换牌。每个可操作状态都有一个协作式后继和一个
 * 超时默认动作(P4):下注时为 check/fold,换牌时为 stand-pat。
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

const HAND_SIZE = 5;

// §7.3.3 阶段(S0..S8)。
export const PHASES = {
  BLINDS: 'S0_BLINDS',
  SHUFFLE: 'S1_SHUFFLE',
  DEAL: 'S2_DEAL',
  BET1: 'S3_BET1',
  DRAW: 'S4_DRAW',
  BET2: 'S5_BET2',
  SHOWDOWN: 'S6_SHOWDOWN',
  SETTLE: 'S7_SETTLE',
  HAND_END: 'S8_HAND_END',
  FOLD_END: 'FOLD_END',
  RECOVERY: 'RECOVERY',
} as const;

export interface DrawState extends GameState {
  readonly ctx: BettingCtx;
  readonly deck: readonly Card[];
  /** 每个座位的、引擎已知的 5 张手牌;在 UI 边界处隐藏。 */
  readonly hole: Readonly<Record<number, readonly Card[]>>;
  /** 每个座位的公共换牌数量(身份私有,数量公开 —— REQ-FSM-009)。 */
  readonly drawCounts: Readonly<Record<number, number>>;
  /** 牌堆中下一张未发出牌的索引(在发牌和每次重抽时前进)。 */
  readonly deckCursor: number;
  /** 当前在换牌阶段轮到行动的座位;在换牌阶段之外或所有人都已换牌后为 null。 */
  readonly drawToAct: number | null;
  readonly payouts: Payouts;
}

interface DrawConfig {
  /** 洗牌后的牌堆。必须覆盖发牌(5*seats)以及最坏情况下的重抽(最多 5*seats)。 */
  readonly deck: readonly Card[];
}

const BET_PHASES = new Set<string>([PHASES.BET1, PHASES.BET2]);

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

function freshState(base: DrawState, ctx: BettingCtx, phase: string): DrawState {
  return {
    ...base,
    ctx,
    phase,
    seats: projectSeats(ctx),
    betting: projectBetting(ctx),
  };
}

export type DrawModule = GameModule<DrawState> & { stateHash: (s: DrawState) => string };

export function createDraw(config: DrawConfig): DrawModule {
  const deck = config.deck;
  let rulesetRef: Ruleset | null = null;

  function init(ruleset: Ruleset, seatInits: SeatInit[]): DrawState {
    if (ruleset.variant !== 'draw') throw new Error('not a draw ruleset');
    if (seatInits.length < 2) throw new Error('need >= 2 seats');
    const need = HAND_SIZE * seatInits.length; // 发牌所需最小值;重抽需要更多牌尾
    if (deck.length < need) throw new Error(`deck too small: need ${need}, got ${deck.length}`);

    const order = [...seatInits].sort((a, b) => a.seat - b.seat);
    const buttonSeat = order[0]!.seat;
    const sb = buttonSeat;
    const bb = order[1 % order.length]!.seat;

    // 发 5 张暗牌,一次一张,从庄家开始(S2 DEAL)。
    const hole: Record<number, Card[]> = {};
    const drawCounts: Record<number, number> = {};
    for (const s of order) {
      hole[s.seat] = [];
      drawCounts[s.seat] = 0;
    }
    let p = 0;
    for (let k = 0; k < HAND_SIZE; k++) {
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
    ctx.toAct = sb; // 单挑:庄家/小盲在 BET1 中首先行动

    const base: DrawState = {
      rulesetHash: '',
      gid: '',
      phase: PHASES.BET1,
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
      drawCounts,
      deckCursor: HAND_SIZE * order.length, // 发牌后的第一张未发出牌
      drawToAct: null,
      payouts: [],
    };
    rulesetRef = ruleset;
    return base;
  }

  /** 换牌 / 翻牌后风格回合中首先行动的座位:庄家左侧(单挑中的非庄家)。 */
  function firstAfterButton(state: DrawState): number {
    return nonButton(state.ctx, state.buttonSeat);
  }

  /** 换牌时存活座位的顺序,从庄家左侧开始(REQ-FSM-009 行动顺序)。 */
  function drawOrder(state: DrawState): number[] {
    const order = seatOrder(state.ctx);
    const start = firstAfterButton(state);
    const idx = order.indexOf(start);
    const rotated = [...order.slice(idx), ...order.slice(0, idx)];
    const live = new Set(liveSeats(state.ctx));
    return rotated.filter((s) => live.has(s));
  }

  function autoAdvance(state: DrawState): DrawState {
    let s = state;
    for (;;) {
      if (liveSeats(s.ctx).length <= 1 && !s.handComplete) {
        s = freshState(s, s.ctx, PHASES.SETTLE);
        return settleState(s);
      }
      if (BET_PHASES.has(s.phase)) {
        if (!isRoundClosed(s.ctx)) return s;
        s = nextPhase(s);
        continue;
      }
      if (s.phase === PHASES.DRAW) {
        return s; // 等待换牌动作,由 applyDraw 推进
      }
      if (s.phase === PHASES.SHOWDOWN) {
        s = freshState(s, s.ctx, PHASES.SETTLE);
        return settleState(s);
      }
      return s;
    }
  }

  function nextPhase(state: DrawState): DrawState {
    switch (state.phase) {
      case PHASES.BET1: {
        // 开启换牌阶段:庄家左侧的第一个存活座位首先换牌。
        const live = drawOrder(state);
        return { ...freshState(state, state.ctx, PHASES.DRAW), drawToAct: live[0] ?? null };
      }
      case PHASES.BET2: {
        return freshState(state, state.ctx, PHASES.SHOWDOWN);
      }
      default:
        throw new Error(`nextPhase from ${state.phase}`);
    }
  }

  /** 换牌完成后开始 BET2:开启一个新回合,庄家左侧的第一个存活座位。 */
  function openBet2(state: DrawState): DrawState {
    const ctx = openRound(state.ctx, firstAfterButton(state), 'big');
    // 即使该座位已弃牌,openRound 也会将 toAct 设为 firstAfterButton;修正为第一个存活的行动者。
    const live = drawOrder(state);
    const first = live[0] ?? null;
    const fixed: BettingCtx = { ...ctx, toAct: first };
    return { ...freshState(state, fixed, PHASES.BET2), drawToAct: null };
  }

  function settleState(state: DrawState): DrawState {
    const pots: Pot[] = computePots(
      state.ctx.seats.map((s) => ({ seat: s.seat, contrib: s.committedThisHand, folded: s.folded })),
    );
    const order = seatOrder(state.ctx);
    const bIdx = order.indexOf(state.buttonSeat);
    const leftOfButton = [...order.slice(bIdx + 1), ...order.slice(0, bIdx + 1)];

    // 摊牌:以持有的 5 张牌取 best-5(每个座位恰好有 5 张,REQ-POKER-004)。
    const handValue = (seat: number) => bestHigh(state.hole[seat]!).value;
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
      if (pot.eligible.length === 1) {
        awards.set(pot.eligible[0]!, (awards.get(pot.eligible[0]!) ?? 0) + pot.amount);
        continue;
      }
      const a = awardPot(pot, cmp, leftOfButton);
      for (const [seat, amt] of a) awards.set(seat, (awards.get(seat) ?? 0) + amt);
    }

    const ctx: BettingCtx = {
      ...state.ctx,
      seats: state.ctx.seats.map((s) => ({ ...s, stack: s.stack + (awards.get(s.seat) ?? 0) })),
    };
    const payouts: Payouts = [...awards.entries()].map(([seat, amount]) => ({ seat, amount }));
    return { ...freshState(state, ctx, PHASES.HAND_END), pots, payouts, handComplete: true };
  }

  function getLegalActions(state: DrawState, seat: number): LegalActions {
    if (state.phase === PHASES.DRAW) {
      if (state.drawToAct !== seat) return { check: false, fold: false };
      return { check: false, fold: false, draw: true };
    }
    if (!BET_PHASES.has(state.phase)) return { check: false, fold: false };
    if (state.ctx.toAct !== seat) return { check: false, fold: false };
    return legalActions(state.ctx, rulesetRef!, seat);
  }

  /** 在换牌阶段为当前计时中的座位应用 draw/stand(REQ-FSM-004/009)。 */
  function applyDraw(state: DrawState, action: Action): DrawState {
    if (state.drawToAct !== action.seat) throw new Error(`not seat ${action.seat}'s draw`);
    const seat = action.seat;
    const slots = action.kind === 'stand' ? [] : [...(action.discard ?? [])];
    // 校验槽位索引:互不相同,且在 0..4 之内。
    const uniq = new Set(slots);
    if (uniq.size !== slots.length) throw new Error('duplicate discard slots');
    for (const i of slots) {
      if (!Number.isInteger(i) || i < 0 || i >= HAND_SIZE) throw new Error(`bad discard slot ${i}`);
    }
    if (slots.length > HAND_SIZE) throw new Error('cannot discard more than 5');

    // 将选定的槽位交还到死牌(不揭示),并从未发出的牌尾重抽。
    const current = state.hole[seat]!;
    const discardSet = new Set(slots);
    const kept: Card[] = current.filter((_, i) => !discardSet.has(i));
    let cursor = state.deckCursor;
    const drawn: Card[] = [];
    for (let k = 0; k < slots.length; k++) {
      if (cursor >= state.deck.length) throw new Error('deck exhausted on redraw');
      drawn.push(state.deck[cursor++]!);
    }
    const newHand = [...kept, ...drawn];

    const hole: Record<number, Card[]> = {};
    for (const s of seatOrder(state.ctx)) hole[s] = [...state.hole[s]!];
    hole[seat] = newHand;
    const drawCounts: Record<number, number> = { ...state.drawCounts, [seat]: slots.length };

    // 将 drawToAct 推进到下一个尚未换牌的存活座位。
    const orderLive = drawOrder(state);
    const idx = orderLive.indexOf(seat);
    const nextSeat = idx >= 0 && idx + 1 < orderLive.length ? orderLive[idx + 1]! : null;

    const advanced: DrawState = {
      ...state,
      hole,
      drawCounts,
      deckCursor: cursor,
      drawToAct: nextSeat,
    };
    if (nextSeat !== null) return advanced;
    // 所有存活座位都已换牌 → 开启第二轮下注。
    return autoAdvance(openBet2(advanced));
  }

  function apply(state: DrawState, action: Action): DrawState {
    if (state.phase === PHASES.DRAW) {
      if (action.kind !== 'draw' && action.kind !== 'stand') {
        throw new Error(`only draw/stand accepted in DRAW phase, got ${action.kind}`);
      }
      return applyDraw(state, action);
    }
    if (!BET_PHASES.has(state.phase)) {
      throw new Error(`no player action accepted in phase ${state.phase}`);
    }
    if (state.ctx.toAct !== action.seat) throw new Error(`not seat ${action.seat}'s turn`);
    const ctx = applyAction(state.ctx, rulesetRef!, action);
    const advanced = freshState(state, ctx, state.phase);
    return autoAdvance(advanced);
  }

  function isTimeoutEligible(state: DrawState, now: number): TimeoutResolution | null {
    void now;
    if (state.phase === PHASES.DRAW) {
      if (state.drawToAct === null) return null;
      // REQ-FSM-010:换牌的超时默认动作是 STAND PAT(换零张)。
      const seat = state.drawToAct;
      return { seat, defaultAction: { kind: 'stand', seat, amount: 0, discard: [] } };
    }
    if (!BET_PHASES.has(state.phase) || state.ctx.toAct === null) return null;
    const seat = state.ctx.toAct;
    const legal = legalActions(state.ctx, rulesetRef!, seat);
    const defaultAction: Action = legal.check
      ? { kind: 'check', seat, amount: 0 }
      : { kind: 'fold', seat, amount: 0 };
    return { seat, defaultAction };
  }

  function isHandComplete(state: DrawState): boolean {
    return state.handComplete;
  }

  function settle(state: DrawState): Payouts {
    return state.payouts;
  }

  function serialize(state: DrawState): Uint8Array {
    const w = new ByteWriter();
    w.str(state.phase);
    w.u32(state.handNumber);
    w.u8(state.buttonSeat);
    w.arr(state.seats, (ww, s) => {
      ww.u8(s.seat).u64(s.stack).u64(s.committedThisRound).u64(s.committedThisHand);
      ww.bool(s.folded).bool(s.allIn);
    });
    // 公共换牌数量(身份保持隐藏 —— REQ-FSM-009)。
    w.arr(
      seatOrder(state.ctx).map((seat) => ({ seat, n: state.drawCounts[seat] ?? 0 })),
      (ww, d) => ww.u8(d.seat).u8(d.n),
    );
    w.u64(state.betting.betToCall).u64(state.betting.lastFullRaise);
    w.bool(state.handComplete);
    return w.toBytes();
  }

  function stateHash(state: DrawState): string {
    return bytesToHex(sha256(serialize(state)));
  }

  const module: DrawModule = {
    id: 'draw',
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
