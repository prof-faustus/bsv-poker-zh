/**
 * 七张梭哈游戏模块 —— core §7.3.2 (S0..S9)。同时也是 Razz 的可复用内核
 *（§7.3.4, REQ-FSM-011），通过三个可注入的覆盖：bring-in 选择器、第三张牌后的
 * 行动顺序函数，以及摊牌评估器。
 *
 * 规则（高牌梭哈）：无公共牌，无盲注；每个座位下底注（ante）。牌分布在五个
 * 下注轮（"街"）中：
 *   - 第三街：2 张暗牌 + 1 张明牌（门牌）。最低的明牌进行 bring-in
 *     （平局时按固定的已声明强制下注花色顺序破平 —— 此处为 c<d<h<s —— 仅用于
 *     bring-in 选择，不用于手牌评估，参见 RT-01 m3）。小注级别。
 *   - 第四街：+1 张明牌。从此处起最高的明面牌型先行动（REQ-FSM-005 ——
 *     由明面驱动的顺序，一个独立的排序函数）。小注（明对 → 可任选，见
 *     TODO）。第五/六街：+1 张明牌，大注。第七街（"河牌"）：+1 张暗牌，大注。
 *   - 摊牌：7 张里选最佳 5 张（§5.3, REQ-POKER-004）。
 * 典型结构为固定限注（D3）；本模块接受 ruleset 指定的结构。
 *
 * 心智扑克原语（REQ-FSM-003）：暗牌仅向持有者私下揭示；明牌由 N-of-N 协作揭示
 * 立即公开。此处牌面为引擎已知，揭示自动推进；超时默认动作即恢复路径。
 *
 * 确定性（P2 / REQ-ARCH-002）：是 (ruleset, 注入的已记录牌堆, actions) 的纯函数；
 * 无随机性。每个可行动状态都有一个协作后继和一个过牌/弃牌超时默认动作（P4）。
 * bring-in 座位在第三街的超时默认动作是（较小的、强制的）bring-in 下注 ——
 * 绝不会是更大的强制下注（core §6.4）。
 *
 * REQ-FSM-008（8 人时牌堆耗尽）：8 个座位、每人 7 张（56）超过了 52 张的牌堆。
 * 若在能为每人单独发第七张牌之前牌堆将耗尽，则最后一张牌作为所有剩余玩家共用的
 * 单张共享明牌发出。本模块在 dealStreet 中实现该回退（见 `sharedRiver`）。
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
  cardSuit,
  compareRank,
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

// §7.3.2 阶段 (S0..S9)。下注街为第三..七街。
export const PHASES = {
  ANTE: 'S0_ANTE',
  SHUFFLE: 'S1_SHUFFLE',
  THIRD: 'S2_THIRD',
  FOURTH: 'S3_FOURTH',
  FIFTH: 'S4_FIFTH',
  SIXTH: 'S5_SIXTH',
  SEVENTH: 'S6_SEVENTH',
  SHOWDOWN: 'S7_SHOWDOWN',
  SETTLE: 'S8_SETTLE',
  HAND_END: 'S9_HAND_END',
  FOLD_END: 'FOLD_END',
  RECOVERY: 'RECOVERY',
} as const;

const STREET_PHASES = new Set<string>([
  PHASES.THIRD,
  PHASES.FOURTH,
  PHASES.FIFTH,
  PHASES.SIXTH,
  PHASES.SEVENTH,
]);

/** 每条街所发的牌哪些是明面（true = 明牌；false = 暗牌）。REQ-FSM-003。 */
const STREET_DEAL: { phase: string; up: boolean }[] = [
  { phase: PHASES.THIRD, up: false }, // 第三街：2 张暗牌 ...
  { phase: PHASES.THIRD, up: false },
  { phase: PHASES.THIRD, up: true }, // ... + 1 张明牌（门牌）
  { phase: PHASES.FOURTH, up: true },
  { phase: PHASES.FIFTH, up: true },
  { phase: PHASES.SIXTH, up: true },
  { phase: PHASES.SEVENTH, up: false }, // 第七街：1 张暗牌（河牌）
];

export interface StudState extends GameState {
  readonly ctx: BettingCtx;
  readonly deck: readonly Card[];
  /** 每个座位按发牌顺序排列的引擎已知牌；明/暗的划分由 `upCount` 跟踪。 */
  readonly hole: Readonly<Record<number, readonly Card[]>>;
  /** 每个座位前导的明面（公开）牌数。其后为暗牌。 */
  readonly cardsDealt: number; // 迄今每座位已发牌数（发牌游标的代理）
  readonly deckCursor: number;
  /** 共享的公共河牌（REQ-FSM-008 8 人耗尽）；若无则为 null。 */
  readonly sharedRiver: Card | null;
  readonly payouts: Payouts;
}

/** Razz 与 Stud 之间的三个覆盖点（REQ-FSM-011）。 */
export interface StudOverrides {
  readonly variant: 'stud' | 'razz';
  /** 从明牌中选出第三街的 bring-in 座位（stud：最低；razz：最高）。 */
  bringInSeat(upCards: ReadonlyMap<number, Card>): number;
  /** 在给定的在局座位上的第三街后行动顺序，最佳明面优先（stud：高牌；razz：低牌）。 */
  actingOrder(state: StudState, liveSeatsList: readonly number[]): number[];
  /** 在摊牌时比较两个座位（stud：最佳 5 张高牌；razz：A-to-5 低牌）。a 胜 b 时返回 +1。 */
  compareSeats(state: StudState, a: number, b: number): -1 | 0 | 1;
}

interface StudConfig {
  /** 洗牌后的牌堆。最多需要 7*座位数 张牌（采用共享河牌回退时可更少）。 */
  readonly deck: readonly Card[];
}

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

function freshState(base: StudState, ctx: BettingCtx, phase: string): StudState {
  return {
    ...base,
    ctx,
    phase,
    seats: projectSeats(ctx),
    betting: projectBetting(ctx),
  };
}

/**
 * 给定已发牌总数时，每个座位可见的明牌。第一张明牌是第三街发出的门牌
 *（发牌顺序中的索引 2）；后续明牌为第四/五/六街（索引 3,4,5）；河牌
 *（索引 6）为暗牌。若存在共享公共河牌则一并计入（REQ-FSM-008）。
 */
export function upCardsOf(state: StudState, seat: number): Card[] {
  const cards = state.hole[seat] ?? [];
  const out: Card[] = [];
  for (let i = 0; i < cards.length; i++) {
    const meta = STREET_DEAL[i];
    if (meta && meta.up) out.push(cards[i]!);
  }
  if (state.sharedRiver !== null) out.push(state.sharedRiver);
  return out;
}

/** 摊牌时某座位可用的全部 7 张牌（自己的牌 + 任何共享公共牌）。 */
export function allCardsOf(state: StudState, seat: number): Card[] {
  const own = [...(state.hole[seat] ?? [])];
  return state.sharedRiver !== null ? [...own, state.sharedRiver] : own;
}

/** 默认的 stud bring-in：按点数取最低的明牌，平局时按已声明的花色顺序（c<d<h<s）。 */
export function lowestUpCard(upCards: ReadonlyMap<number, Card>): number {
  let best: { seat: number; card: Card } | null = null;
  for (const [seat, card] of upCards) {
    if (
      best === null ||
      compareRank(card) < compareRank(best.card) ||
      (compareRank(card) === compareRank(best.card) && cardSuit(card) < cardSuit(best.card))
    ) {
      best = { seat, card };
    }
  }
  return best!.seat;
}

/**
 * 按部分（<5 张）明面所能构成的最高牌型对其排序：先按数量分组（三条 >
 * 对子 > 单张），再按点数降序。这使得在第四街成对的门牌排在更高的单张牌
 * 之前，符合真实 stud 的"最高明面牌"规则（REQ-FSM-005）。
 * 返回一个可比较数组，越大 = 明面越高。
 */
function partialHighKey(up: readonly Card[]): number[] {
  const vs = up.map(compareRank);
  const cnt = new Map<number, number>();
  for (const v of vs) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  // 按 (数量降序, 点数降序) 排序：[count0, rank0, count1, rank1, ...]
  const ordered = [...cnt.entries()].sort((p, q) => q[1] - p[1] || q[0] - p[0]);
  const key: number[] = [];
  for (const [rank, c] of ordered) {
    key.push(c, rank);
  }
  return key;
}

/** 默认的 stud 第三街后顺序：最高明面（按明牌中最佳 5 张高牌）先行动。 */
export function highestBoardFirst(state: StudState, live: readonly number[]): number[] {
  const score = (seat: number): { cat: number; tb: readonly number[] } => {
    const up = upCardsOf(state, seat);
    if (up.length === 0) return { cat: -1, tb: [] };
    if (up.length < 5) {
      // 部分明面：先按数量分组（对子/三条），再按高牌排序。
      return { cat: 0, tb: partialHighKey(up) };
    }
    const v = bestHigh(up).value;
    return { cat: v.category, tb: v.tiebreak };
  };
  const cmp = (a: number, b: number): number => {
    const sa = score(a);
    const sb = score(b);
    if (sa.cat !== sb.cat) return sb.cat - sa.cat; // 类别较高者在前
    const n = Math.max(sa.tb.length, sb.tb.length);
    for (let i = 0; i < n; i++) {
      const x = sa.tb[i] ?? 0;
      const y = sb.tb[i] ?? 0;
      if (x !== y) return y - x; // 较高者在前
    }
    return a - b; // 按座位的确定性破平（座位号小者在前）
  };
  return [...live].sort(cmp);
}

export type StudModule = GameModule<StudState> & { stateHash: (s: StudState) => string };

/** Stud 与 Razz 共用的工厂。传入三个覆盖（REQ-FSM-011）。 */
export function createStudCore(config: StudConfig, overrides: StudOverrides): StudModule {
  const deck = config.deck;
  let rulesetRef: Ruleset | null = null;

  /** 经由引擎开启一个下注轮，toAct 设为选定的座位（由明面驱动）。 */
  function openStreet(ctx: BettingCtx, firstToAct: number, level: 'small' | 'big'): BettingCtx {
    return openRound(ctx, firstToAct, level);
  }

  function init(ruleset: Ruleset, seatInits: SeatInit[]): StudState {
    if (ruleset.variant !== overrides.variant) {
      throw new Error(`not a ${overrides.variant} ruleset`);
    }
    if (seatInits.length < 2) throw new Error('need >= 2 seats');
    if (seatInits.length > 8) throw new Error('stud/razz max 8 seats (REQ-FSM-008)');

    const order = [...seatInits].sort((a, b) => a.seat - b.seat);
    const n = order.length;
    // 第三街最少需要每座位 3 张牌；其余按街逐一发出。
    if (deck.length < 3 * n) throw new Error(`deck too small: need >= ${3 * n}, got ${deck.length}`);

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
      betLevel: 'small',
    };

    // S0 ANTE：每个座位下底注（计入本手已投入；底注不产生需跟注额 —— core §A21.2）。
    const ante = ruleset.blinds.ante;
    for (const s of ctx.seats) {
      const amt = Math.min(ante, s.stack);
      s.stack -= amt;
      s.committedThisHand += amt;
      if (s.stack === 0) s.allIn = true;
    }

    // 发第三街：每座位 2 张暗牌 + 1 张明牌（发牌顺序：按座位轮转，按钮位优先）。
    const hole: Record<number, Card[]> = {};
    for (const s of order) hole[s.seat] = [];
    let cursor = 0;
    for (let k = 0; k < 3; k++) {
      for (const s of order) hole[s.seat]!.push(deck[cursor++]!);
    }

    const base0: StudState = {
      rulesetHash: '',
      gid: '',
      phase: PHASES.THIRD,
      handNumber: 0,
      buttonSeat: order[0]!.seat, // stud 没有按钮位；仅为奇数筹码排序而保留
      seats: projectSeats(ctx),
      board: [],
      betting: projectBetting(ctx),
      pots: [],
      handComplete: false,
      ctx,
      deck,
      hole,
      cardsDealt: 3,
      deckCursor: cursor,
      sharedRiver: null,
      payouts: [],
    };

    // Bring-in：最低明牌（stud）/ 最高明牌（razz）进行 bring-in（强制的部分下注）。
    const upMap = new Map<number, Card>();
    for (const s of order) upMap.set(s.seat, upCardsOf(base0, s.seat)[0]!);
    const bringInSeat = overrides.bringInSeat(upMap);

    const smallBet = bringInSmallBet(ruleset);
    const bringIn = ruleset.blinds.bringIn > 0 ? ruleset.blinds.bringIn : smallBet;
    const bi = ctx.seats.find((x) => x.seat === bringInSeat)!;
    const biAmt = Math.min(bringIn, bi.stack);
    bi.stack -= biAmt;
    bi.committedThisRound += biAmt;
    bi.committedThisHand += biAmt;
    bi.hasActedThisRound = false; // bring-in 仍需做出后续动作选择以完成
    if (bi.stack === 0) bi.allIn = true;
    ctx.betToCall = biAmt;
    // 补足到完整小注必须作为加注而合法；设置上一次完整加注的大小，使
    // minRaiseTo = bringIn + (smallBet - bringIn)？引擎使用 lastFullRaise 计算最小加注。
    // 设置 lastFullRaise，使补足到 smallBet 成为最小合法的加注至。
    ctx.lastFullRaise = smallBet - biAmt > 0 ? smallBet - biAmt : smallBet;
    ctx.lastAggressor = bringInSeat;
    ctx.betLevel = 'small';

    // 行动按座位顺序推进到 bring-in 之后的下一座位（第三街使用从 bring-in 开始的
    // 固定顺时针顺序；只有第三街之后才由明面驱动，REQ-FSM-005）。
    const so = seatOrder(ctx);
    const idx = so.indexOf(bringInSeat);
    ctx.toAct = so[(idx + 1) % so.length]!;

    rulesetRef = ruleset;
    return freshState(base0, ctx, PHASES.THIRD);
  }

  function bringInSmallBet(ruleset: Ruleset): number {
    if (ruleset.bettingStructure === 'FL' && ruleset.flSizing) return ruleset.flSizing.smallBet;
    return ruleset.blinds.bigBlind > 0 ? ruleset.blinds.bigBlind : ruleset.blinds.bringIn;
  }

  /** 为下一条街给每个在局座位各发一张牌（或一张共享河牌，REQ-FSM-008）。 */
  function dealNextStreet(state: StudState, nextPhase: string): StudState {
    const order = seatOrder(state.ctx);
    const live = liveSeats(state.ctx);
    const hole: Record<number, Card[]> = {};
    for (const s of order) hole[s] = [...state.hole[s]!];
    let cursor = state.deckCursor;
    let sharedRiver = state.sharedRiver;

    if (nextPhase === PHASES.SEVENTH && cursor + live.length > state.deck.length) {
      // REQ-FSM-008：牌不足以给每个在局座位发第 7 张牌 → 单张共享明牌。
      if (cursor >= state.deck.length) throw new Error('deck fully exhausted at 7th street');
      sharedRiver = state.deck[cursor++]!;
    } else {
      for (const seat of order) {
        if (state.ctx.seats.find((x) => x.seat === seat)!.folded) continue;
        if (cursor >= state.deck.length) throw new Error(`deck exhausted dealing ${nextPhase}`);
        hole[seat]!.push(state.deck[cursor++]!);
      }
    }
    return { ...state, hole, deckCursor: cursor, cardsDealt: state.cardsDealt + 1, sharedRiver };
  }

  function streetLevel(phase: string): 'small' | 'big' {
    return phase === PHASES.THIRD || phase === PHASES.FOURTH ? 'small' : 'big';
  }

  function autoAdvance(state: StudState): StudState {
    let s = state;
    for (;;) {
      if (liveSeats(s.ctx).length <= 1 && !s.handComplete) {
        s = freshState(s, s.ctx, PHASES.SETTLE);
        return settleState(s);
      }
      if (STREET_PHASES.has(s.phase)) {
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

  function nextStreet(state: StudState): StudState {
    const live = liveSeats(state.ctx);
    const transitions: Record<string, string> = {
      [PHASES.THIRD]: PHASES.FOURTH,
      [PHASES.FOURTH]: PHASES.FIFTH,
      [PHASES.FIFTH]: PHASES.SIXTH,
      [PHASES.SIXTH]: PHASES.SEVENTH,
      [PHASES.SEVENTH]: PHASES.SHOWDOWN,
    };
    const np = transitions[state.phase];
    if (!np) throw new Error(`nextStreet from ${state.phase}`);
    if (np === PHASES.SHOWDOWN) {
      return freshState(state, state.ctx, PHASES.SHOWDOWN);
    }
    // 发出下一条街的牌，然后开启一个由明面驱动的下注轮（REQ-FSM-005）。
    const dealt = dealNextStreet(state, np);
    const orderedLive = overrides.actingOrder(dealt, live);
    const firstToAct = orderedLive[0]!;
    const ctx = openStreet(dealt.ctx, firstToAct, streetLevel(np));
    return freshState(dealt, ctx, np);
  }

  function settleState(state: StudState): StudState {
    const pots: Pot[] = computePots(
      state.ctx.seats.map((s) => ({ seat: s.seat, contrib: s.committedThisHand, folded: s.folded })),
    );
    const order = seatOrder(state.ctx);
    const bIdx = order.indexOf(state.buttonSeat);
    const leftOfButton = [...order.slice(bIdx + 1), ...order.slice(0, bIdx + 1)];

    const cmp = (a: number, b: number): -1 | 0 | 1 => {
      const fa = state.ctx.seats.find((x) => x.seat === a)!.folded;
      const fb = state.ctx.seats.find((x) => x.seat === b)!.folded;
      if (fa && fb) return 0;
      if (fa) return -1;
      if (fb) return 1;
      return overrides.compareSeats(state, a, b);
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

  function getLegalActions(state: StudState, seat: number): LegalActions {
    if (!STREET_PHASES.has(state.phase)) return { check: false, fold: false };
    if (state.ctx.toAct !== seat) return { check: false, fold: false };
    return legalActions(state.ctx, rulesetRef!, seat);
  }

  function apply(state: StudState, action: Action): StudState {
    if (!STREET_PHASES.has(state.phase)) {
      throw new Error(`no player action accepted in phase ${state.phase}`);
    }
    if (state.ctx.toAct !== action.seat) throw new Error(`not seat ${action.seat}'s turn`);
    const ctx = applyAction(state.ctx, rulesetRef!, action);
    const advanced = freshState(state, ctx, state.phase);
    return autoAdvance(advanced);
  }

  function isTimeoutEligible(state: StudState, now: number): TimeoutResolution | null {
    void now;
    if (!STREET_PHASES.has(state.phase) || state.ctx.toAct === null) return null;
    const seat = state.ctx.toAct;
    const legal = legalActions(state.ctx, rulesetRef!, seat);
    // 安全默认：能过牌则过牌，否则弃牌 —— 绝不强制下注（core §6.4）。bring-in 的
    // 下注本身发生在 init，因此当某座位"轮到行动"时，过牌/弃牌默认始终成立。
    const defaultAction: Action = legal.check
      ? { kind: 'check', seat, amount: 0 }
      : { kind: 'fold', seat, amount: 0 };
    return { seat, defaultAction };
  }

  function isHandComplete(state: StudState): boolean {
    return state.handComplete;
  }

  function settle(state: StudState): Payouts {
    return state.payouts;
  }

  function serialize(state: StudState): Uint8Array {
    const w = new ByteWriter();
    w.str(state.phase);
    w.u32(state.handNumber);
    w.u8(state.cardsDealt);
    // 每座位的公开明牌（公开揭示的明面，REQ-FSM-003）；不含暗牌。
    w.arr(seatOrder(state.ctx), (ww, seat) => {
      const up = upCardsOf(state, seat);
      ww.u8(seat).arr(up, (x, c) => x.u8(c));
    });
    w.opt(state.sharedRiver === null ? undefined : state.sharedRiver, (ww, c) => ww.u8(c));
    w.arr(state.seats, (ww, s) => {
      ww.u8(s.seat).u64(s.stack).u64(s.committedThisRound).u64(s.committedThisHand);
      ww.bool(s.folded).bool(s.allIn);
    });
    w.u64(state.betting.betToCall).u64(state.betting.lastFullRaise);
    w.bool(state.handComplete);
    return w.toBytes();
  }

  function stateHash(state: StudState): string {
    return bytesToHex(sha256(serialize(state)));
  }

  const module: StudModule = {
    id: overrides.variant,
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

/** 七张梭哈（高牌）：最低明牌进行 bring-in；最高明面先行动；7 张里取最佳 5 张高牌。 */
export function createStud(config: StudConfig): StudModule {
  return createStudCore(config, {
    variant: 'stud',
    bringInSeat: (up) => lowestUpCard(up),
    actingOrder: (state, live) => highestBoardFirst(state, live),
    compareSeats: (state, a, b) =>
      compareHigh(bestHigh(allCardsOf(state, a)).value, bestHigh(allCardsOf(state, b)).value),
  });
}
