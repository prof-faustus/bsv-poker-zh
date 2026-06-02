/**
 * Sighash 互操作检查（core §6.8）—— 证明平台的 BIP-143 (FORKID) sighash 与
 * **bitcoinx**（嵌入式 BSV 节点用于校验的库）逐字节匹配。如果两者匹配，
 * 平台签名的花费就会被节点接受：链上的最后一公里就此打通。
 *
 * 平台构建一笔交易，计算其 sighash 摘要 = double-SHA256(preimage) =
 * hash256(bip143Preimage)；Python 参考实现为同一笔交易计算 bitcoinx 的 signature_hash；
 * 我们对若干交易断言相等（变化的 value、sequence、locktime、多输入输出）。
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { bytesToHex, hash256, type BranchBinding } from '@bsv-poker/protocol-types';
import { genKeyPair, foldLocking, settlementLocking, serializeScript, type Script } from '@bsv-poker/script-templates-ts';
import { type Tx, buildFold, buildFunding, serializeTxWire, bip143Preimage, SIGHASH_ALL_FORKID } from '@bsv-poker/tx-builder';

const ROOT = process.cwd();
const BIND: BranchBinding = {
  gid: '11'.repeat(8),
  rulesetHash: '22'.repeat(32),
  round: 0,
  stateHash: '33'.repeat(32),
  actingSeat: 0,
  successorCommitment: '44'.repeat(32),
};

function bitcoinxSighash(tx: Tx, index: number, scriptCode: Script, value: number): string {
  const payload = JSON.stringify({
    rawTx: bytesToHex(serializeTxWire(tx)),
    index,
    value,
    scriptCode: bytesToHex(serializeScript(scriptCode)),
    sighashType: SIGHASH_ALL_FORKID,
  });
  const r = spawnSync('python', [join(ROOT, 'tools/_sighash_ref.py'), payload], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`bitcoinx ref failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function platformSighash(tx: Tx, index: number, scriptCode: Script, value: number): string {
  // double-SHA256(preimage) = OP_CHECKSIG/ECDSA 实际签名的摘要（参见 wire.ts）。
  return bytesToHex(hash256(bip143Preimage(tx, index, scriptCode, value)));
}

interface Case {
  readonly name: string;
  readonly tx: Tx;
  readonly index: number;
  readonly scriptCode: Script;
  readonly value: number;
}

function cases(): Case[] {
  const k = genKeyPair();
  const sc = foldLocking(BIND, k.pubCompressed);
  const out = buildFold(BIND, k.pubCompressed);
  const base: Tx = {
    version: 1,
    inputs: [{ prevTxid: 'ab'.repeat(32), vout: 0, sequence: 0xffffffff }],
    outputs: [out],
    nLockTime: 0,
  };
  return [
    { name: 'single in/out', tx: base, index: 0, scriptCode: sc, value: 5000 },
    { name: 'nonfinal seq + locktime', tx: { ...base, inputs: [{ prevTxid: 'cd'.repeat(32), vout: 3, sequence: 0xfffffffe }], nLockTime: 850000 }, index: 0, scriptCode: sc, value: 999999 },
    {
      name: 'multi-output (funding + change)',
      tx: { ...base, outputs: [buildFunding(BIND, [k.pubCompressed, genKeyPair().pubCompressed], 300), out] },
      index: 0,
      scriptCode: settlementLocking(BIND, k.pubCompressed),
      value: 12345,
    },
    {
      name: 'two inputs (sign index 1)',
      tx: {
        ...base,
        inputs: [
          { prevTxid: '01'.repeat(32), vout: 0, sequence: 0xffffffff },
          { prevTxid: '02'.repeat(32), vout: 7, sequence: 0xffffffff },
        ],
      },
      index: 1,
      scriptCode: sc,
      value: 2_000_000_000,
    },
  ];
}

function main(): void {
  let ok = 0;
  for (const c of cases()) {
    const mine = platformSighash(c.tx, c.index, c.scriptCode, c.value);
    const ref = bitcoinxSighash(c.tx, c.index, c.scriptCode, c.value);
    const match = mine === ref;
    console.log(`[sighash-interop] ${match ? 'MATCH' : 'DIFF '} ${c.name}: ${mine.slice(0, 20)}… vs ${ref.slice(0, 20)}…`);
    assert.equal(mine, ref, `sighash mismatch for "${c.name}"`);
    ok++;
  }
  console.log(`\n[sighash-interop] PASS — platform BIP-143 sighash matches bitcoinx for all ${ok} cases (node-acceptable).`);
}

main();
