/**
 * 微下注 E2E（app §A23, REQ-WALLET-005, REQ-DEP-004），针对真实的
 * bonded-subsat-channel 实现：开启一个 2 方通道（k 个子单位，1-sat 押金），
 * 施加亚聪转账，以整数聪的 Q* 结算进行协作关闭（绝不出现
 * 分数输出——INV-BS-1），并演示一次争议关闭会没收
 * 违规方固定的 1-sat 押金（INV-BS-2）。
 */

import assert from 'node:assert/strict';
import { RealBondedChannel } from '@bsv-poker/adapters/real-channel';

const NODE_DIR = process.env.BSV_NODE_DIR ?? 'D:\\claude\\ACM 01\\bonded-subsat-channel';

function main(): void {
  const ch = new RealBondedChannel(NODE_DIR);

  console.log('[microbet-e2e] opening a real bonded sub-sat channel: 2 parties, k=1000, S=10, bond=1…');
  ch.open({ parties: 2, k: 1000, funded: 10, bond: 1 });

  console.log('[microbet-e2e] applying sub-satoshi transfers (party 0 → party 1)…');
  const version = ch.transfer([
    [0, 1, 2500],
    [0, 1, 1500],
  ]);
  assert.ok(version >= 1, 'transfers advanced the channel version');
  console.log(`[microbet-e2e] channel version after transfers = ${version}`);

  console.log('[microbet-e2e] cooperative close with whole-satoshi Q* settlement…');
  const close = ch.close();
  console.log(`[microbet-e2e] payouts (whole sats incl. bond) = [${close.payouts.join(', ')}]; total = ${close.totalSettled}; tx ${close.txSizeBytes} B`);
  assert.ok(close.payouts.length === 2, 'a payout per party');
  assert.ok(close.payouts.every((x) => Number.isInteger(x)), 'all payouts are WHOLE satoshis (INV-BS-1)');
  assert.equal(
    close.payouts.reduce((a, b) => a + b, 0),
    close.totalSettled,
    'payouts conserve the total settled',
  );

  console.log('[microbet-e2e] contested close (party 1 broadcasts a stale state → forfeits its bond)…');
  const out = ch.contested(1);
  assert.match(out, /bond forfeited: 1 satoshi/i);
  console.log('[microbet-e2e] ' + out.split('\n').find((l) => /bond forfeited/.test(l))!.trim());

  console.log('\n[microbet-e2e] PASS — real bonded sub-sat channel: sub-satoshi transfers, whole-satoshi Q* close, 1-sat bond forfeiture.');
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('[microbet-e2e] FAIL:', (e as Error).message);
  process.exit(1);
}
