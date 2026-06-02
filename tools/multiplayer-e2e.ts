/**
 * Real multiplayer E2E (core §8, REQ-TEST-002 cross-client agreement). Starts the relay +
 * indexer, then runs TWO independent NetworkedTableClients (Alice seat 0, Bob seat 1) that
 * exchange their entropy commit/reveal and betting actions ONLY over the relay channel, each
 * deriving state through its own engine. The test passes iff both clients converge to the
 * byte-identical final state hash — proving the relay is transport-only and the truth is the
 * client-reconstructed tx set (P2/P3).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Action, LegalActions, Ruleset } from '@bsv-poker/protocol-types';
import { RelayClient, NetworkedTableClient } from '@bsv-poker/app-services';

const ROOT = process.cwd();
const children: ChildProcess[] = [];

function startService(dir: string, addr: string): void {
  children.push(spawn('go', ['run', '.', '-addr', addr], { cwd: join(ROOT, dir), stdio: 'ignore' }));
}
async function waitHealthy(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* not up */
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

// Passive strategy: check when possible, else call, else fold — drives the hand to showdown.
const passive = (legal: LegalActions, seat: number): Action => {
  if (legal.check) return { kind: 'check', seat, amount: 0 };
  if (legal.call) return { kind: 'call', seat, amount: legal.call.amount };
  return { kind: 'fold', seat, amount: 0 };
};

async function main(): Promise<void> {
  console.log('[mp-e2e] starting relay (:8091) + indexer (:8092)…');
  startService('apps/relay-go', '127.0.0.1:8091');
  startService('apps/indexer-go', '127.0.0.1:8092');
  await waitHealthy('http://127.0.0.1:8091/healthz', 30000);
  await waitHealthy('http://127.0.0.1:8092/healthz', 30000);

  const relayA = new RelayClient('http://127.0.0.1:8091');
  const relayB = new RelayClient('http://127.0.0.1:8091');
  const tableId = 'mp-table-1';
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
      /* ignore */
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
