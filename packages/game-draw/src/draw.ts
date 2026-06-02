/**
 * Five-Card Draw GameModule — core §7.3.3 (S0..S8). Blinds; deal 5 concealed; first betting
 * round; the DRAW; second betting round; showdown of the 5 cards held (best-5, §5.3,
 * REQ-POKER-004).
 *
 * The DRAW (REQ-FSM-004 / REQ-FSM-009): each live seat, in turn, surrenders a chosen subset of
 * its concealed cards to a dead-hand state WITHOUT revealing them (a partial fold) and is dealt
 * the same number of fresh concealed cards from the still-undealt portion of the shuffled deck.
 * The discarded cards are never revealed; replacements are private-revealed to the drawer only.
 * The COUNT drawn is public game information; the card IDENTITIES are not. The DRAW
 * timeout-default is STAND PAT — draw zero (REQ-FSM-010): the safe default that forfeits no
 * information and no equity beyond declining to improve.
 *
 * The draw action uses Action.discard (slot indices into the seat's 5-card hand) with
 * kind:'draw'; a no-op draw is expressed as kind:'stand' (or kind:'draw' with empty discard).
 *
 * Determinism (P2 / REQ-ARCH-002): pure function of (ruleset, injected recorded deck, actions);
 * no randomness. The deck is the post-shuffle order (core §4); the undealt tail supplies the
 * replacements deterministically. Every actionable state has a cooperative successor and a
 * timeout-default (P4): check/fold in betting, stand-pat in the draw.
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

// §7.3.3 phases (S0..S8).
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
  /** Engine-known 5-card hand per seat; concealed at the UI boundary. */
  readonly hole: Readonly<Record<number, readonly Card[]>>;
  /** Public per-seat draw count (identities private, count public — REQ-FSM-009). */
  readonly drawCounts: Readonly<Record<number, number>>;
  /** Index of the next undealt card in the deck (advances on deal and on each redraw). */
  readonly deckCursor: number;
  /** Seat currently to act in the DRAW phase; null outside DRAW or once all have drawn. */
  readonly drawToAct: number | null;
  readonly payouts: Payouts;
}

interface DrawConfig {
  /** Post-shuffle deck. Must cover the deal (5*seats) plus worst-case redraws (up to 5*seats). */
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
    const need = HAND_SIZE * seatInits.length; // minimum to deal; redraws need more tail
    if (deck.length < need) throw new Error(`deck too small: need ${need}, got ${deck.length}`);

    const order = [...seatInits].sort((a, b) => a.seat - b.seat);
    const buttonSeat = order[0]!.seat;
    const sb = buttonSeat;
    const bb = order[1 % order.length]!.seat;

    // Deal 5 concealed cards, one at a time, button-first (S2 DEAL).
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
    ctx.toAct = sb; // heads-up: button/SB acts first in BET1

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
      deckCursor: HAND_SIZE * order.length, // first undealt card after the deal
      drawToAct: null,
      payouts: [],
    };
    rulesetRef = ruleset;
    return base;
  }

  /** First seat to act in a draw / postflop-style round: left of the button (non-button HU). */
  function firstAfterButton(state: DrawState): number {
    return nonButton(state.ctx, state.buttonSeat);
  }

  /** Order of live seats for the DRAW, starting left-of-button (REQ-FSM-009 turn order). */
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
        return s; // awaits draw actions, advanced by applyDraw
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
        // Open the DRAW phase: first live seat left-of-button draws first.
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

  /** Begin BET2 after the draw completes: open a fresh round, first live seat left-of-button. */
  function openBet2(state: DrawState): DrawState {
    const ctx = openRound(state.ctx, firstAfterButton(state), 'big');
    // openRound set toAct to firstAfterButton even if that seat folded; fix to first live actor.
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

    // Showdown: best-5 of the 5 cards held (each seat has exactly 5, REQ-POKER-004).
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

  /** Apply a draw/stand for the seat on the clock in the DRAW phase (REQ-FSM-004/009). */
  function applyDraw(state: DrawState, action: Action): DrawState {
    if (state.drawToAct !== action.seat) throw new Error(`not seat ${action.seat}'s draw`);
    const seat = action.seat;
    const slots = action.kind === 'stand' ? [] : [...(action.discard ?? [])];
    // Validate slot indices: distinct, within 0..4.
    const uniq = new Set(slots);
    if (uniq.size !== slots.length) throw new Error('duplicate discard slots');
    for (const i of slots) {
      if (!Number.isInteger(i) || i < 0 || i >= HAND_SIZE) throw new Error(`bad discard slot ${i}`);
    }
    if (slots.length > HAND_SIZE) throw new Error('cannot discard more than 5');

    // Surrender the chosen slots to dead-hand (no reveal) and redraw from the undealt tail.
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

    // Advance drawToAct to the next live seat that has not yet drawn.
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
    // All live seats have drawn → open the second betting round.
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
      // REQ-FSM-010: the DRAW timeout-default is STAND PAT (draw zero).
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
    // Public draw counts (identities stay concealed — REQ-FSM-009).
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
