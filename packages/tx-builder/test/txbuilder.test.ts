import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BranchBinding } from '@bsv-poker/protocol-types';
import {
  evaluate,
  genKeyPair,
  signPreimage,
  foldUnlocking,
  fundingUnlocking,
} from '@bsv-poker/script-templates-ts';
import {
  type Tx,
  buildFunding,
  buildFold,
  sighashPreimage,
  txid,
  withMaturity,
} from '../src/index.ts';

const BIND: BranchBinding = {
  gid: '11'.repeat(8),
  rulesetHash: '22'.repeat(32),
  round: 1,
  stateHash: '33'.repeat(32),
  actingSeat: 0,
  successorCommitment: '44'.repeat(32),
};

test('fold output spend validates through the interpreter using the tx sighash', () => {
  const k = genKeyPair();
  const out = buildFold(BIND, k.pubCompressed);
  const tx: Tx = {
    version: 1,
    inputs: [{ prevTxid: 'ab'.repeat(32), vout: 0, sequence: 0xffffffff }],
    outputs: [out],
    nLockTime: 0,
  };
  const preimage = sighashPreimage(tx, 0);
  const sig = signPreimage(preimage, k.priv);
  assert.equal(evaluate(foldUnlocking(sig), out.locking, { sighashPreimage: preimage }).ok, true);
  // 对一笔 DIFFERENT 交易（重放）的签名会在解释器内部失败
  const other = sighashPreimage({ ...tx, nLockTime: 5 }, 0);
  assert.equal(evaluate(foldUnlocking(signPreimage(other, k.priv)), out.locking, { sighashPreimage: preimage }).ok, false);
});

test('funding 2-of-2 spend validates with both signatures over the tx sighash', () => {
  const a = genKeyPair();
  const b = genKeyPair();
  const out = buildFunding(BIND, [a.pubCompressed, b.pubCompressed], 200);
  const tx: Tx = {
    version: 1,
    inputs: [{ prevTxid: 'cd'.repeat(32), vout: 1, sequence: 0xffffffff }],
    outputs: [out],
    nLockTime: 0,
  };
  const preimage = sighashPreimage(tx, 0);
  const sigs = [signPreimage(preimage, a.priv), signPreimage(preimage, b.priv)];
  assert.equal(evaluate(fundingUnlocking(sigs), out.locking, { sighashPreimage: preimage }).ok, true);
});

test('withMaturity sets tx-level nLockTime and non-final nSequence (REQ-TX-002, no in-script CLTV)', () => {
  const tx: Tx = {
    version: 1,
    inputs: [{ prevTxid: 'ee'.repeat(32), vout: 0, sequence: 0xffffffff }],
    outputs: [],
    nLockTime: 0,
  };
  const matured = withMaturity(tx, 850000);
  assert.equal(matured.nLockTime, 850000);
  assert.equal(matured.inputs[0]!.sequence, 0xfffffffe); // 非最终 → nLockTime 被强制
});

test('txid is a stable 32-byte double-SHA-256 hex', () => {
  const out = buildFold(BIND, genKeyPair().pubCompressed);
  const tx: Tx = { version: 1, inputs: [], outputs: [out], nLockTime: 0 };
  assert.equal(txid(tx).length, 64);
  assert.equal(txid(tx), txid(tx));
});
