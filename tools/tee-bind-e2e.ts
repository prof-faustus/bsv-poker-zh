/**
 * TEE binding E2E (REQ-APP-230/231/240) — proves the platform's revocation/audit track runs against
 * the REAL cloud-TEE `revocable-nft-tee` implementation: attestation backends are enumerated, and a
 * revocable token's full lifecycle (mint → member access → REVOKE → access denied → content key
 * burned) executes through the real enclave/CVM-backed driver. This is the TEE integration point the
 * platform uses to gate + revoke access to sealed content, not a conformant fake.
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
