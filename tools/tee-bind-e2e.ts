/**
 * TEE 绑定 E2E（REQ-APP-230/231/240）—— 证明平台的撤销/审计链路是针对
 * 真实的 cloud-TEE `revocable-nft-tee` 实现运行的：枚举证明（attestation）后端，并且一个
 * 可撤销令牌的完整生命周期（铸造 → 成员访问 → REVOKE → 拒绝访问 → 内容密钥
 * 销毁）通过真实的 enclave/CVM 驱动执行。这是平台用来对密封内容
 * 进行访问门禁 + 撤销的 TEE 集成点，而非一致性 fake。
 */

import assert from 'node:assert/strict';
import { RealTee } from '@bsv-poker/adapters/real-tee';

async function main(): Promise<void> {
  const tee = new RealTee();

  const backends = tee.backends();
  for (const b of ['cvm-sev-snp', 'cvm-tdx', 'enclave-sgx', 'tee-hsm']) {
    assert.ok(backends.includes(b), `TEE backend ${b} is selectable`);
  }
  console.log(`[tee-bind] attestation backends: ${backends.join(', ')}`);

  const lc = tee.lifecycle();
  assert.match(lc.tokenId, /^[0-9a-f]{16,}$/, 'a token was minted');
  assert.equal(lc.memberAccess, true, 'a member can access gated content before revocation');
  assert.equal(lc.revokedDenied, true, 'access is DENIED after revocation');
  assert.equal(lc.keyBurned, true, 'the content key is burned on revocation (crypto-shredding)');
  console.log(`[tee-bind] token ${lc.tokenId.slice(0, 16)}… : member access → REVOKE → denied → key burned ✓`);

  console.log('\n[tee-bind] PASS — revocation/audit track bound to the REAL cloud-TEE revocable-nft-tee (REQ-APP-230/231/240).');
}

main().then(() => process.exit(0), (e) => { console.error('[tee-bind] FAIL:', (e as Error).message); process.exit(1); });
