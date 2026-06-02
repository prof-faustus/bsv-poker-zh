/**
 * 每个契约唯一的一致性测试套件（core §2.6，REQ-DEP-003）。每个函数都同时针对 fake
 * 与真实适配器运行；两者都必须通过，从而可证明 fake 与真实契约一致，并保证针对 fake 的绿色测试
 * 不会误判一个错误的引擎为正确。
 *
 * 这些是与实现无关的行为检查；遇到第一处违规即抛出。
 */

import assert from 'node:assert/strict';
import type { BSContract, CTContract, OBContract, VAContract } from './contracts.ts';

const bytes = (...xs: number[]): Uint8Array => Uint8Array.from(xs);

export async function runCTConformance(ct: CTContract): Promise<void> {
  // 熵的承诺/揭示在不泄露的前提下完成绑定（core §4.1，REQ-CRYPTO-002）。
  const secret = bytes(1, 2, 3, 4);
  const commitment = await ct.entropyCommit(secret);
  assert.equal(typeof commitment, 'string');
  assert.ok(commitment.length > 0);
  assert.equal(await ct.entropyReveal(commitment, secret), true, 'correct reveal accepts');
  assert.equal(await ct.entropyReveal(commitment, bytes(9, 9)), false, 'wrong reveal rejects');

  // 洗牌为每张牌产生一个合并密钥，并给出稳定的顺序承诺（INV-CT-1）。
  const input = {
    deckId: 'deck-0',
    partyPubKeys: ['02aa', '03bb'],
    partyEntropy: [bytes(7, 7, 7, 7), bytes(8, 8, 8, 8)],
    deckSize: 52,
  };
  const r1 = await ct.runShuffle(input);
  assert.equal(r1.combinedKeys.length, 52, 'one combined key per card');
  assert.equal(new Set(r1.combinedKeys).size, 52, 'combined keys are distinct');
  const r2 = await ct.runShuffle(input);
  assert.equal(r1.orderCommitment, r2.orderCommitment, 'shuffle is deterministic in its inputs');
  assert.equal(r1.seed, r2.seed);

  // 隐藏/揭示开启（core §4.5/§4.6）。
  const blind = bytes(5, 6, 7, 8);
  const cmt = await ct.conceal('deck-0', 17, 42, blind);
  assert.equal(await ct.verifyReveal(cmt, 42, blind), true, 'correct opening verifies');
  assert.equal(await ct.verifyReveal(cmt, 43, blind), false, 'wrong face fails');
  assert.equal(await ct.verifyReveal(cmt, 42, bytes(0)), false, 'wrong blind fails');
}

export async function runBSConformance(bs: BSContract): Promise<void> {
  const { txid, status } = await bs.nodeBroadcast('deadbeef');
  assert.equal(status, 'accepted');
  assert.equal(await bs.nodeOutpointStatus(txid, 0), 'unspent');
  assert.equal(await bs.nodeOutpointStatus('00'.repeat(32), 0), 'unknown');

  // 通道以固定的 1 聪保证金开启（INV-BS-2）。
  const cid = await bs.channelOpen({
    participants: ['02aa', '03bb'],
    granularityK: 1000,
    bondSats: 1,
  });
  assert.ok(cid.length > 0);

  // Q* 整聪对账在守恒总额的同时不写出任何带小数的输出（INV-BS-1）。
  const out = bs.reconcileQstar([1500, 2500, 1000], 1000);
  assert.ok(out.every((x) => Number.isInteger(x)), 'all outputs are whole satoshis');
  assert.equal(
    out.reduce((s, x) => s + x, 0),
    5,
    'total whole-satoshi conserved (5000 micro / k=1000)',
  );
}

export async function runVAConformance(va: VAContract): Promise<void> {
  assert.match(va.boundary, /never truth-at-origin/i, 'INV-VA-2 boundary surfaced');
  const records = ['r0', 'r1', 'r2', 'r3', 'r4'];
  for (let i = 0; i < records.length; i++) {
    const bundle = await va.merkleProve(records, i);
    assert.equal(await va.merkleVerify(bundle), true, `inclusion proof verifies for ${i}`);
    // 篡改 → 失败
    const bad = { ...bundle, leaf: bundle.leaf.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) };
    assert.equal(await va.merkleVerify(bad), false, `tampered leaf fails for ${i}`);
  }
}

export async function runOBConformance(ob: OBContract): Promise<void> {
  const key = 'cafe1234';
  const wrapped = await ob.wrap(key, '02aa');
  assert.notEqual(wrapped, key, 'wrapped differs from raw key (never plaintext)');
  assert.equal(await ob.unwrap(wrapped, 'priv'), key, 'unwrap recovers the key');

  // 撤销 = 未花费的过期输出（INV-OB-2）。
  assert.equal(await ob.isRevoked('sess@100', 50), false, 'not revoked before expiry');
  assert.equal(await ob.isRevoked('sess@100', 150), true, 'revoked after expiry');

  // 门限拆分返回 n 份。
  const shares = await ob.thresholdSplit('00ff', 2, 3);
  assert.equal(shares.length, 3);
  assert.equal(new Set(shares).size, 3, 'shares are distinct');
  await assert.rejects(ob.thresholdSplit('00', 4, 3), /bad threshold/);
}
