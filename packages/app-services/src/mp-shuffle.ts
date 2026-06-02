/**
 * Shared deterministic shuffle (core §4.4) — the SAME derivation used by the live client and by
 * the transcript rebuild, so a reconnecting client computes a byte-identical deck. Portable
 * (no node:crypto). The composed seed = H(r_1 ‖ … ‖ r_N) in seat order; the deck is a
 * counter-mode-PRF Fisher–Yates over that seed.
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

/** Deck = composition of the parties' revealed entropies (seat order) → 52-card shuffle. */
export function deckFromEntropies(entropies: readonly Uint8Array[]): Card[] {
  const w = new ByteWriter();
  for (const e of entropies) for (const b of e) w.u8(b);
  return seededShuffle(sha256(w.toBytes()), 52);
}
