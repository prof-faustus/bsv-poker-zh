/**
 * 边池计算 —— core §5.5 / §19.B。确定性（P2）。包含守恒断言（REQ-ENG）：
 * Σ pot.amount = Σ contrib（违反即为缺陷）。
 *
 * 奇数筹码 / 平分规则 —— core §5.5.1, REQ-POKER-013：筹码在粒度允许范围内尽量
 * 均分；奇数筹码归于最靠近按钮左侧（LEFT OF THE BUTTON）的并列赢家。此分配中
 * 不存在花色优先级（花色破平是由调用方处理的房间规则标志，绝不在此处、也绝不在
 * 手牌评估中处理）。
 */

import type { Pot } from '@bsv-poker/protocol-types';

export interface SeatContribution {
  readonly seat: number;
  readonly contrib: number;
  readonly folded: boolean;
}

/** 根据每个座位的投入构建主池 + 有序边池（§19.B）。 */
export function computePots(seats: readonly SeatContribution[]): Pot[] {
  const totalContrib = seats.reduce((s, p) => s + p.contrib, 0);

  // 1. 排序后的不重复正投入级别
  const levels = [...new Set(seats.map((p) => p.contrib).filter((c) => c > 0))].sort(
    (a, b) => a - b,
  );

  const pots: Pot[] = [];
  let prev = 0;
  for (const L of levels) {
    const increment = L - prev;
    const contributors = seats.filter((p) => p.contrib >= L);
    const amount = increment * contributors.length;
    const eligible = contributors.filter((p) => !p.folded).map((p) => p.seat);
    pots.push({ amount, eligible });
    prev = L;
  }

  // 5. 守恒断言
  const potSum = pots.reduce((s, p) => s + p.amount, 0);
  if (potSum !== totalContrib) {
    throw new Error(`pot conservation violated: Σpots=${potSum} Σcontrib=${totalContrib}`);
  }
  return pots;
}

/**
 * 给定一个对符合条件座位的比较器以及按钮位置，将单个底池分配给其赢家。
 * `compareSeats(a,b)` 在 a 胜 b 时返回 +1，b 胜 a 时返回 -1，平局返回 0（最佳手牌获胜）。
 * 平局时均分；奇数筹码归于按钮左侧（REQ-POKER-013）。`seatOrderFromButton`
 * 按顺时针顺序列出座位，从按钮紧邻左侧开始 —— 用于确定性地分配奇数筹码。
 */
export function awardPot(
  pot: Pot,
  compareSeats: (a: number, b: number) => -1 | 0 | 1,
  seatOrderFromButton: readonly number[],
): Map<number, number> {
  const result = new Map<number, number>();
  if (pot.eligible.length === 0) return result;

  // 在符合条件的座位中找出最佳手牌。
  let winners: number[] = [pot.eligible[0]!];
  for (let i = 1; i < pot.eligible.length; i++) {
    const s = pot.eligible[i]!;
    const c = compareSeats(s, winners[0]!);
    if (c > 0) winners = [s];
    else if (c === 0) winners.push(s);
  }

  if (winners.length === 1) {
    result.set(winners[0]!, pot.amount);
    return result;
  }

  // 均分；从按钮左侧开始在并列赢家间分配奇数筹码。
  const base = Math.floor(pot.amount / winners.length);
  let remainder = pot.amount - base * winners.length;
  for (const w of winners) result.set(w, base);
  // 按并列赢家位于按钮左侧的位置排序。
  const ordered = seatOrderFromButton.filter((s) => winners.includes(s));
  for (const s of ordered) {
    if (remainder <= 0) break;
    result.set(s, (result.get(s) ?? 0) + 1);
    remainder--;
  }
  return result;
}
