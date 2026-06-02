/**
 * 针对真实实现的一致性 E2E（REQ-DEP-003, RT-02 F2）。fakes 通过的那套相同契约一致性测试
 * 套件（packages/adapters/test/conformance.test.ts）在此针对真实的
 * verifiable-accounting 适配器运行——证明真实实现满足相同的不变量
 * （INV-VA-2 边界 + Merkle 包含/篡改拒绝），而不仅仅是一个符合一致性的 fake。
 */

import { runVAConformance } from '@bsv-poker/adapters/conformance';
import { realVAContract } from '@bsv-poker/adapters/real-va';

async function main(): Promise<void> {
  await runVAConformance(realVAContract());
  console.log('[conformance-real] VA: the REAL @vaa/merkle adapter passes the same conformance suite as the fake.');
  console.log('\n[conformance-real] PASS — REQ-DEP-003 satisfied for VA against the real implementation.');
}

main().then(() => process.exit(0), (e) => { console.error('[conformance-real] FAIL:', (e as Error).message); process.exit(1); });
