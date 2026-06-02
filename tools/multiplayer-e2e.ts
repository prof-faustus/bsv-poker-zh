/**
 * 真实多人 E2E（core §8, REQ-TEST-002 跨客户端一致）。启动中继 +
 * 索引器，然后运行两个独立的 NetworkedTableClient（Alice 座位 0，Bob 座位 1），它们
 * 仅通过中继通道交换各自的熵 commit/reveal 和下注动作，各自
 * 通过自己的引擎推导状态。当且仅当两个客户端收敛到
 * 逐字节相同的最终状态哈希时测试通过——证明中继仅作传输，真相是
 * 客户端重建的 tx 集合（P2/P3）。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Action, LegalActions, Ruleset } from '@bsv-poker/protocol-types';
import { RelayClient, NetworkedTableClient } from '@bsv-poker/app-services';

const ROOT = process.cwd();
const children: ChildProcess[] = [];
const isWin = process.platform === 'win32';

// 构建一个独立的二进制并直接运行它，使 kill() 能停止服务器（不留下孤儿僵尸进程）。
function startService(dir: string, addr: string, bin: string): void {
  const exe = isWin ? `${bin}.exe` : bin;
  const b = spawnSync('go', ['build', '-o', exe, '.'], { cwd: join(ROOT, dir), stdio: 'inherit' });
  if (b.status !== 0) throw new Error(`go build -o failed in ${dir}`);
  children.push(spawn(join(ROOT, dir, exe), ['-addr', addr], { stdio: 'ignore' }));
}
async function waitHealthy(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* 尚未启动 */
    }
    if (Date.now() > deadline) throw new Error(`not healthy: ${url}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

const RULES: Ruleset = {
  variant: 'holdem',
  bettingStructure: 'NL',
  forcedBetModel: 'blinds',
  seats: 2,
  blinds: { smallBlind: 1, bigBlind: 2, ante: 0, bringIn: 0 },
  minBuyIn: 100,
  maxBuyIn: 200,
  timeouts: { decisionMs: 30000, recoveryMs: 120000 },
  signingMode: 'A',
  currency: 'play-regtest',
  suitTiebreakHouseRule: false,
  hiLo: false,
};

// 被动策略：能 check 就 check，否则 call，否则 fold——驱动牌局走到摊牌。
const passive = (legal: LegalActions, seat: number): Action => {
  if (legal.check) return { kind: 'check', seat, amount: 0 };
  if (legal.call) return { kind: 'call', seat, amount: legal.call.amount };
  return { kind: 'fold', seat, amount: 0 };
};

async function main(): Promise<void> {
  console.log('[mp-e2e] starting relay (:8091) + indexer (:8092)…');
  startService('apps/relay-go', '127.0.0.1:8091', 'relay-go');
  startService('apps/indexer-go', '127.0.0.1:8092', 'indexer-go');
  await waitHealthy('http://127.0.0.1:8091/healthz', 30000);
  await waitHealthy('http://127.0.0.1:8092/healthz', 30000);

  const relayA = new RelayClient('http://127.0.0.1:8091');
  const relayB = new RelayClient('http://127.0.0.1:8091');
  const tableId = `mp-table-${Date.now()}`;
  await relayA.createTable(tableId, 'Multiplayer HU');
  const seats = [
    { seat: 0, stack: 100 },
    { seat: 1, stack: 100 },
  ];

  const alice = new NetworkedTableClient({
    relay: relayA,
    tableId,
    mySeat: 0,
    seats,
    ruleset: RULES,
    entropy: Uint8Array.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 1) % 251)),
  });
  const bob = new NetworkedTableClient({
    relay: relayB,
    tableId,
    mySeat: 1,
    seats,
    ruleset: RULES,
    entropy: Uint8Array.from(Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 251)),
  });

  console.log('[mp-e2e] Alice and Bob playing a full hand over the relay…');
  const [ra, rb] = await Promise.all([alice.runHand(passive), bob.runHand(passive)]);

  console.log(`[mp-e2e] Alice final stateHash: ${ra.stateHash.slice(0, 24)}…`);
  console.log(`[mp-e2e] Bob   final stateHash: ${rb.stateHash.slice(0, 24)}…`);
  assert.equal(ra.stateHash, rb.stateHash, 'cross-client agreement: both engines agree exactly');
  assert.equal(ra.state.handComplete, true);
  assert.equal(ra.state.board.length, 5);
  console.log('\n[mp-e2e] PASS — two networked clients converged to byte-identical state (REQ-TEST-002).');
}

function cleanup(): void {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* 忽略 */
    }
  }
}

main().then(
  () => {
    cleanup();
    process.exit(0);
  },
  (e) => {
    console.error('[mp-e2e] FAIL:', (e as Error).message);
    cleanup();
    process.exit(1);
  },
);
