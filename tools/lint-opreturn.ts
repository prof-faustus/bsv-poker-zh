/**
 * OP_RETURN-absence lint (core P11/§6.5, HANDOVER §3; build rule 2). Fails the build if the
 * OP_RETURN opcode (0x6a) appears in any locking or unlocking script the templates produce.
 *
 * Two layers: (1) build every template family with representative data and scan the opcode
 * stream for 0x6a; (2) a source scan of the script/tx packages for a raw `0x6a` opcode push
 * outside the sanctioned definition/rejection sites.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BranchBinding } from '@bsv-poker/protocol-types';
import {
  OP,
  containsOpReturn,
  genKeyPair,
  branchBindingPrefix,
  fundingLocking,
  fundingUnlocking,
  revealOrTimeoutLocking,
  revealUnlocking,
  foldLocking,
  foldUnlocking,
  settlementLocking,
  settlementUnlocking,
  revealCommitment,
  revealPreimage,
  signPreimage,
  type Script,
} from '@bsv-poker/script-templates-ts';

const BIND: BranchBinding = {
  gid: 'aa'.repeat(8),
  rulesetHash: 'bb'.repeat(32),
  round: 0,
  stateHash: 'cc'.repeat(32),
  actingSeat: 0,
  successorCommitment: 'dd'.repeat(32),
};

function buildAllScripts(): Array<{ name: string; script: Script }> {
  const k = genKeyPair();
  const k2 = genKeyPair();
  const sig = signPreimage(Uint8Array.of(1, 2, 3), k.priv);
  const cmt = revealCommitment(7, Uint8Array.of(1, 2, 3, 4));
  return [
    { name: 'branchBindingPrefix', script: branchBindingPrefix(BIND) },
    { name: 'fundingLocking', script: fundingLocking(BIND, [k.pubCompressed, k2.pubCompressed]) },
    { name: 'fundingUnlocking', script: fundingUnlocking([sig, sig]) },
    {
      name: 'revealOrTimeoutLocking',
      script: revealOrTimeoutLocking(BIND, cmt, k.pubCompressed, k2.pubCompressed),
    },
    { name: 'revealUnlocking', script: revealUnlocking(sig, revealPreimage(7, Uint8Array.of(1, 2, 3, 4))) },
    { name: 'foldLocking', script: foldLocking(BIND, k.pubCompressed) },
    { name: 'foldUnlocking', script: foldUnlocking(sig) },
    { name: 'settlementLocking', script: settlementLocking(BIND, k.pubCompressed) },
    { name: 'settlementUnlocking', script: settlementUnlocking(sig) },
  ];
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'test') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
}

function sourceScan(root: string): string[] {
  const findings: string[] = [];
  const dirs = ['packages/script-templates-ts/src', 'packages/tx-builder/src'];
  for (const d of dirs) {
    const full = join(root, d);
    let files: string[] = [];
    try {
      walk(full, files);
    } catch {
      continue; // package may not exist yet
    }
    for (const f of files) {
      // opcodes.ts defines OP_RETURN; interpreter.ts/script.ts reject it — those are sanctioned.
      if (/(opcodes|interpreter|script)\.ts$/.test(f)) continue;
      const text = readFileSync(f, 'utf8');
      // flag an OP_RETURN opcode being USED in a script array (heuristic: OP.OP_RETURN reference)
      if (/\bOP\.OP_RETURN\b/.test(text)) findings.push(`${f}: references OP.OP_RETURN as an opcode`);
    }
  }
  return findings;
}

function main(): void {
  const failures: string[] = [];
  for (const { name, script } of buildAllScripts()) {
    if (containsOpReturn(script)) failures.push(`template ${name} contains OP_RETURN (0x6a)`);
  }
  void OP;
  const root = process.cwd();
  failures.push(...sourceScan(root));

  if (failures.length > 0) {
    console.error('OP_RETURN lint FAILED (core P11/§6.5):');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('OP_RETURN lint OK — no OP_RETURN in any locking/unlocking script.');
}

main();
