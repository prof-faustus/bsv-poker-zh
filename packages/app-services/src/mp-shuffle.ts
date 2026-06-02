/**
 * 共享的确定性洗牌（core §4.4）——实时客户端与转录重建使用完全相同的派生方式，
 * 因此重连的客户端会计算出逐字节一致的牌组。可移植（不依赖 node:crypto）。
 * 组合 seed = 按座位顺序的 H(r_1 ‖ … ‖ r_N)；牌组是基于该 seed 的
 * counter-mode-PRF Fisher–Yates 洗牌。
 */

import { type Card, sha256, ByteWriter } from '@bsv-poker/protocol-types';

export function seededShuffle(seed: Uint8Array, n: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  let counter = 0;
  let pool: number[] = [];
  const draw = (): number => {
    if (pool.length === 0) {
      const w = new ByteWriter();
      for (const b of seed) w.u8(b);
      w.u32(counter++);
      const h = sha256(w.toBytes());
      for (let i = 0; i + 4 <= h.length; i += 4) {
        pool.push(((h[i]! << 24) | (h[i + 1]! << 16) | (h[i + 2]! << 8) | h[i + 3]!) >>> 0);
      }
    }
    return pool.shift()!;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = draw() % (i + 1);
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  return perm;
}

/** 牌组 = 各方已揭示熵的组合（座位顺序）→ 52 张牌的洗牌。 */
export function deckFromEntropies(entropies: readonly Uint8Array[]): Card[] {
  const w = new ByteWriter();
  for (const e of entropies) for (const b of e) w.u8(b);
  return seededShuffle(sha256(w.toBytes()), 52);
}
