import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OP,
  evaluate,
  serializeScript,
  scriptSizeBytes,
  containsOpReturn,
  genKeyPair,
  signPreimage,
  bindingBytes,
  branchBindingPrefix,
  fundingLocking,
  fundingUnlocking,
  revealOrTimeoutLocking,
  revealUnlocking,
  timeoutRefundUnlocking,
  foldLocking,
  foldUnlocking,
  settlementLocking,
  settlementUnlocking,
  revealCommitment,
  revealPreimage,
  type Script,
} from '../src/index.ts';
import type { BranchBinding } from '@bsv-poker/protocol-types';

const BIND: BranchBinding = {
  gid: 'aa'.repeat(8),
  rulesetHash: 'bb'.repeat(32),
  round: 4,
  stateHash: 'cc'.repeat(32),
  actingSeat: 1,
  successorCommitment: 'dd'.repeat(32),
};

// 在这些解释器层面的测试中，用一个固定的 sighash preimage 代替交易的 sighash。
const SIGHASH = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4]);
const ctx = { sighashPreimage: SIGHASH };

test('fold: valid signature spend is ACCEPTED by the interpreter (positive, P9)', () => {
  const k = genKeyPair();
  const locking = foldLocking(BIND, k.pubCompressed);
  const unlocking = foldUnlocking(signPreimage(SIGHASH, k.priv));
  assert.equal(evaluate(unlocking, locking, ctx).ok, true);
});

test('fold: wrong key fails INSIDE the interpreter (negative, P9 — not a wrapper guard)', () => {
  const k = genKeyPair();
  const wrong = genKeyPair();
  const locking = foldLocking(BIND, k.pubCompressed);
  const unlocking = foldUnlocking(signPreimage(SIGHASH, wrong.priv));
  const r = evaluate(unlocking, locking, ctx);
  assert.equal(r.ok, false);
});

test('fold: tampered sighash fails inside the interpreter', () => {
  const k = genKeyPair();
  const locking = foldLocking(BIND, k.pubCompressed);
  const unlocking = foldUnlocking(signPreimage(SIGHASH, k.priv));
  const tampered = { sighashPreimage: Uint8Array.from([9, 9, 9, 9]) };
  assert.equal(evaluate(unlocking, locking, tampered).ok, false);
});

test('funding N-of-N multisig: full set of signatures accepted; missing one rejected', () => {
  const ks = [genKeyPair(), genKeyPair()];
  const locking = fundingLocking(BIND, ks.map((k) => k.pubCompressed));
  const sigs = ks.map((k) => signPreimage(SIGHASH, k.priv));
  assert.equal(evaluate(fundingUnlocking(sigs), locking, ctx).ok, true);
  // 2-of-2 只提供一个签名 → 在 CHECKMULTISIG 内部失败
  assert.equal(evaluate(fundingUnlocking([sigs[0]!]), locking, ctx).ok, false);
});

test('reveal-or-timeout: correct opening spends the reveal branch; wrong preimage fails inside', () => {
  const reveal = genKeyPair();
  const refund = genKeyPair();
  const blind = Uint8Array.from([7, 7, 7, 7]);
  const face = 42;
  const cmt = revealCommitment(face, blind);
  const locking = revealOrTimeoutLocking(BIND, cmt, reveal.pubCompressed, refund.pubCompressed);

  // 正向：有效的开启 + reveal-key 签名
  const good = revealUnlocking(signPreimage(SIGHASH, reveal.priv), revealPreimage(face, blind));
  assert.equal(evaluate(good, locking, ctx).ok, true);

  // 负向：错误的 preimage → OP_EQUALVERIFY 在解释器内部失败
  const badPre = revealUnlocking(signPreimage(SIGHASH, reveal.priv), revealPreimage(43, blind));
  assert.equal(evaluate(badPre, locking, ctx).ok, false);

  // timeout/refund 分支：refund 密钥对 ELSE 分支签名（到期在交易层面强制）
  const refundSpend = timeoutRefundUnlocking(signPreimage(SIGHASH, refund.priv));
  assert.equal(evaluate(refundSpend, locking, ctx).ok, true);
  // 用 reveal 密钥（错误）走 refund 分支会失败
  const badRefund = timeoutRefundUnlocking(signPreimage(SIGHASH, reveal.priv));
  assert.equal(evaluate(badRefund, locking, ctx).ok, false);
});

test('fair-play: committed key claims; a mismatched key fails INSIDE the interpreter (REQ-CRYPTO-006)', async () => {
  const { fairPlayCommitment, fairPlayLocking, fairPlayClaimUnlocking, fairPlayForfeitUnlocking } =
    await import('../src/templates.ts');
  const honest = genKeyPair();
  const cheat = genKeyPair();
  const refund = genKeyPair();
  const commitment = fairPlayCommitment(honest.pubCompressed);
  const locking = fairPlayLocking(BIND, commitment, refund.pubCompressed);

  // 诚实方揭示已承诺的密钥 + 有效签名 → 认领
  const ok = fairPlayClaimUnlocking(signPreimage(SIGHASH, honest.priv), honest.pubCompressed);
  assert.equal(evaluate(ok, locking, ctx).ok, true);

  // 使用了不同密钥的一方无法匹配 HASH160(commitment) → 在内部失败（没收）
  const bad = fairPlayClaimUnlocking(signPreimage(SIGHASH, cheat.priv), cheat.pubCompressed);
  assert.equal(evaluate(bad, locking, ctx).ok, false);

  // 没收/退款分支（到期在交易层面）向 refund 密钥付款
  const forfeit = fairPlayForfeitUnlocking(signPreimage(SIGHASH, refund.priv));
  assert.equal(evaluate(forfeit, locking, ctx).ok, true);
});

test('settlement: winner signature accepted', () => {
  const w = genKeyPair();
  const locking = settlementLocking(BIND, w.pubCompressed);
  assert.equal(evaluate(settlementUnlocking(signPreimage(SIGHASH, w.priv)), locking, ctx).ok, true);
});

test('OP_RETURN is banned: serialize throws, lint detects, interpreter fails', () => {
  const bad: Script = [Uint8Array.from([1, 2, 3]), OP.OP_RETURN];
  assert.equal(containsOpReturn(bad), true);
  assert.throws(() => serializeScript(bad), /OP_RETURN/);
  // 即便它到达了解释器，也会在其内部失败
  assert.equal(evaluate([], [OP.OP_1, OP.OP_RETURN], ctx).ok, false);
});

test('no template produces an OP_RETURN in its script (rule 2)', () => {
  const k = genKeyPair();
  const templates: Script[] = [
    branchBindingPrefix(BIND),
    fundingLocking(BIND, [k.pubCompressed]),
    revealOrTimeoutLocking(BIND, revealCommitment(1, Uint8Array.of(0)), k.pubCompressed, k.pubCompressed),
    foldLocking(BIND, k.pubCompressed),
    settlementLocking(BIND, k.pubCompressed),
  ];
  for (const t of templates) assert.equal(containsOpReturn(t), false);
});

test('CLTV/CSV are NO-OPS post-Genesis (REQ-TX-001): they enforce nothing', () => {
  const k = genKeyPair();
  // 以 CLTV/CSV 开头的脚本仍然纯粹基于签名进行验证。
  const locking: Script = [OP.OP_CHECKLOCKTIMEVERIFY, OP.OP_CHECKSEQUENCEVERIFY, k.pubCompressed, OP.OP_CHECKSIG];
  assert.equal(evaluate(foldUnlocking(signPreimage(SIGHASH, k.priv)), locking, ctx).ok, true);
});

test('byte-size measurement (REQ-TX-011 / §19.C): sizes are computed, not asserted from memory', () => {
  const k = genKeyPair();
  const sizes = {
    binding: scriptSizeBytes(branchBindingPrefix(BIND)),
    fold: scriptSizeBytes(foldLocking(BIND, k.pubCompressed)),
    funding2of2: scriptSizeBytes(fundingLocking(BIND, [k.pubCompressed, genKeyPair().pubCompressed])),
    revealOrTimeout: scriptSizeBytes(
      revealOrTimeoutLocking(BIND, revealCommitment(1, Uint8Array.of(0)), k.pubCompressed, k.pubCompressed),
    ),
  };
  // binding prefix = push(133 字节 binding) + OP_DROP。gid8+rh32+round4+sh32+seat1+succ32 = 109
  assert.equal(bindingBytes(BIND).length, 8 + 32 + 4 + 32 + 1 + 32);
  for (const [, v] of Object.entries(sizes)) assert.ok(v > 0 && Number.isInteger(v));
});

test('in-script EC fair-play: committed on-curve shuffle key verifies; cheats fail INSIDE the interpreter (REQ-CRYPTO-006/009, §19.C)', async () => {
  const {
    SECP256K1_P,
    shuffleKeyPoint,
    shuffleKeyCommitment,
    fairPlayEcLocking,
    fairPlayEcUnlocking,
  } = await import('../src/templates.ts');

  // 选取一个是合法洗牌密钥 x 坐标的标量（s^3+7 是 QR）
  let s = 12345678901234567890n;
  let pt = shuffleKeyPoint(s);
  while (!pt) {
    s += 1n;
    pt = shuffleKeyPoint(s);
  }
  // 该点确实在曲线上
  assert.equal((pt.y * pt.y) % SECP256K1_P, (((pt.x * pt.x % SECP256K1_P) * pt.x) % SECP256K1_P + 7n) % SECP256K1_P);

  const locking = fairPlayEcLocking(BIND, shuffleKeyCommitment(s));

  // 正向：揭示真正已承诺的密钥 + 其在曲线上的 y → 被接受
  assert.equal(evaluate(fairPlayEcUnlocking(pt.x, pt.y), locking, ctx).ok, true);

  // 作弊 1：一个 DIFFERENT 标量（承诺了不同的密钥）→ SHA256(x) 不匹配，在内部失败
  let s2 = s + 1000n;
  let pt2 = shuffleKeyPoint(s2);
  while (!pt2) {
    s2 += 1n;
    pt2 = shuffleKeyPoint(s2);
  }
  assert.equal(evaluate(fairPlayEcUnlocking(pt2.x, pt2.y), locking, ctx).ok, false);

  // 作弊 2：已承诺的 x 但一个不在曲线上的 FORGED y → 曲线检查在内部失败
  assert.equal(evaluate(fairPlayEcUnlocking(pt.x, pt.y + 1n), locking, ctx).ok, false);
});

test('interpreter big-integer ops: 256-bit OP_MUL/OP_MOD round-trip', async () => {
  const { encodeScriptNum, SECP256K1_P } = await import('../src/templates.ts');
  // (p-1) * 2 mod p == p-2  → 先产生 >256 位的中间结果，再做 OP_MOD
  const locking = [
    encodeScriptNum(SECP256K1_P - 1n),
    encodeScriptNum(2n),
    OP.OP_MUL,
    encodeScriptNum(SECP256K1_P),
    OP.OP_MOD,
    encodeScriptNum(SECP256K1_P - 2n),
    OP.OP_NUMEQUALVERIFY,
    OP.OP_1,
  ];
  assert.equal(evaluate([], locking, ctx).ok, true);
});
