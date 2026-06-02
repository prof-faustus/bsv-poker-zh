import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shuffleKeyPoint, SECP256K1_P } from '../src/templates.ts';

// Direct canonical square root: a^((p+1)/4) mod p (p ≡ 3 mod 4) — the ONE branch the build fixes.
function canonicalRoot(a: bigint): bigint {
  let r = 1n;
  let b = a % SECP256K1_P;
  let e = (SECP256K1_P + 1n) / 4n;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % SECP256K1_P;
    b = (b * b) % SECP256K1_P;
    e >>= 1n;
  }
  return r;
}

test('shuffle-key point lies on secp256k1 (y² = x³ + 7) with x = s (REQ-CRYPTO-007)', () => {
  for (const s of [2n, 7n, 12345n, 0xdeadbeefn]) {
    const p = shuffleKeyPoint(s);
    if (p === null) continue; // s not a valid x (a not a QR)
    assert.equal(p.x, s);
    const rhs = (((s * s) % SECP256K1_P) * s + 7n) % SECP256K1_P;
    assert.equal((p.y * p.y) % SECP256K1_P, rhs);
  }
});

test('the square-root branch is FIXED and consistent (same s → same canonical root)', () => {
  for (const s of [2n, 7n, 12345n]) {
    const p = shuffleKeyPoint(s);
    if (p === null) continue;
    assert.equal(p.y, shuffleKeyPoint(s)!.y, 'deterministic');
    const rhs = (((s * s) % SECP256K1_P) * s + 7n) % SECP256K1_P;
    assert.equal(p.y, canonicalRoot(rhs), 'always the a^((p+1)/4) branch, never the p−y root');
    assert.notEqual(p.y, (SECP256K1_P - p.y) % SECP256K1_P, 'the two roots are distinct; we pick one');
  }
});

test('a scalar whose a is not a quadratic residue yields no point (null), not a wrong branch', () => {
  // Search for an s that is not a valid x; assert it returns null rather than a bogus point.
  let sawNull = false;
  for (let s = 3n; s < 40n; s++) {
    if (shuffleKeyPoint(s) === null) { sawNull = true; break; }
  }
  assert.ok(sawNull, 'non-QR scalars are rejected (null), keeping the branch choice well-defined');
});
