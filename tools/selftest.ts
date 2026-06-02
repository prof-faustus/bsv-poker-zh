/**
 * 自包含的栈自检（core §10.2/§10.3, REQ-VM-001）—— 即 VM 引导阶段“拉起栈、
 * 运行自检、打印转录”这一步。无需 Docker 即可运行，因此该门禁可在此处检查：
 *   1. 构建 Go 服务（证明栈可编译）；
 *   2. 启动 relay (:8091) + indexer (:8092)；轮询 /healthz 直到就绪；
 *   3. 在进程内运行一手完整的单挑 Hold'em 对局（client/engine 角色）并打印
 *      转录（有序动作 + 最终状态哈希 + payouts）；
 *   4. 拆除这些服务。
 *
 * Phase-0 说明：本地 BSV 节点（bonded-subsat-channel, D6）会在后续步骤由真实适配器绑定；
 * 此处节点/链的角色由 indexer 投影 + BS fake 代表。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { parseHand, type Card, type Ruleset, type Action } from '@bsv-poker/protocol-types';
import { createHoldem } from '@bsv-poker/game-holdem';
import { RelayClient, IndexerClient } from '@bsv-poker/app-services';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const children: ChildProcess[] = [];

const isWin = process.platform === 'win32';

/** 构建一个独立的二进制文件并直接运行它，这样杀死子进程即可停止服务器（不会留下
 *  孤儿 `go run` 服务器进程 / 僵尸进程 —— 这对宿主机的无僵尸纪律很重要）。 */
function startService(dir: string, addr: string, bin: string): ChildProcess {
  const exe = isWin ? `${bin}.exe` : bin;
  const b = spawnSync('go', ['build', '-o', exe, '.'], { cwd: join(ROOT, dir), stdio: 'inherit' });
  if (b.status !== 0) throw new Error(`go build -o failed in ${dir}`);
  const child = spawn(join(ROOT, dir, exe), ['-addr', addr], { stdio: 'ignore' });
  children.push(child);
  return child;
}

async function waitHealthy(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const body = await res.text();
        if (body.includes('ok')) return;
      }
    } catch {
      /* 尚未启动 */
    }
    if (Date.now() > deadline) throw new Error(`service not healthy: ${url}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

function fixedDeck(): Card[] {
  const head = ['As', 'Ks', 'Ah', 'Kh', 'Qd', 'Jc', '9h', '4s', '3h'].map((c) => parseHand(c)[0]!);
  const used = new Set(head);
  const rest: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  return [...head, ...rest];
}

function runHand(): { transcript: Action[]; stateHash: string; payouts: unknown } {
  const ruleset: Ruleset = {
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
  const m = createHoldem({ deck: fixedDeck() });
  let s = m.init(ruleset, [
    { seat: 0, stack: 100 },
    { seat: 1, stack: 100 },
  ]);
  const transcript: Action[] = [
    { kind: 'call', seat: 0, amount: 1 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
  ];
  for (const a of transcript) s = m.apply(s, a);
  if (!s.handComplete) throw new Error('hand did not complete');
  return { transcript, stateHash: m.stateHash(s), payouts: s.payouts };
}

/** 通过 HTTP 演练真实的 relay + indexer：发现、双路径、确定性投影。 */
async function exerciseNetwork(): Promise<void> {
  const relay = new RelayClient('http://127.0.0.1:8091');
  const indexer = new IndexerClient('http://127.0.0.1:8092');

  // Tier-A 发现：两名玩家公告在线状态并互相找到对方。
  await relay.heartbeat('alice', '127.0.0.1:6001');
  await relay.heartbeat('bob', '127.0.0.1:6002');
  const presence = await relay.listPresence();
  assert.ok(presence.length >= 2, 'both players present');

  // 创建一张牌桌；双方都会向其发布/写入。每次运行使用唯一 id（不会跨运行冲突）。
  const tableId = `selftest-table-${Date.now()}`;
  await relay.createTable(tableId, 'Self-test HU');
  assert.ok((await relay.listTables()).some((t) => t.id === tableId), 'table discoverable');

  // 双路径（REQ-NET-003）：速度路径 = relay 发布；规范路径 = indexer 写入。
  await relay.publish(tableId, new TextEncoder().encode('action:bet:6')); // 无订阅者 ⇒ 投递 0 条，正常
  const recs = [
    { txid: 'tx-funding', class: 'Funding', tableId },
    { txid: 'tx-deal', class: 'Deal', tableId },
    { txid: 'tx-bet1', class: 'Action', tableId },
  ];
  for (const r of recs) assert.equal(await indexer.ingest(r), true, `ingest ${r.txid}`);
  // 去重：重复写入返回 false
  assert.equal(await indexer.ingest(recs[0]!), false, 'dedup by txid');

  // 投影是有序的有效交易集合，任何客户端都能以相同方式重建（P2）。
  const projection = await indexer.table(tableId);
  assert.deepEqual(projection, ['tx-funding', 'tx-deal', 'tx-bet1'], 'deterministic ordered projection');
  console.log(`[selftest] indexer projection for ${tableId}: [${projection.join(', ')}]`);
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

async function main(): Promise<void> {
  try {
    console.log('[selftest] building + starting Go services (relay :8091, indexer :8092)…');
    startService('apps/relay-go', '127.0.0.1:8091', 'relay-go');
    startService('apps/indexer-go', '127.0.0.1:8092', 'indexer-go');
    await waitHealthy('http://127.0.0.1:8091/healthz', 30000);
    await waitHealthy('http://127.0.0.1:8092/healthz', 30000);
    console.log('[selftest] relay + indexer healthy.');

    console.log('[selftest] exercising relay + indexer over HTTP (discovery + dual-path)…');
    await exerciseNetwork();

    console.log('[selftest] running a full heads-up Hold\'em hand (client/engine role)…');
    const { transcript, stateHash, payouts } = runHand();
    console.log('[selftest] TRANSCRIPT:');
    transcript.forEach((a, i) => console.log(`   ${i}: seat ${a.seat} ${a.kind}${a.amount ? ' ' + a.amount : ''}`));
    console.log(`[selftest] final state hash: ${stateHash}`);
    console.log(`[selftest] payouts: ${JSON.stringify(payouts)}`);

    console.log('\n[selftest] PASS — VM stack came up end-to-end and a full hand settled.');
  } finally {
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('[selftest] FAIL:', (e as Error).message);
    cleanup();
    process.exit(1);
  },
);
