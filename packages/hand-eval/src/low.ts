/**
 * Ace-to-five LOW evaluation (Razz; hi-lo low later) — core §5.3.3, REQ-POKER-006.
 * Aces low; straights/flushes do NOT count; best low = lowest five DISTINCT ranks; pairs
 * penalised. LOWER is better. Ported faithfully from handeval_oracle.py (eval5_low/best_low).
 *
 * Comparable = (pairPenalty, sorted-desc low values). Compared: pairPenalty first (fewer
 * pairs is better → smaller is better), then values descending lexicographically (smaller is
 * better). The wheel A-2-3-4-5 → (0, [5,4,3,2,1]) is the best possible.
 */

import { type Card, lowRankValue } from '@bsv-poker/protocol-types';
import { combinations } from './high.ts';

export interface LowValue {
  readonly pairPenalty: number;
  /** Low values sorted descending. */
  readonly values: readonly number[];
}

/** Returns -1, 0, +1 for a vs b where LOWER (better low) sorts as -1. */
export function compareLow(a: LowValue, b: LowValue): -1 | 0 | 1 {
  if (a.pairPenalty !== b.pairPenalty) return a.pairPenalty < b.pairPenalty ? -1 : 1;
  const n = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < n; i++) {
    const x = a.values[i] ?? 0;
    const y = b.values[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function eval5Low(cards: readonly Card[]): LowValue {
  if (cards.length !== 5) throw new RangeError(`eval5Low needs 5 cards`);
  const vals = cards.map(lowRankValue);
  const cnt = new Map<number, number>();
  for (const v of vals) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  let pairPenalty = 0;
  for (const c of cnt.values()) pairPenalty += c - 1;
  return { pairPenalty, values: [...vals].sort((a, b) => b - a) };
}

/** Best 5-card low from >=5 cards (Razz: best 5 of 7). */
export function bestLow(cards: readonly Card[]): { value: LowValue; cards: Card[] } {
  if (cards.length < 5) throw new RangeError(`bestLow needs >=5 cards`);
  let best: LowValue | null = null;
  let bestCards: Card[] = [];
  for (const combo of combinations(cards, 5)) {
    const v = eval5Low(combo);
    if (best === null || compareLow(v, best) < 0) {
      best = v;
      bestCards = combo;
    }
  }
  return { value: best!, cards: bestCards };
}

/**
 * Omaha-8 qualifying low (eight-or-better) — core REQ-FSM-007, §5.3.3.
 * Qualifies only with five DISTINCT ranks each ≤ 8 (A counts as 1). Returns null if no
 * qualifying low exists. Uses exactly-2-hole + exactly-3-board, lowest qualifying low.
 */
export function bestOmaha8Low(
  hole: readonly Card[],
  board: readonly Card[],
): { value: LowValue; cards: Card[] } | null {
  let best: LowValue | null = null;
  let bestCards: Card[] = [];
  for (const h of combinations(hole, 2)) {
    for (const b of combinations(board, 3)) {
      const combo = [...h, ...b];
      const v = eval5Low(combo);
      const distinct = new Set(v.values).size === 5;
      const allLeq8 = v.values.every((x) => x <= 8);
      if (!distinct || !allLeq8) continue; // does not qualify
      if (best === null || compareLow(v, best) < 0) {
        best = v;
        bestCards = combo;
      }
    }
  }
  return best === null ? null : { value: best, cards: bestCards };
}
