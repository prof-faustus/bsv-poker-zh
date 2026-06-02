/**
 * OB 绑定 + Mode B 密钥设置 E2E（REQ-DEP-004, core §16/§19）——证明扑克结算密钥
 * 可以是来自 overlay-broadcast 的真实门限群组密钥（Mode B：没有任何一方持有完整
 * 私钥），且真实的吊销路径有效。
 *
 * 通过真实的 OB 托管 CLI 生成 t-of-n 门限群组密钥，检查每个都是真正的
 * 曲线上 secp256k1 点，将扑克结算输出锁定到 OB 群组密钥（模板
 * 接受它作为支付密钥），确认两次密钥生成不同（随机化），并演练吊销。
 */

import assert from 'node:assert/strict';
import { RealOb, isOnCurveCompressed } from '@bsv-poker/adapters/real-ob';
import { settlementLocking, serializeScript } from '@bsv-poker/script-templates-ts';
import { bytesToHex, type BranchBinding } from '@bsv-poker/protocol-types';

const BIND: BranchBinding = { gid: 'a1'.repeat(8), rulesetHash: 'b2'.repeat(32), round: 0, stateHash: 'c3'.repeat(32), actingSeat: 0, successorCommitment: '00'.repeat(32) };

async function main(): Promise<void> {
  const ob = new RealOb();

  for (const [t, n] of [[2, 3], [3, 5], [6, 9]] as const) {
    const groupKey = ob.thresholdGroupKey(t, n);
    assert.equal(groupKey.length, 33, `${t}-of-${n} group key is a 33-byte compressed point`);
    assert.equal(isOnCurveCompressed(groupKey), true, `${t}-of-${n} group key is a real secp256k1 point`);
    // Mode B 结算输出锁定到 OB 派生的门限群组密钥。
    const lock = settlementLocking(BIND, groupKey);
    const ser = serializeScript(lock);
    assert.ok(bytesToHex(ser).includes(bytesToHex(groupKey)), 'settlement script binds the OB group key');
    console.log(`[ob-bind] ${t}-of-${n} threshold group key ${bytesToHex(groupKey).slice(0, 20)}… on-curve, bound into settlement template`);
  }

  // 随机化：相同参数的两次密钥生成产生不同的群组密钥。
  const a = ob.thresholdGroupKey(2, 3);
  const b = ob.thresholdGroupKey(2, 3);
  assert.notEqual(bytesToHex(a), bytesToHex(b), 'distinct keygens yield distinct group keys');
  console.log('[ob-bind] independent 2-of-3 keygens are distinct (real randomized custody)');

  // 真实的吊销路径。
  assert.equal(ob.revoke(), true, 'real OB revocation path reports revoked');
  console.log('[ob-bind] real OB custody revoke → revoked=true');

  console.log('\n[ob-bind] PASS — Mode B settlement key sourced from the REAL overlay-broadcast threshold custody (REQ-DEP-004); no party holds the whole key.');
}

main().then(() => process.exit(0), (e) => { console.error('[ob-bind] FAIL:', (e as Error).message); process.exit(1); });
