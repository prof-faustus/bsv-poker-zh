/**
 * 实测性能 + 有界内存套件（core §A17 Power-of-Ten；REQ-APP-090 往返
 * 延迟目标，REQ-APP-092 热路径中的有界工作内存）。测量关键路径上的真实操作，
 * 并断言一个延迟预算 + 每状态热路径在每次迭代中不增长其
 * 工作集（无无界分配 / 泄漏）。以 --expose-gc 重新执行，使
 * 内存测量具有确定性。
 */

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { bestHigh } from '@bsv-poker/hand-eval';
import { deckFromEntropies } from '@bsv-poker/app-services';
import type { BranchBinding } from '@bsv-poker/protocol-types';
import { genKeyPair, signPreimage, fundingLocking, fundingUnlocking } from '@bsv-poker/script-templates-ts';
import { type Tx, buildSettlement, sighashMessage, SIGHASH_ALL_FORKID, serializeTxWire } from '@bsv-poker/tx-builder';

// 确定性 GC：若不可用则以 --expose-gc 重新执行一次。
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', process.argv[1]!], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const gc = globalThis.gc as () => void;

const BIND: BranchBinding = { gid: 'a1'.repeat(8), rulesetHash: 'b2'.repeat(32), round: 0, stateHash: 'c3'.repeat(32), actingSeat: 0, successorCommitment: '00'.repeat(32) };

function medianMs(iters: number, fn: () => void): number {
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

function main(): void {
  // 1) 心智扑克洗牌（将 4 名玩家的秘密置换合成为一副 52 张的牌）。
  const entropies = Array.from({ length: 4 }, (_, i) => Uint8Array.from({ length: 32 }, (_, j) => (i * 31 + j * 7) & 0xff));
  const shuffleMs = medianMs(200, () => deckFromEntropies(entropies));

  // 2) 牌力评估热路径（7 选 5 的最佳）。
  const seven = [0, 13, 26, 39, 4, 17, 51];
  const evalMs = medianMs(2000, () => bestHigh(seven));

  // 3) 本地动作往返：构建 → sighash → 签名 → 组装（UI 动作 → 已签名的花费）。
  const a = genKeyPair();
  const b = genKeyPair();
  const lock = fundingLocking(BIND, [a.pubCompressed, b.pubCompressed]);
  const roundTripMs = medianMs(200, () => {
    const tx: Tx = { version: 1, inputs: [{ prevTxid: 'ab'.repeat(32), vout: 0, sequence: 0xffffffff }], outputs: [buildSettlement(BIND, a.pubCompressed, 1000)], nLockTime: 0 };
    const msg = sighashMessage(tx, 0, lock, 2000);
    const ss = fundingUnlocking([Uint8Array.from([...signPreimage(msg, a.priv), SIGHASH_ALL_FORKID]), Uint8Array.from([...signPreimage(msg, b.priv), SIGHASH_ALL_FORKID])]);
    serializeTxWire(tx, [ss]);
  });

  console.log(`[perf] shuffle(4p→52)=${shuffleMs.toFixed(3)}ms  handEval(7→best5)=${evalMs.toFixed(4)}ms  actionRoundTrip(2-of-2)=${roundTripMs.toFixed(3)}ms`);

  // 宽松且 CI 稳定的延迟预算（REQ-APP-090：往返远低于人类可感知的界限）。
  assert.ok(roundTripMs < 100, `action round-trip ${roundTripMs}ms exceeds 100ms budget`);
  assert.ok(evalMs < 5, `hand-eval ${evalMs}ms exceeds 5ms budget`);

  // REQ-APP-092：有界工作内存——每状态热路径不得增长其工作集。
  const M = 200_000;
  gc();
  const before = process.memoryUsage().heapUsed;
  let sink = 0;
  for (let i = 0; i < M; i++) sink ^= bestHigh(seven).value.category;
  gc();
  const grewBytes = process.memoryUsage().heapUsed - before;
  console.log(`[perf] bounded-memory: ${M} hot-path evals → retained heap Δ ${(grewBytes / 1024).toFixed(1)} KiB (sink=${sink})`);
  assert.ok(grewBytes < 4 * 1024 * 1024, `hot path retained ${grewBytes} bytes over ${M} iters — not bounded`);

  console.log('\n[perf] PASS — latency within budget and the state-derivation hot path holds bounded working memory (§A17 / REQ-APP-090/092).');
}

main();
