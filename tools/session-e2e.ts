/**
 * 连续多手对局会话 E2E（v3）：一张真实持续进行的牌桌。两名玩家加入并通过 relay
 * 进行一个有界的多手对局会话 —— 每手对局重新洗牌（REQ-CRYPTO-010）、
 * 带入筹码、轮转庄家 —— 在多手对局之间牌桌的总筹码守恒，同时
 * 两个客户端保持步调一致（playSession 没有出现分歧错误即表示每手对局都已收敛）。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
const HANDS = 3;
const META: TableMeta = {
  name: 'session test',
  variant: 'holdem',
  smallBlind: 1,
  bigBlind: 2,
  startingStack: 100,
  maxSeats: 2,
};

function startService(dir: string, addr: string, bin: string): void {
  const exe = isWin ? `${bin}.exe` : bin;
  const b = spawnSync('go', ['build', '-o', exe, '.'], { cwd: join(ROOT, dir), stdio: 'inherit' });
  if (b.status !== 0) throw new Error(`go build -o failed in ${dir}`);
  children.push(spawn(join(ROOT, dir, exe), ['-addr', addr], { stdio: 'ignore' }));
}
async function waitHealthy(url: string, ms: number): Promise<void> {
  const dl = Date.now() + ms;
  for (;;) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* 尚未启动 */
    }
    if (Date.now() > dl) throw new Error(`not healthy: ${url}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}
const passive = (l: LegalActions, seat: number): Action =>
  l.check ? { kind: 'check', seat, amount: 0 } : l.call ? { kind: 'call', seat, amount: l.call.amount } : { kind: 'fold', seat, amount: 0 };

async function player(base: string, tableId: string, id: string): Promise<number[]> {
  const lobby = new LobbyClient(new RelayClient(base));
  const { seated } = lobby.joinWaitingRoom(tableId, { id, pub: randomBytes(33).toString('hex') }, META);
  const seat = await seated;
  const client = new InteractiveNetworkedTableClient({
    relay: new RelayClient(base),
    tableId,
    mySeat: seat.mySeat,
    seats: seat.seats,
    ruleset: seat.ruleset,
    entropy: randomBytes(32),
  });
  let last: ClientUpdate | null = null;
  client.onUpdate((u) => {
    last = u;
    if (u.yourTurn && u.legal) client.submitAction(passive(u.legal, u.mySeat));
  });
  await client.playSession({ maxHands: HANDS });
  // 该客户端所观察到的每个座位的最终筹码
  return last!.state.seats.map((s) => s.stack);
}

async function main(): Promise<void> {
  console.log(`[session-e2e] starting services; playing a ${HANDS}-hand session…`);
  startService('apps/relay-go', '127.0.0.1:8091', 'relay-go');
  startService('apps/indexer-go', '127.0.0.1:8092', 'indexer-go');
  await waitHealthy('http://127.0.0.1:8091/healthz', 30000);
  const base = 'http://127.0.0.1:8091';
  const host = new LobbyClient(new RelayClient(base));
  const tableId = await host.createTable(META);

  const [a, b] = await Promise.all([player(base, tableId, 'alice'), player(base, tableId, 'bob')]);
  console.log(`[session-e2e] alice's view of final stacks: [${a.join(', ')}]`);
  console.log(`[session-e2e] bob's view of final stacks:   [${b.join(', ')}]`);
  // 双方看到相同的最终筹码（所有对局步调一致），且总筹码守恒
  assert.deepEqual(a, b, 'both players agree on final stacks after the session');
  assert.equal(a.reduce((x, y) => x + y, 0), META.startingStack * 2, 'total chips conserved across hands');
  console.log(`\n[session-e2e] PASS — ${HANDS}-hand continuous table; players in lockstep, chips conserved.`);
}

main().then(
  () => {
    for (const c of children) c.kill();
    process.exit(0);
  },
  (e) => {
    console.error('[session-e2e] FAIL:', (e as Error).message);
    for (const c of children) c.kill();
    process.exit(1);
  },
);
