import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Variant } from '@bsv-poker/protocol-types';
import { sha256, ByteWriter } from '@bsv-poker/protocol-types';
import { playOfflineHand, offlineRuleset } from '../src/offline.ts';

/** Deterministic 52-card shuffle from a seed (no Math.random). */
function deck(seed: number): Card[] {
  const perm = Array.from({ length: 52 }, (_, i) => i);
  let counter = 0;
  let pool: number[] = [];
  const draw = (): number => {
    if (pool.length === 0) {
      const w = new ByteWriter();
      w.u32(seed).u32(counter++);
      const h = sha256(w.toBytes());
      for (let i = 0; i + 4 <= h.length; i += 4) pool.push(((h[i]! << 24) | (h[i + 1]! << 16) | (h[i + 2]! << 8) | h[i + 3]!) >>> 0);
    }
    return pool.shift()!;
  };
  for (let i = 51; i > 0; i--) {
    const j = draw() % (i + 1);
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  return perm;
}

const VARIANTS: Variant[] = ['holdem', 'omaha', 'stud', 'draw', 'razz'];

test('every variant plays a full hand to completion vs the universal bot (solo practice)', () => {
  for (const v of VARIANTS) {
    const seats = [
      { seat: 0, stack: 200 },
      { seat: 1, stack: 200 },
    ];
    const final = playOfflineHand(v, offlineRuleset(v, 2), seats, deck(v.length * 7 + 1));
    assert.equal(final.handComplete, true, `${v}: hand should complete`);
    // chips are conserved across the hand (no value created/destroyed)
    const total = final.seats.reduce((a, s) => a + s.stack, 0);
    assert.equal(total, 400, `${v}: chips conserved`);
  }
});

test('3-handed completes for the blind variants (multi-way offline)', () => {
  for (const v of ['holdem', 'omaha', 'draw'] as Variant[]) {
    const seats = [
      { seat: 0, stack: 200 },
      { seat: 1, stack: 200 },
      { seat: 2, stack: 200 },
    ];
    const final = playOfflineHand(v, offlineRuleset(v, 3), seats, deck(99 + v.length));
    assert.equal(final.handComplete, true, `${v} 3-handed should complete`);
    assert.equal(final.seats.reduce((a, s) => a + s.stack, 0), 600, `${v}: chips conserved`);
  }
});
