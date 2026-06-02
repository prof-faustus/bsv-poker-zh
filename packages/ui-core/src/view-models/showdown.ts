/**
 * 摊牌 / 结算 view-models（REQ-APP-051；§A6.8）—— 纯投影。
 * 底牌的亮牌与结算摘要直接从终局的 HoldemState 中读取（派彩来自引擎；
 * UI 从不计算奖励）。
 */

import type { Card, Payouts } from '@bsv-poker/protocol-types';
import type { HoldemState } from '@bsv-poker/game-holdem';
import { cardVM, type CardVM } from './table.ts';

export interface ShowdownSeatVM {
  readonly seat: number;
  readonly folded: boolean;
  /** 已亮出的底牌（引擎已知的牌面；隐藏式亮牌是后续 crypto 层的路径）。 */
  readonly holeCards: readonly CardVM[];
  readonly won: number;
}

export interface ShowdownViewModel {
  readonly board: readonly CardVM[];
  readonly seats: readonly ShowdownSeatVM[];
  /** 当本手牌因除一人外全部弃牌而结束时为 true（无需亮牌，core P5）。 */
  readonly uncontested: boolean;
}

export interface SettlementRowVM {
  readonly seat: number;
  readonly delta: number;
  readonly endingStack: number;
}

export interface SettlementViewModel {
  readonly rows: readonly SettlementRowVM[];
  readonly totalPot: number;
}

export function showdownViewModel(
  state: HoldemState,
  startingStacks: ReadonlyMap<number, number>,
): ShowdownViewModel {
  const payoutBySeat = new Map<number, number>();
  for (const p of state.payouts) payoutBySeat.set(p.seat, p.amount);
  const liveCount = state.seats.filter((s) => !s.folded).length;
  const seats: ShowdownSeatVM[] = state.seats.map((s) => {
    const hole = (state.hole[s.seat] ?? []) as readonly Card[];
    return {
      seat: s.seat,
      folded: s.folded,
      holeCards: hole.map(cardVM),
      won: payoutBySeat.get(s.seat) ?? 0,
    };
  });
  void startingStacks;
  return {
    board: state.board.map(cardVM),
    seats,
    uncontested: liveCount <= 1,
  };
}

export function settlementViewModel(
  state: HoldemState,
  startingStacks: ReadonlyMap<number, number>,
): SettlementViewModel {
  const payouts: Payouts = state.payouts;
  const totalPot = payouts.reduce((sum, p) => sum + p.amount, 0);
  const rows: SettlementRowVM[] = state.seats.map((s) => {
    const start = startingStacks.get(s.seat) ?? s.stack;
    return { seat: s.seat, delta: s.stack - start, endingStack: s.stack };
  });
  return { rows, totalPot };
}
