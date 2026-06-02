/**
 * Mode B（在线门限签名）E2E——core §4.3/§9.3, REQ-CRYPTO-008/REQ-TX-012, RT-02 F1。
 *
 * 来自真实 overlay-broadcast GG20 引擎的 t-of-n 法定人数，在不重建群组私钥的前提下，
 * 在群组密钥下产生一个标准 ECDSA 签名。随后我们证明该签名
 * 被平台真实 Script interpreter 的 OP_CHECKSIG 在群组
 * 密钥下接受——即一个 Mode B 结算输出（锁定到门限群组密钥）可被
 * 门限签名花费，与单密钥花费完全一样。这弥补了 Mode B 漏洞：没有
 * 任何一方持有完整密钥，而花费仍在共识验证器上通过验证。
 *
 * 约定桥接：GG20 直接对 32 字节 prehash 签名；interpreter 的 OP_CHECKSIG 验证
 * 对 sha256(sighashPreimage) 的 ECDSA。因此我们对 prehash = sha256(preimage) 签名并把
 * `preimage` 交给 interpreter；两个摘要一致，签名得以验证。
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { RealOb } from '@bsv-poker/adapters/real-ob';
import { OP, evaluate, type Script } from '@bsv-poker/script-templates-ts';
import { sha256, bytesToHex } from '@bsv-poker/protocol-types';

async function main(): Promise<void> {
  const ob = new RealOb();

  for (const [t, n] of [[2, 3], [3, 5]] as const) {
    // 一个结算“消息”（代表群组密钥支付的 BIP-143 sighash preimage）。
    const preimage = Uint8Array.from(randomBytes(48));
    const prehash = sha256(preimage); // OP_CHECKSIG（ECDSA-over-sha256）实际将检查的内容

    const { groupKey, sig } = ob.thresholdSign(t, n, prehash);
    assert.equal(groupKey.length, 33, 'group key is a compressed point');

    // Mode B 结算锁 = pay-to-(门限群组密钥)；由门限签名花费。
    const locking: Script = [groupKey, OP.OP_CHECKSIG];
    const unlocking: Script = [sig];

    const ok = evaluate(unlocking, locking, { sighashPreimage: preimage }).ok;
    assert.equal(ok, true, `${t}-of-${n} threshold signature must satisfy OP_CHECKSIG under the group key`);

    // 篡改：任何其他消息都必须失败——门限签名绑定到此 preimage。
    const bad = evaluate(unlocking, locking, { sighashPreimage: Uint8Array.from(randomBytes(48)) }).ok;
    assert.equal(bad, false, 'a different message must not verify');

    console.log(`[mode-b] ${t}-of-${n}: threshold ECDSA under group ${bytesToHex(groupKey).slice(0, 18)}… ACCEPTED by OP_CHECKSIG; tamper rejected; key never reconstructed`);
  }

  console.log('\n[mode-b] PASS — Mode B online threshold signing: a t-of-n quorum (real GG20) signs a Mode B settlement spend that the real Script interpreter accepts under the group key (RT-02 F1 closed).');
}

main().then(() => process.exit(0), (e) => { console.error('[mode-b] FAIL:', (e as Error).message); process.exit(1); });
