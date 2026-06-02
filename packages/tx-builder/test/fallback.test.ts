import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BranchBinding } from '@bsv-poker/protocol-types';
import { evaluate, genKeyPair, signPreimage, fundingLocking } from '@bsv-poker/script-templates-ts';
import {
  type Contributor,
  type FundingRef,
  presignFallbackGraph,
  buildTimeoutRefund,
  refundOutputs,
  sighashMessage,
} from '../src/index.ts';

const BIND: BranchBinding = {
  gid: '11'.repeat(8),
  rulesetHash: '22'.repeat(32),
  round: 0,
  stateHash: '33'.repeat(32),
  actingSeat: -1,
  successorCommitment: '44'.repeat(32),
};

test('pre-signed timeout-refund validates INSIDE the interpreter (N-of-N funding → refund)', () => {
  const keys = [genKeyPair(), genKeyPair(), genKeyPair()];
  const contributors: Contributor[] = keys.map((k, i) => ({ pub: k.pubCompressed, amount: 100 * (i + 1) })); // 100,200,300
  const lock = fundingLocking(BIND, keys.map((k) => k.pubCompressed));
  const funding: FundingRef = { txid: 'ab'.repeat(32), vout: 0, value: 600, scriptCode: lock };

  const pre = presignFallbackGraph(BIND, funding, contributors, keys.map((k) => (_i, msg) => signPreimage(msg, k.priv)), { fee: 10 });

  // The pre-signed refund satisfies the N-of-N CHECKMULTISIG inside the real interpreter.
  assert.equal(evaluate(pre.scriptSig, lock, { sighashPreimage: pre.sighash }).ok, true);
});

test('refund outputs conserve value (sum == pot − fee) and return each stake proportionally', () => {
  const keys = [genKeyPair(), genKeyPair(), genKeyPair()];
  const contributors: Contributor[] = keys.map((k, i) => ({ pub: k.pubCompressed, amount: [100, 200, 300][i]! }));
  const outs = refundOutputs(BIND, contributors, 10);
  assert.equal(outs.reduce((s, o) => s + o.satoshis, 0), 590, 'outputs sum to pot − fee');
  // proportional: tail get floor(amount/total*payable); first absorbs remainder
  assert.equal(outs[1]!.satoshis, Math.floor((200 / 600) * 590));
  assert.equal(outs[2]!.satoshis, Math.floor((300 / 600) * 590));
});

test('timeout-refund carries a LOW non-final sequence so a cooperative spend supersedes it', () => {
  const keys = [genKeyPair(), genKeyPair()];
  const contributors: Contributor[] = keys.map((k) => ({ pub: k.pubCompressed, amount: 500 }));
  const lock = fundingLocking(BIND, keys.map((k) => k.pubCompressed));
  const tx = buildTimeoutRefund(BIND, { txid: 'cd'.repeat(32), vout: 0, value: 1000, scriptCode: lock }, contributors, { fee: 4 });
  assert.equal(tx.inputs[0]!.sequence, 1);
  assert.ok(tx.inputs[0]!.sequence < 0xffffffff, 'non-final → replaceable by the cooperative settlement');
});

test('tampering a pre-signed refund output breaks the signatures (interpreter rejects)', () => {
  const keys = [genKeyPair(), genKeyPair()];
  const contributors: Contributor[] = keys.map((k) => ({ pub: k.pubCompressed, amount: 250 }));
  const lock = fundingLocking(BIND, keys.map((k) => k.pubCompressed));
  const funding: FundingRef = { txid: 'ef'.repeat(32), vout: 0, value: 500, scriptCode: lock };
  const pre = presignFallbackGraph(BIND, funding, contributors, keys.map((k) => (_i, msg) => signPreimage(msg, k.priv)), { fee: 2 });

  // Re-sighash a tx with a different payout → the pre-signed sigs no longer verify.
  const tampered = buildTimeoutRefund(BIND, funding, [{ ...contributors[0]!, amount: 9999 }, contributors[1]!], { fee: 2 });
  const badMsg = sighashMessage(tampered, 0, lock, funding.value);
  assert.equal(evaluate(pre.scriptSig, lock, { sighashPreimage: badMsg }).ok, false);
});
