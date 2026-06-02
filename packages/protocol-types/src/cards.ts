/**
 * 牌与牌堆编码 — core §5.1, REQ-POKER-001。
 *
 * 规范编码：card = rank*4 + suit，rank ∈ 0..12（2=0 … A=12），suit ∈ 0..3（c=0,d=1,h=2,s=3）。
 * card_serial ∈ 0..51。这与绑定到洗牌（core §4）以及交易 schema（core §6）中的编码完全相同。
 * 它也是预言机（handeval_oracle.py）所使用的编码。
 */

export const RANKS = '23456789TJQKA' as const; // 索引 0..12 -> 字符
export const SUITS = 'cdhs' as const; // 索引 0..3 -> 字符

/** 0..51 范围内的暗牌/明牌索引。 */
export type Card = number;

export const NUM_CARDS = 52;

export function isCard(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < NUM_CARDS;
}

/** 规范编码的 rank：0..12，其中 2=0 … A=12。 */
export function cardRank(c: Card): number {
  return Math.floor(c / 4);
}

/** 花色：0..3（c,d,h,s）。扑克中花色没有优先级（core §5.5.1）。 */
export function cardSuit(c: Card): number {
  return c % 4;
}

/**
 * 内部比较用 rank 2..14（A=14）。用于牌力评估；最小顺子（A-2-3-4-5）
 * 由评估器按以 5 为最高的顺子计分，而非在此处理。
 */
export function compareRank(c: Card): number {
  return cardRank(c) + 2;
}

/** Ace-to-five 低牌取值：A=1, 2=2 … K=13（core §5.3.3, REQ-POKER-006）。 */
export function lowRankValue(c: Card): number {
  const r = cardRank(c);
  return r === 12 ? 1 : r + 2;
}

export function cardToString(c: Card): string {
  if (!isCard(c)) throw new RangeError(`card out of range: ${c}`);
  return `${RANKS[cardRank(c)]}${SUITS[cardSuit(c)]}`;
}

/** 将 "As"、"Td"、"9h" … 解析为牌索引。 */
export function parseCard(s: string): Card {
  if (s.length !== 2) throw new SyntaxError(`bad card: "${s}"`);
  const r = RANKS.indexOf(s[0]!.toUpperCase());
  const su = SUITS.indexOf(s[1]!.toLowerCase());
  if (r < 0 || su < 0) throw new SyntaxError(`bad card: "${s}"`);
  return r * 4 + su;
}

export function parseHand(s: string): Card[] {
  return s.trim().split(/\s+/).map(parseCard);
}
