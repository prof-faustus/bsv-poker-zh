/**
 * Table / game state model — core §3.3, §7. The engine derives state as a pure function of
 * (orderedValidTxSet, ruleset) (REQ-ARCH-001); these types describe the derived state.
 *
 * Card lifecycle (core §4.3): minted → drawn(position) → revealed | folded → discarded.
 */

import type { Card } from './cards.ts';

/** Phase identifiers are game-module-specific strings (e.g. the §19.E S0..S13 / RECOVERY). */
export type PhaseId = string;

export interface SeatState {
  readonly seat: number;
  readonly stack: number;
  /** Chips committed in the current betting round. */
  readonly committedThisRound: number;
  /** Total chips committed this hand (folded players included — core §19.B). */
  readonly committedThisHand: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** Whether this seat has acted since the last aggressive action (core REQ-POKER-009). */
  readonly hasActedThisRound: boolean;
  /** Concealed card slots assigned to this seat (card serials are concealed until reveal). */
  readonly holeSlots: readonly number[];
}

/** A pot (main or side) — core §5.5 / §19.B. */
export interface Pot {
  readonly amount: number;
  /** Live seats eligible to win this pot. */
  readonly eligible: readonly number[];
}

export interface BettingState {
  /** Current amount a seat must match to stay in (core REQ-POKER-009). */
  readonly betToCall: number;
  /** Size of the last full raise, for min-raise legality (core §5.4). */
  readonly lastFullRaise: number;
  /** Seat index whose action is awaited; null when the round is closed. */
  readonly toAct: number | null;
  /** Seat of the last aggressor (bettor/raiser) this round; null if none. */
  readonly lastAggressor: number | null;
  /** Number of raises made this street (FL cap, core §5.4). */
  readonly raisesThisStreet: number;
}

export interface GameState {
  readonly rulesetHash: string; // hex (core §5.2)
  readonly gid: string; // game id (hex)
  readonly phase: PhaseId;
  readonly handNumber: number;
  readonly buttonSeat: number;
  readonly seats: readonly SeatState[];
  /** Board / community cards revealed so far (public). */
  readonly board: readonly Card[];
  readonly betting: BettingState;
  readonly pots: readonly Pot[];
  /**
   * Engine-known hole cards per seat (concealed at the UI/custody boundary; a client renders
   * only its OWN seat's cards via the viewer path, core §11.5). Present once cards are dealt.
   */
  readonly hole?: Readonly<Record<number, readonly Card[]>>;
  /**
   * Seat to act in a NON-betting decision phase (e.g. Five-Card Draw's discard step, core
   * §7.3.3), when `betting.toAct` is null but a player still owes a move. null otherwise.
   */
  readonly drawToAct?: number | null;
  /** True once the hand has reached a terminal phase. */
  readonly handComplete: boolean;
}

/** Settlement result — core §5.7. */
export interface Payout {
  readonly seat: number;
  readonly amount: number;
}
export type Payouts = readonly Payout[];
