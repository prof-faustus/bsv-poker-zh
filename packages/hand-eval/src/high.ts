/**
 * 高牌手牌评估 —— core §5.3.1。忠实移植自 handeval_oracle.py（该 oracle 为
 * 唯一可信来源，REQ-POKER-003）；生产环境的评估器必须逐位复现它。
 * 类别从高到低映射为 8..0：
 *   8 同花顺，7 四条，6 葫芦，5 同花，4 顺子，3 三条，2 两对，
 *   1 一对，0 高牌。
 * 比较按 (category, tiebreak[]) 字典序进行；越大越好。花色绝不用于破平
 *（core §5.5.1）。
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

/** 对 a 与 b 返回 -1、0 或 +1（手牌越大越好）。满足传递性（已由 oracle 验证）。 */
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

/** 评估恰好 5 张牌。与 oracle 的 eval5_high 保持一致。 */
export function eval5High(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) throw new RangeError(`eval5High needs 5 cards, got ${cards.length}`);
  const vs = cards.map(compareRank).sort((a, b) => b - a); // 降序
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
      isStraight = true; // 最小顺子（wheel）A-2-3-4-5
      straightHigh = 5;
    }
  }

  const cnt = countBy(vs);
  // 按 (数量降序, 点数降序) 对点数排序
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

/** 从 >=5 张牌中选出最佳的 5 张高牌手牌（德州扑克/七张梭哈）—— C(7,5)=21。core REQ-POKER-004。 */
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

/** 奥马哈：4 张底牌中恰取 2 张 + 5 张公共牌中恰取 3 张 —— C(4,2)·C(5,3)=60。core REQ-POKER-005。 */
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
