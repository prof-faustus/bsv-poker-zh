/**
 * 变体通用、多座位的多人 E2E（v3）。证明真实玩家可以选择一种变体并
 * N 人就座：通过大厅 + 交互式客户端在中继上运行一局 3 人德州扑克和一局 2 人奥马哈，
 * 断言所有玩家逐字节收敛一致（REQ-TEST-002）。
 *
 * （Hold'em/Omaha 使用 check/bet/call/raise/fold 的动作集，因此一个被动的自动策略可以无头地
 * 驱动它们。Stud/Razz/Draw 增加了 bring-in/draw 动作，需由人类在 UI 中提供；它们的
 * 引擎由模块单元测试覆盖——本测试套件证明的是联网的通用路径。）
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Variant } from '@bsv-poker/protocol-types';
import {
  RelayClient,
  LobbyClient,
  InteractiveNetworkedTableClient,
  universalBot,
  type TableMeta,
  type ClientUpdate,
} from '@bsv-poker/app-services';

const ROOT = process.cwd();
const isWin = process.platform === 'win32';
const children: ChildProcess[] = [];

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
function cleanup(): void {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* 忽略 */
    }
  }
}

async function joinAndPlay(base: string, tableId: string, meta: TableMeta, id: string): Promise<string> {
  const lobby = new LobbyClient(new RelayClient(base));
  const pub = randomBytes(33).toString('hex');
  const { seated } = lobby.joinWaitingRoom(tableId, { id, pub }, meta);
  const seat = await seated;
  const client = new InteractiveNetworkedTableClient({
    relay: new RelayClient(base),
    tableId,
    mySeat: seat.mySeat,
    seats: seat.seats,
    ruleset: seat.ruleset,
    entropy: randomBytes(32),
  });
  client.onUpdate((u: ClientUpdate) => {
    if (u.yourTurn && u.legal) client.submitAction(universalBot(u.legal, u.mySeat));
  });
  await client.play();
  return client.stateHash()!;
}

async function scenario(base: string, variant: Variant, seats: number): Promise<void> {
  const meta: TableMeta = {
    name: `${variant} ${seats}-handed`,
    variant,
    smallBlind: 1,
    bigBlind: 2,
    startingStack: 100,
    maxSeats: seats,
  };
  const host = new LobbyClient(new RelayClient(base));
  const tableId = await host.createTable(meta);
  console.log(`\n[multi-e2e] ${variant} ${seats}-handed → table ${tableId}`);
  const ids = Array.from({ length: seats }, (_, i) => `p${i}`);
  const hashes = await Promise.all(ids.map((id) => joinAndPlay(base, tableId, meta, id)));
  for (let i = 1; i < hashes.length; i++) {
    assert.equal(hashes[i], hashes[0], `${variant}: seat ${i} diverged`);
  }
  console.log(`[multi-e2e] ${variant} ${seats}-handed: all ${seats} players converged → ${hashes[0]!.slice(0, 20)}…`);
}

async function main(): Promise<void> {
  console.log('[multi-e2e] starting relay (:8091) + indexer (:8092)…');
  startService('apps/relay-go', '127.0.0.1:8091', 'relay-go');
  startService('apps/indexer-go', '127.0.0.1:8092', 'indexer-go');
  await waitHealthy('http://127.0.0.1:8091/healthz', 30000);

  const base = 'http://127.0.0.1:8091';
  await scenario(base, 'holdem', 3); // 多座位（3 人）
  await scenario(base, 'omaha', 2); // 4 张底牌，2+3
  await scenario(base, 'stud', 2); // ante + bring-in，明牌/暗牌
  await scenario(base, 'draw', 2); // 弃牌 + 重抽
  await scenario(base, 'razz', 2); // ace-to-five 低牌

  console.log('\n[multi-e2e] PASS — ALL FIVE variants play multiplayer over the relay (incl. 3-handed).');
}

main().then(
  () => {
    cleanup();
    process.exit(0);
  },
  (e) => {
    console.error('[multi-e2e] FAIL:', (e as Error).message);
    cleanup();
    process.exit(1);
  },
);
