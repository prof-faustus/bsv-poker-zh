/**
 * 无障碍标签（REQ-APP-054）。用于牌、座位和动作的屏幕阅读器 / 非视觉文本。
 * 牌的身份通过 RANK + SUIT WORDS 表达——绝不仅靠颜色——因此即便无法感知颜色，
 * 游戏也完全可玩（花色为 "clubs/diamonds/hearts/spades"，而非红/黑）。
 */

import { type Card, cardRank, cardSuit, isCard } from '@bsv-poker/protocol-types';

const RANK_WORDS = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const SUIT_WORDS = ['clubs', 'diamonds', 'hearts', 'spades'];

/** 例如 "Ace of spades" —— 不依赖颜色的朗读文本。 */
export function accessibleCardLabel(card: Card): string {
  if (!isCard(card)) throw new RangeError(`card out of range: ${card}`);
  return `${RANK_WORDS[cardRank(card)]} of ${SUIT_WORDS[cardSuit(card)]}`;
}

export function accessibleSeatLabel(seat: number, seatCount: number): string {
  return `Seat ${seat + 1} of ${seatCount}`;
}

export function accessibleActionLabel(kind: string, amount?: number): string {
  const verb = kind.charAt(0).toUpperCase() + kind.slice(1);
  return amount !== undefined ? `${verb} ${amount}` : verb;
}
