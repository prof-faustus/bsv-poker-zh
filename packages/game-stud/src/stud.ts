/**
 * Seven-Card Stud GameModule — core §7.3.2 (S0..S9). Also the reusable CORE for Razz
 * (§7.3.4, REQ-FSM-011) via three injectable overrides: the bring-in selector, the post-3rd
 * acting-order function, and the showdown evaluator.
 *
 * Rules (stud-high): no community cards, no blinds; every seat antes. Cards across five
 * betting rounds ("streets"):
 *   - 3rd street: 2 down + 1 up (the door card). The LOWEST up-card posts the bring-in
 *     (ties broken by a fixed declared forced-bet suit order — c<d<h<s here — used ONLY for
 *     the bring-in selection, NOT hand evaluation, cf. RT-01 m3). Small-bet level.
 *   - 4th street: +1 up. From here the HIGHEST exposed board hand acts FIRST (REQ-FSM-005 —
 *     board-driven order, a distinct ordering function). Small bet (open-pair → either, see
 *     TODO). 5th/6th: +1 up, big bet. 7th ("river"): +1 down, big bet.
 *   - Showdown: best 5 of 7 (§5.3, REQ-POKER-004).
 * Typical structure is Fixed-Limit (D3); the module accepts the ruleset's structure.
 *
 * Mental-poker primitives (REQ-FSM-003): down-cards are private-revealed to the holder; up-cards
 * are immediately publicly revealed by an N-of-N cooperative reveal. Here faces are
 * engine-known and the reveal auto-advances; the timeout-default is the recovery path.
 *
 * Determinism (P2 / REQ-ARCH-002): pure function of (ruleset, injected recorded deck, actions);
 * no randomness. Every actionable state has a cooperative successor and a check/fold
 * timeout-default (P4). The bring-in seat's 3rd-street timeout-default is the (smaller, forced)
 * bring-in post — never a larger forced wager (core §6.4).
 *
 * REQ-FSM-008 (8-handed deck exhaustion): with 8 seats, 7 cards each (56) exceeds the 52-card
 * deck. If the deck would be exhausted before 7th street can be dealt individually, the final
 * card is dealt as a SINGLE SHARED community up-card used by all remaining players. This module
 * implements that fallback in dealStreet (see `sharedRiver`).
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

// §7.3.2 phases (S0..S9). Betting streets 3rd..7th.
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

/** Which dealt cards are face-up per street (true = up-card; false = down-card). REQ-FSM-003. */
const STREET_DEAL: { phase: string; up: boolean }[] = [
  { phase: PHASES.THIRD, up: false }, // 3rd: 2 down ...
  { phase: PHASES.THIRD, up: false },
  { phase: PHASES.THIRD, up: true }, // ... + 1 up (door)
  { phase: PHASES.FOURTH, up: true },
  { phase: PHASES.FIFTH, up: true },
  { phase: PHASES.SIXTH, up: true },
  { phase: PHASES.SEVENTH, up: false }, // 7th: 1 down (river)
];

export interface StudState extends GameState {
  readonly ctx: BettingCtx;
  readonly deck: readonly Card[];
  /** Engine-known cards per seat in deal order; up/down split tracked by `upCount`. */
  readonly hole: Readonly<Record<number, readonly Card[]>>;
  /** Number of leading cards per seat that are face-up (public). Down cards follow. */
  readonly cardsDealt: number; // count of cards dealt per seat so far (deal cursor proxy)
  readonly deckCursor: number;
  /** Shared community river card (REQ-FSM-008 8-handed exhaustion); null if none. */
  readonly sharedRiver: Card | null;
  readonly payouts: Payouts;
}

/** The three Razz-vs-Stud override points (REQ-FSM-011). */
export interface StudOverrides {
  readonly variant: 'stud' | 'razz';
  /** Pick the 3rd-street bring-in seat from up-cards (stud: lowest; razz: highest). */
  bringInSeat(upCards: ReadonlyMap<number, Card>): number;
  /** Post-3rd acting order over the given live seats, best-board first (stud: high; razz: low). */
  actingOrder(state: StudState, liveSeatsList: readonly number[]): number[];
  /** Compare two seats at showdown (stud: best-5 high; razz: ace-to-five low). +1 if a beats b. */
  compareSeats(state: StudState, a: number, b: number): -1 | 0 | 1;
}

interface StudConfig {
  /** Post-shuffle deck. Needs up to 7*seats cards (or fewer with the shared-river fallback). */
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
 * Up-cards visible per seat for a given total dealt count. The first up-card is the door card
 * dealt 3rd (index 2 in deal order); subsequent up-cards are 4th/5th/6th (indices 3,4,5); the
 * river (index 6) is down. Plus the shared community river if present (REQ-FSM-008).
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

/** All 7 cards available to a seat at showdown (its own cards + any shared community card). */
export function allCardsOf(state: StudState, seat: number): Card[] {
  const own = [...(state.hole[seat] ?? [])];
  return state.sharedRiver !== null ? [...own, state.sharedRiver] : own;
}

/** Default stud bring-in: LOWEST up-card by rank, ties by declared suit order (c<d<h<s). */
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
 * Rank a partial (<5) exposed board by its highest poker holding: count groups first (trips >
 * pair > singles), then by descending ranks. This makes a paired door act ahead of a higher
 * single card on 4th street, matching real stud's "highest exposed board" (REQ-FSM-005).
 * Returns a comparable array, larger = higher board.
 */
function partialHighKey(up: readonly Card[]): number[] {
  const vs = up.map(compareRank);
  const cnt = new Map<number, number>();
  for (const v of vs) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  // order by (count desc, rank desc): [count0, rank0, count1, rank1, ...]
  const ordered = [...cnt.entries()].sort((p, q) => q[1] - p[1] || q[0] - p[0]);
  const key: number[] = [];
  for (const [rank, c] of ordered) {
    key.push(c, rank);
  }
  return key;
}

/** Default stud post-3rd order: HIGHEST exposed board (by best-5-of-up-cards high) acts first. */
export function highestBoardFirst(state: StudState, live: readonly number[]): number[] {
  const score = (seat: number): { cat: number; tb: readonly number[] } => {
    const up = upCardsOf(state, seat);
    if (up.length === 0) return { cat: -1, tb: [] };
    if (up.length < 5) {
      // Partial board: rank by count groups (pairs/trips) then high cards.
      return { cat: 0, tb: partialHighKey(up) };
    }
    const v = bestHigh(up).value;
    return { cat: v.category, tb: v.tiebreak };
  };
  const cmp = (a: number, b: number): number => {
    const sa = score(a);
    const sb = score(b);
    if (sa.cat !== sb.cat) return sb.cat - sa.cat; // higher category first
    const n = Math.max(sa.tb.length, sb.tb.length);
    for (let i = 0; i < n; i++) {
      const x = sa.tb[i] ?? 0;
      const y = sb.tb[i] ?? 0;
      if (x !== y) return y - x; // higher first
    }
    return a - b; // deterministic tiebreak by seat (low seat first)
  };
  return [...live].sort(cmp);
}

export type StudModule = GameModule<StudState> & { stateHash: (s: StudState) => string };

/** Factory shared by Stud and Razz. Pass the three overrides (REQ-FSM-011). */
export function createStudCore(config: StudConfig, overrides: StudOverrides): StudModule {
  const deck = config.deck;
  let rulesetRef: Ruleset | null = null;

  /** Open a betting round with toAct set to a chosen seat (board-driven), via the engine. */
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
    // Need 3 cards/seat for 3rd street at minimum; the rest dealt street by street.
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

    // S0 ANTE: every seat antes (committed-this-hand; no bet-to-call from antes — core §A21.2).
    const ante = ruleset.blinds.ante;
    for (const s of ctx.seats) {
      const amt = Math.min(ante, s.stack);
      s.stack -= amt;
      s.committedThisHand += amt;
      if (s.stack === 0) s.allIn = true;
    }

    // Deal 3rd street: 2 down + 1 up per seat (deal order: round-robin button-first by seat).
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
      buttonSeat: order[0]!.seat, // stud has no button; kept for odd-chip ordering only
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

    // Bring-in: LOWEST up-card (stud) / HIGHEST (razz) posts the bring-in (forced partial bet).
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
    bi.hasActedThisRound = false; // bring-in still owes action choices to complete
    if (bi.stack === 0) bi.allIn = true;
    ctx.betToCall = biAmt;
    // A completion to the full small bet must be legal as a raise; size the last full raise so
    // minRaiseTo = bringIn + (smallBet - bringIn)?  The engine uses lastFullRaise for min-raise.
    // Set lastFullRaise so a completion to smallBet is the minimum legal raise-to.
    ctx.lastFullRaise = smallBet - biAmt > 0 ? smallBet - biAmt : smallBet;
    ctx.lastAggressor = bringInSeat;
    ctx.betLevel = 'small';

    // Action proceeds to the next seat after the bring-in, in seat order (3rd street uses
    // fixed clockwise order from the bring-in; only post-3rd is board-driven, REQ-FSM-005).
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

  /** Deal one card to every live seat for the next street (or a shared river, REQ-FSM-008). */
  function dealNextStreet(state: StudState, nextPhase: string): StudState {
    const order = seatOrder(state.ctx);
    const live = liveSeats(state.ctx);
    const hole: Record<number, Card[]> = {};
    for (const s of order) hole[s] = [...state.hole[s]!];
    let cursor = state.deckCursor;
    let sharedRiver = state.sharedRiver;

    if (nextPhase === PHASES.SEVENTH && cursor + live.length > state.deck.length) {
      // REQ-FSM-008: not enough cards to deal each live seat a 7th card → single shared up-card.
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
    // Deal the next street's card(s), then open a board-driven betting round (REQ-FSM-005).
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
    // Safe default: check if legal, else fold — never a forced wager (core §6.4). The bring-in
    // post itself happens at init, so by the time a seat is "to act" a check/fold default holds.
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
    // Public up-cards per seat (the publicly-revealed board, REQ-FSM-003); down-cards excluded.
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

/** Seven-Card Stud (high): lowest up-card brings in; highest board first; best-5-of-7 high. */
export function createStud(config: StudConfig): StudModule {
  return createStudCore(config, {
    variant: 'stud',
    bringInSeat: (up) => lowestUpCard(up),
    actingOrder: (state, live) => highestBoardFirst(state, live),
    compareSeats: (state, a, b) =>
      compareHigh(bestHigh(allCardsOf(state, a)).value, bestHigh(allCardsOf(state, b)).value),
  });
}
