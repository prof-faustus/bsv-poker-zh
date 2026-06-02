/**
 * A-to-5 低牌评估（Razz；hi-lo 的低牌部分稍后处理）—— core §5.3.3, REQ-POKER-006。
 * A 算作最小；顺子/同花不计入；最佳低牌 = 五个最小的不同点数；对子会被惩罚。
 * 越小越好。忠实移植自 handeval_oracle.py（eval5_low/best_low）。
 *
 * 可比较项 = (pairPenalty, 降序排列的低牌值)。比较时：先比 pairPenalty（对子越少
 * 越好 → 越小越好），再按值降序的字典序比较（越小越好）。最小顺子
 * A-2-3-4-5 → (0, [5,4,3,2,1]) 是可能的最佳低牌。
 */

import { type Card, lowRankValue } from '@bsv-poker/protocol-types';
import { combinations } from './high.ts';

export interface LowValue {
  readonly pairPenalty: number;
  /** 降序排列的低牌值。 */
  readonly values: readonly number[];
}

/** 对 a 与 b 返回 -1、0、+1，其中越小（更好的低牌）排为 -1。 */
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

/** 从 >=5 张牌中选出最佳的 5 张低牌（Razz：7 张里选最佳 5 张）。 */
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
 * 奥马哈-8 合格低牌（eight-or-better，八或更好）—— core REQ-FSM-007, §5.3.3。
 * 仅当五个不同点数且每个 ≤ 8（A 算作 1）时才合格。若不存在合格低牌则返回 null。
 * 使用恰 2 张底牌 + 恰 3 张公共牌，取最小的合格低牌。
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
      if (!distinct || !allLeq8) continue; // 不合格
      if (best === null || compareLow(v, best) < 0) {
        best = v;
        bestCards = combo;
      }
    }
  }
  return best === null ? null : { value: best, cards: bestCards };
}
