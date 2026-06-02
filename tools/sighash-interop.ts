/**
 * Sighash interop check (core §6.8) — proves the platform's BIP-143 (FORKID) sighash matches
 * **bitcoinx** (the library the embedded BSV node validates with) byte-for-byte. If they match,
 * a platform-signed spend is accepted by the node: the on-chain last-mile is closed.
 *
 * The platform builds a tx, computes its sighash digest = double-SHA256(preimage) =
 * hash256(bip143Preimage); the Python reference computes bitcoinx's signature_hash for the same
 * tx; we assert equality across several txs (varying value, sequence, locktime, multi-IO).
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
  // double-SHA256(preimage) = the digest OP_CHECKSIG/ECDSA actually signs (see wire.ts).
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
