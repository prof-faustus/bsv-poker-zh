/**
 * 等候室 + 真实多人 E2E（app §A6.3/§A6.5/§A7）——证明两名真实玩家（而非机器人）
 * 找到一张牌桌、加入等候室、经协商就座，并通过中继交互式地打完一整手牌，
 * 逐字节收敛一致（REQ-TEST-002）。
 *
 *   Host 创建一张 2 座的牌桌 → 双方加入等候室 → 座位达成一致 → 双方运行
 *   交互式客户端（一个脚本化的"人类"在每一轮行动）→ 最终状态相同。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Action, LegalActions } from '@bsv-poker/protocol-types';
import {
  RelayClient,
  LobbyClient,
  InteractiveNetworkedTableClient,
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

const passive = (legal: LegalActions, seat: number): Action => {
  if (legal.check) return { kind: 'check', seat, amount: 0 };
  if (legal.call) return { kind: 'call', seat, amount: legal.call.amount };
  return { kind: 'fold', seat, amount: 0 };
};

const META: TableMeta = {
  name: 'Friday night HU',
  variant: 'holdem',
  smallBlind: 1,
  bigBlind: 2,
  startingStack: 100,
  maxSeats: 2,
};

async function player(
  relayBase: string,
  me: { id: string; pub: string },
  tableId: string,
  entropySeed: number,
): Promise<{ stateHash: string }> {
  const lobby = new LobbyClient(new RelayClient(relayBase));
  const { seated } = lobby.joinWaitingRoom(tableId, me, META, (players) =>
    console.log(`[${me.id}] waiting room now has ${players.length} player(s): ${players.map((p) => p.id).join(', ')}`),
  );
  const seat = await seated;
  console.log(`[${me.id}] seated at seat ${seat.mySeat} of ${seat.seats.length}`);

  const client = new InteractiveNetworkedTableClient({
    relay: new RelayClient(relayBase),
    tableId,
    mySeat: seat.mySeat,
    seats: seat.seats,
    ruleset: seat.ruleset,
    entropy: Uint8Array.from(Array.from({ length: 32 }, (_, i) => (i * entropySeed + 3) % 251)),
  });
  // “人类”：通过面向 UI 的更新流在每一轮行动。
  client.onUpdate((u: ClientUpdate) => {
    if (u.yourTurn && u.legal) client.submitAction(passive(u.legal, u.mySeat));
  });
  await client.play();
  return { stateHash: client.stateHash()! };
}

async function main(): Promise<void> {
  console.log('[lobby-e2e] starting relay (:8091) + indexer (:8092)…');
  startService('apps/relay-go', '127.0.0.1:8091', 'relay-go');
  startService('apps/indexer-go', '127.0.0.1:8092', 'indexer-go');
  await waitHealthy('http://127.0.0.1:8091/healthz', 30000);

  const base = 'http://127.0.0.1:8091';
  const host = new LobbyClient(new RelayClient(base));
  const tableId = await host.createTable(META);
  console.log(`[lobby-e2e] host created table ${tableId} (${META.name}); now visible in the lobby:`);
  for (const t of await host.listTables()) console.log(`   - ${t.id}: ${t.meta.name} (${t.meta.maxSeats} seats)`);

  // 两名真实玩家发现并加入等候室，然后开始游戏。
  const [a, b] = await Promise.all([
    player(base, { id: 'alice', pub: '02aa' }, tableId, 7),
    player(base, { id: 'bob', pub: '03bb' }, tableId, 19),
  ]);

  console.log(`[lobby-e2e] alice final stateHash: ${a.stateHash.slice(0, 24)}…`);
  console.log(`[lobby-e2e] bob   final stateHash: ${b.stateHash.slice(0, 24)}…`);
  assert.equal(a.stateHash, b.stateHash, 'both players converged on identical state');
  console.log('\n[lobby-e2e] PASS — two players joined a waiting room and played a real hand (no bot).');
}

main().then(
  () => {
    cleanup();
    process.exit(0);
  },
  (e) => {
    console.error('[lobby-e2e] FAIL:', (e as Error).message);
    cleanup();
    process.exit(1);
  },
);
