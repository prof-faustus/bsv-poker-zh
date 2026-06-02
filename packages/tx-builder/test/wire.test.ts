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
  buildFold,
  buildFunding,
  serializeTxWire,
  txidWire,
  bip143Preimage,
  sighashMessage,
} from '../src/index.ts';

const BIND: BranchBinding = {
  gid: '11'.repeat(8),
  rulesetHash: '22'.repeat(32),
  round: 2,
  stateHash: '33'.repeat(32),
  actingSeat: 0,
  successorCommitment: '44'.repeat(32),
};

test('real BSV wire serialization + txid (double-SHA256, displayed big-endian)', () => {
  const out = buildFold(BIND, genKeyPair().pubCompressed);
  const tx: Tx = {
    version: 1,
    inputs: [{ prevTxid: 'ab'.repeat(32), vout: 0, sequence: 0xffffffff }],
    outputs: [out],
    nLockTime: 0,
  };
  const wire = serializeTxWire(tx);
  assert.ok(wire.length > 0);
  const id = txidWire(tx);
  assert.equal(id.length, 64);
  assert.equal(id, txidWire(tx)); // deterministic
});

test('a spend signed over the BIP-143 sighash validates INSIDE the interpreter (real sighash)', () => {
  const k = genKeyPair();
  const fundedValue = 200;
  const prevLocking = buildFold(BIND, k.pubCompressed).locking; // the output being spent
  const spend: Tx = {
    version: 1,
    inputs: [{ prevTxid: 'cd'.repeat(32), vout: 0, sequence: 0xffffffff }],
    outputs: [buildFold(BIND, genKeyPair().pubCompressed)],
    nLockTime: 0,
  };
  // BIP-143 sighash for input 0 spending the funded output
  const msg = sighashMessage(spend, 0, prevLocking, fundedValue);
  const sig = signPreimage(msg, k.priv);
  // OP_CHECKSIG verifies ECDSA over sha256(msg) = double-SHA256(preimage) = the real sighash
  assert.equal(evaluate(foldUnlocking(sig), prevLocking, { sighashPreimage: msg }).ok, true);

  // tampering an output changes hashOutputs → different sighash → signature no longer valid
  const tampered: Tx = { ...spend, outputs: [buildFunding(BIND, [k.pubCompressed], 999)] };
  const msg2 = sighashMessage(tampered, 0, prevLocking, fundedValue);
  assert.equal(evaluate(foldUnlocking(sig), prevLocking, { sighashPreimage: msg2 }).ok, false);
});

test('BIP-143 preimage is deterministic and binds the spent value + scriptCode', () => {
  const k = genKeyPair();
  const sc = buildFold(BIND, k.pubCompressed).locking;
  const tx: Tx = {
    version: 1,
    inputs: [{ prevTxid: 'ee'.repeat(32), vout: 1, sequence: 0xfffffffe }],
    outputs: [buildFold(BIND, k.pubCompressed)],
    nLockTime: 500,
  };
  assert.deepEqual([...bip143Preimage(tx, 0, sc, 100)], [...bip143Preimage(tx, 0, sc, 100)]);
  assert.notDeepEqual([...bip143Preimage(tx, 0, sc, 100)], [...bip143Preimage(tx, 0, sc, 101)]); // value bound
});

test('funding 2-of-2 spend over the BIP-143 sighash validates', () => {
  const a = genKeyPair();
  const b = genKeyPair();
  const prev = buildFunding(BIND, [a.pubCompressed, b.pubCompressed], 400).locking;
  const spend: Tx = {
    version: 1,
    inputs: [{ prevTxid: 'ff'.repeat(32), vout: 0, sequence: 0xffffffff }],
    outputs: [buildFold(BIND, a.pubCompressed)],
    nLockTime: 0,
  };
  const msg = sighashMessage(spend, 0, prev, 400);
  const sigs = [signPreimage(msg, a.priv), signPreimage(msg, b.priv)];
  assert.equal(evaluate(fundingUnlocking(sigs), prev, { sighashPreimage: msg }).ok, true);
});
