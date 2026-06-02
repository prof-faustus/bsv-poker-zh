/**
 * Razz GameModule — core §7.3.4, REQ-FSM-011. Razz IS the Seven-Card Stud FSM (§7.3.2,
 * S0..S9) with exactly THREE overrides; the state graph is otherwise identical, so this module
 * reuses `createStudCore` from @bsv-poker/game-stud and supplies the deltas:
 *
 *   (i)   bring-in selector = HIGHEST up-card (high is bad in lowball; ties by the same declared
 *         forced-bet suit order, NOT hand-eval suit precedence);
 *   (ii)  post-3rd betting order = BEST (lowest) exposed low first;
 *   (iii) showdown evaluator = ace-to-five low (§5.3.3, REQ-POKER-006; straights/flushes do not
 *         count, aces low, best is the wheel A-2-3-4-5 — verified in §19.D).
 *
 * No open-pair big-bet rule applies (meaningless for low). The 8-player exhaustion rule
 * (REQ-FSM-008) applies identically (handled inside the shared stud core).
 *
 * Determinism (P2): inherited from the stud core — pure function of (ruleset, injected deck,
 * actions); two-exit rule on every actionable state (P4).
 */

import { type Card, cardSuit, lowRankValue } from '@bsv-poker/protocol-types';
import { bestLow, compareLow } from '@bsv-poker/hand-eval';
import {
  type StudModule,
  type StudState,
  allCardsOf,
  createStudCore,
  upCardsOf,
} from '@bsv-poker/game-stud';

interface RazzConfig {
  readonly deck: readonly Card[];
}

/** Razz bring-in: HIGHEST up-card by rank, ties by declared forced-bet suit order (c<d<h<s). */
export function highestUpCard(upCards: ReadonlyMap<number, Card>): number {
  let best: { seat: number; rank: number; suit: number } | null = null;
  for (const [seat, card] of upCards) {
    // Rank "high" for the bring-in uses the natural rank where Ace is HIGH (A is the lowest, so
    // it is the LEAST likely bring-in). Use the standard high rank ordering (2 low .. A high).
    const rank = lowRankValue(card) === 1 ? 14 : lowRankValue(card); // A -> 14 (high) for bring-in
    const suit = cardSuit(card);
    if (
      best === null ||
      rank > best.rank ||
      (rank === best.rank && suit < best.suit) // tie: lower suit ordinal posts (declared order)
    ) {
      best = { seat, rank, suit };
    }
  }
  return best!.seat;
}

/**
 * Partial-low comparable for the exposed up-cards: ace-to-five low values (A=1) sorted ascending
 * (a lower max card / lower set is a "better" — i.e. acts-first — low board). Straights/flushes
 * are ignored (only ranks matter). Used for the post-3rd acting order (best low acts first).
 */
function partialLowKey(upCards: readonly Card[]): number[] {
  // Ascending low values; ties broken so that fewer pairs and lower cards sort first.
  const vals = upCards.map(lowRankValue).sort((a, b) => a - b);
  return vals;
}

/** Razz post-3rd order: BEST (lowest) exposed low acts FIRST (REQ-FSM-011 (ii)). */
export function lowestBoardFirst(state: StudState, live: readonly number[]): number[] {
  const keyOf = (seat: number): number[] => {
    const up = upCardsOf(state, seat);
    if (up.length >= 5) {
      // A complete exposed low: rank by the actual ace-to-five low evaluation.
      const v = bestLow(up).value;
      // Encode (pairPenalty, values-desc) into a comparable array; lower is better.
      return [v.pairPenalty, ...v.values];
    }
    return partialLowKey(up);
  };
  const cmp = (a: number, b: number): number => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    const n = Math.max(ka.length, kb.length);
    for (let i = 0; i < n; i++) {
      const x = ka[i] ?? Infinity; // missing entries sort as "worse" (later)
      const y = kb[i] ?? Infinity;
      if (x !== y) return x - y; // lower (better low) first
    }
    return a - b; // deterministic seat tiebreak
  };
  return [...live].sort(cmp);
}

export type RazzModule = StudModule;

/** Razz: highest up-card brings in; lowest board acts first; ace-to-five low showdown. */
export function createRazz(config: RazzConfig): RazzModule {
  return createStudCore(
    { deck: config.deck },
    {
      variant: 'razz',
      bringInSeat: (up) => highestUpCard(up),
      actingOrder: (state, live) => lowestBoardFirst(state, live),
      compareSeats: (state, a, b) => {
        // Ace-to-five low: LOWER is better. compareLow returns -1 when a is the better (lower)
        // low; awardPot wants +1 when a should WIN, so invert.
        const c = compareLow(bestLow(allCardsOf(state, a)).value, bestLow(allCardsOf(state, b)).value);
        return (c === 0 ? 0 : c < 0 ? 1 : -1) as -1 | 0 | 1;
      },
    },
  );
}

export { PHASES } from '@bsv-poker/game-stud';
