/**
 * High-hand evaluation — core §5.3.1. Ported faithfully from handeval_oracle.py (the oracle
 * is the source of truth, REQ-POKER-003); the production evaluator MUST reproduce it
 * bit-for-bit. Categories high→low map to 8..0:
 *   8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight, 3 trips, 2 two pair,
 *   1 one pair, 0 high card.
 * Comparison is (category, tiebreak[]) lexicographically; higher is better. Suits never
 * break ties (core §5.5.1).
 */

import { type Card, cardSuit, compareRank } from '@bsv-poker/protocol-types';

export const CATEGORY_NAMES: Record<number, string> = {
  8: 'straight flush',
  7: 'four of a kind',
  6: 'full house',
  5: 'flush',
  4: 'straight',
  3: 'three of a kind',
  2: 'two pair',
  1: 'one pair',
  0: 'high card',
};

export interface HandValue {
  readonly category: number;
  readonly tiebreak: readonly number[];
}

/** Returns -1, 0, or +1 for a vs b (higher hand is better). Transitive (oracle-verified). */
export function compareHigh(a: HandValue, b: HandValue): -1 | 0 | 1 {
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  const n = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < n; i++) {
    const x = a.tiebreak[i] ?? 0;
    const y = b.tiebreak[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function countBy(values: readonly number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

/** Evaluate exactly 5 cards. Mirrors oracle eval5_high. */
export function eval5High(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) throw new RangeError(`eval5High needs 5 cards, got ${cards.length}`);
  const vs = cards.map(compareRank).sort((a, b) => b - a); // desc
  const suits = cards.map(cardSuit);
  const isFlush = new Set(suits).size === 1;

  const uniq = [...new Set(vs)].sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0]! - uniq[4]! === 4) {
      isStraight = true;
      straightHigh = uniq[0]!;
    } else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      isStraight = true; // wheel A-2-3-4-5
      straightHigh = 5;
    }
  }

  const cnt = countBy(vs);
  // order ranks by (count desc, rank desc)
  const ordered = [...cnt.entries()].sort((p, q) => (q[1] - p[1]) || (q[0] - p[0]));
  const counts = ordered.map(([, c]) => c);
  const rseq = ordered.map(([r]) => r);

  const eq = (a: number[]): boolean => counts.length === a.length && counts.every((c, i) => c === a[i]);

  if (isStraight && isFlush) return { category: 8, tiebreak: [straightHigh] };
  if (eq([4, 1])) return { category: 7, tiebreak: rseq };
  if (eq([3, 2])) return { category: 6, tiebreak: rseq };
  if (isFlush) return { category: 5, tiebreak: vs };
  if (isStraight) return { category: 4, tiebreak: [straightHigh] };
  if (eq([3, 1, 1])) return { category: 3, tiebreak: rseq };
  if (eq([2, 2, 1])) return { category: 2, tiebreak: rseq };
  if (eq([2, 1, 1, 1])) return { category: 1, tiebreak: rseq };
  return { category: 0, tiebreak: vs };
}

function* combinations<T>(arr: readonly T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield idx.map((i) => arr[i]!);
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

/** Best 5-card high hand from >=5 cards (Hold'em/Stud) — C(7,5)=21. core REQ-POKER-004. */
export function bestHigh(cards: readonly Card[]): { value: HandValue; cards: Card[] } {
  if (cards.length < 5) throw new RangeError(`bestHigh needs >=5 cards`);
  let best: HandValue | null = null;
  let bestCards: Card[] = [];
  for (const combo of combinations(cards, 5)) {
    const v = eval5High(combo);
    if (best === null || compareHigh(v, best) > 0) {
      best = v;
      bestCards = combo;
    }
  }
  return { value: best!, cards: bestCards };
}

/** Omaha: exactly 2 of 4 hole + exactly 3 of 5 board — C(4,2)·C(5,3)=60. core REQ-POKER-005. */
export function bestOmaha(
  hole: readonly Card[],
  board: readonly Card[],
): { value: HandValue; cards: Card[] } {
  if (hole.length !== 4) throw new RangeError(`Omaha needs 4 hole cards`);
  if (board.length !== 5) throw new RangeError(`Omaha needs 5 board cards`);
  let best: HandValue | null = null;
  let bestCards: Card[] = [];
  for (const h of combinations(hole, 2)) {
    for (const b of combinations(board, 3)) {
      const combo = [...h, ...b];
      const v = eval5High(combo);
      if (best === null || compareHigh(v, best) > 0) {
        best = v;
        bestCards = combo;
      }
    }
  }
  return { value: best!, cards: bestCards };
}

export { combinations };
