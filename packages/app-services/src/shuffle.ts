/**
 * 用于第一阶段 play-money/regtest 热座对局的浏览器安全牌组洗牌。
 *
 * 诚实的适用范围（§A2.3，构建简报）：这是由 crypto.getRandomValues 提供种子的单方 Fisher–Yates。
 * 它不是多方 mental-poker 洗牌（core §4）——那种没有任何单方知晓顺序的 commit-reveal 协议
 * 属于 Node SDK / 密码学层路径，不在浏览器包的范围内（crypto-mentalpoker 使用 node:crypto）。
 * 这里单个客户端给自己 + 一个 bot 发牌，因此既不可能也不声称实现无需信任的洗牌。
 */

import { NUM_CARDS, type Card } from '@bsv-poker/protocol-types';

/** 使用注入的 0..1 RNG 的确定性 Fisher–Yates（以便测试可以为其提供种子）。 */
export function shuffleWith(rng: () => number): Card[] {
  const deck: Card[] = [];
  for (let c = 0; c < NUM_CARDS; c++) deck.push(c);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

/** 一个均匀的 0..1 RNG，可用时（浏览器）由 crypto.getRandomValues 支持，否则使用 Math.random。 */
export function cryptoRng(): () => number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  const c = g.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return () => {
      const buf = new Uint32Array(1);
      c.getRandomValues!(buf);
      return buf[0]! / 0x100000000;
    };
  }
  return Math.random;
}

/** 使用平台 CSPRNG 洗一副全新的 52 张牌组（regtest/play-money）。 */
export function shuffleDeck(): Card[] {
  return shuffleWith(cryptoRng());
}
