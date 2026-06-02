/**
 * Razz 游戏模块 —— core §7.3.4, REQ-FSM-011。Razz 本质上就是七张梭哈的状态机（§7.3.2,
 * S0..S9），仅有三处覆盖；其状态图在其余方面完全相同，因此本模块复用
 * @bsv-poker/game-stud 的 `createStudCore` 并提供这些差异：
 *
 *   (i)   bring-in 选择器 = 最高的明牌（在低牌玩法中高牌是坏事；平局时按相同的已声明
 *         强制下注花色顺序处理，而非手牌评估的花色优先级）；
 *   (ii)  第三张牌后的下注顺序 = 最佳（最低）明面低牌优先；
 *   (iii) 摊牌评估器 = A-to-5 低牌（§5.3.3, REQ-POKER-006；顺子/同花不计，A 算最小，
 *         最佳是最小顺子 A-2-3-4-5 —— 已在 §19.D 验证）。
 *
 * 不适用明对大注规则（对低牌无意义）。8 人耗尽规则（REQ-FSM-008）完全相同地适用
 *（由共享的 stud 内核内部处理）。
 *
 * 确定性（P2）：继承自 stud 内核 —— 是 (ruleset, 注入的牌堆, actions) 的纯函数；
 * 每个可行动状态都遵循两出口规则（P4）。
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

/** Razz bring-in：按点数取最高的明牌，平局时按已声明的强制下注花色顺序（c<d<h<s）。 */
export function highestUpCard(upCards: ReadonlyMap<number, Card>): number {
  let best: { seat: number; rank: number; suit: number } | null = null;
  for (const [seat, card] of upCards) {
    // bring-in 所用的"高"点数采用 A 为最大的自然点数（A 是最小的牌，因此它最不
    // 可能成为 bring-in）。使用标准的高牌点数排序（2 最小 .. A 最大）。
    const rank = lowRankValue(card) === 1 ? 14 : lowRankValue(card); // bring-in 时 A -> 14（最大）
    const suit = cardSuit(card);
    if (
      best === null ||
      rank > best.rank ||
      (rank === best.rank && suit < best.suit) // 平局：花色序号较小者下注（按声明顺序）
    ) {
      best = { seat, rank, suit };
    }
  }
  return best!.seat;
}

/**
 * 用于明牌的部分低牌可比较项：A-to-5 低牌值（A=1）升序排列（最大牌更小 / 整组更小
 * 即为"更好"——即先行动——的低牌明面）。忽略顺子/同花（仅点数有意义）。
 * 用于第三张牌后的行动顺序（最佳低牌先行动）。
 */
function partialLowKey(upCards: readonly Card[]): number[] {
  // 升序的低牌值；破平时使对子更少、牌更小者排在前面。
  const vals = upCards.map(lowRankValue).sort((a, b) => a - b);
  return vals;
}

/** Razz 第三张牌后的顺序：最佳（最低）明面低牌先行动（REQ-FSM-011 (ii)）。 */
export function lowestBoardFirst(state: StudState, live: readonly number[]): number[] {
  const keyOf = (seat: number): number[] => {
    const up = upCardsOf(state, seat);
    if (up.length >= 5) {
      // 完整的明面低牌：按实际的 A-to-5 低牌评估排序。
      const v = bestLow(up).value;
      // 将 (pairPenalty, values-降序) 编码为可比较数组；越小越好。
      return [v.pairPenalty, ...v.values];
    }
    return partialLowKey(up);
  };
  const cmp = (a: number, b: number): number => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    const n = Math.max(ka.length, kb.length);
    for (let i = 0; i < n; i++) {
      const x = ka[i] ?? Infinity; // 缺失项排为"更差"（靠后）
      const y = kb[i] ?? Infinity;
      if (x !== y) return x - y; // 较小（更好的低牌）在前
    }
    return a - b; // 确定性的座位破平
  };
  return [...live].sort(cmp);
}

export type RazzModule = StudModule;

/** Razz：最高明牌进行 bring-in；最低明面先行动；A-to-5 低牌摊牌。 */
export function createRazz(config: RazzConfig): RazzModule {
  return createStudCore(
    { deck: config.deck },
    {
      variant: 'razz',
      bringInSeat: (up) => highestUpCard(up),
      actingOrder: (state, live) => lowestBoardFirst(state, live),
      compareSeats: (state, a, b) => {
        // A-to-5 低牌：越小越好。当 a 是更好（更低）的低牌时 compareLow 返回 -1；
        // awardPot 需要在 a 应获胜时为 +1，故取反。
        const c = compareLow(bestLow(allCardsOf(state, a)).value, bestLow(allCardsOf(state, b)).value);
        return (c === 0 ? 0 : c < 0 ? 1 : -1) as -1 | 0 | 1;
      },
    },
  );
}

export { PHASES } from '@bsv-poker/game-stud';
