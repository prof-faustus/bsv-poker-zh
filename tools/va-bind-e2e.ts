/**
 * VA 绑定 E2E（REQ-DEP-004, core §17）—— 证明扑克审计轨迹由真实的
 * verifiable-accounting-chain Merkle 实现锚定，而非一致性 fake。
 *
 * 构建每手对局的结算审计记录，通过真实的 `@vaa/*` 库将其锚定到一个 Merkle 根，
 * 证明某条记录的包含性，通过真实的 VA 校验器验证它，并表明
 * 篡改一条记录（伪造的结算）会破坏其针对已锚定根的包含性。
 */

import assert from 'node:assert/strict';
import { RealVa } from '@bsv-poker/adapters/real-va';

const enc = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o));

async function main(): Promise<void> {
  const va = new RealVa();

  // 平台会发布的每手对局审计记录（gid、获胜者、底池、结算 txid）。
  const records = [
    enc({ hand: 1, gid: 'a1'.repeat(8), winnerSeat: 0, pot: 4999998000, txid: '0585821c'.repeat(8) }),
    enc({ hand: 2, gid: 'a1'.repeat(8), winnerSeat: 3, pot: 120000, txid: 'deadbeef'.repeat(8) }),
    enc({ hand: 3, gid: 'a1'.repeat(8), winnerSeat: 1, pot: 86000, txid: 'feedface'.repeat(8) }),
    enc({ hand: 4, gid: 'a1'.repeat(8), winnerSeat: 2, pot: 240000, txid: 'cafebabe'.repeat(8) }),
    enc({ hand: 5, gid: 'a1'.repeat(8), winnerSeat: 0, pot: 51000, txid: 'abad1dea'.repeat(8) }),
  ];

  const root = await va.anchor(records);
  console.log(`[va-bind] anchored ${records.length} hand records → real VA Merkle root ${root.slice(0, 20)}…`);
  assert.match(root, /^[0-9a-f]{64}$/, 'root is a 32-byte VA hash');

  // 通过真实库证明 + 验证第 2 手对局的包含性。
  const proof = await va.prove(records, 1);
  assert.equal(proof.rootHex, root, 'proof carries the anchored root');
  assert.equal(await va.verify(proof), true, 'real VA verifier confirms inclusion of hand #2');
  console.log(`[va-bind] hand #2 inclusion proof (${proof.siblingsHex.length} siblings) VERIFIED by real VA`);

  // 篡改：伪造结算（不同的获胜者）→ 其叶子改变 → 包含性失败。
  const forged = [...records];
  forged[1] = enc({ hand: 2, gid: 'a1'.repeat(8), winnerSeat: 9, pot: 120000, txid: 'deadbeef'.repeat(8) });
  const forgedProof = await va.prove(forged, 1);
  assert.notEqual(forgedProof.rootHex, root, 'forged record yields a different root');
  // 伪造的叶子针对诚实的已锚定根必须验证失败。
  assert.equal(await va.verify({ ...forgedProof, rootHex: root }), false, 'forged settlement is rejected against the honest root');
  console.log('[va-bind] forged settlement (winnerSeat 3→9) REJECTED against the honest anchored root');

  console.log('\n[va-bind] PASS — poker audit trail anchored + verified by the REAL verifiable-accounting Merkle library (REQ-DEP-004).');
}

main().then(() => process.exit(0), (e) => { console.error('[va-bind] FAIL:', (e as Error).message); process.exit(1); });
