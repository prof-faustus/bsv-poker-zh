/**
 * Real micro-betting channel adapter (core §2.2 BS / §5.7 / §9.4; app §A23) — binds the
 * platform's BS.channel lifecycle to the REAL `bonded-subsat-channel` reference implementation
 * by driving its CLI: open → transfer (sub-satoshi) → close (whole-satoshi Q* settlement) →
 * contested (1-sat bond forfeiture). This is the real adapter the §A23.3 integration runs
 * against (REQ-DEP-004); no fractional output is ever written on-chain (INV-BS-1) and risked
 * capital is a fixed 1 satoshi/participant (INV-BS-2).
 *
 * Node-side only (child_process); exported via `@bsv-poker/adapters/real-channel`.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

export interface ChannelOpenParams {
  parties: number;
  /** sub-satoshi granularity k. */
  k: number;
  /** funded whole satoshis S. */
  funded: number;
  /** anti-cheat bond per party (1 sat — INV-BS-2). */
  bond: number;
}

export interface CloseResult {
  /** Per-party whole-satoshi payout (q_i + bond_i). */
  payouts: number[];
  totalSettled: number;
  txSizeBytes: number;
}

export class RealBondedChannel {
  private readonly nodeDir: string;
  private readonly statePath: string;
  constructor(nodeDir: string) {
    this.nodeDir = nodeDir;
    this.statePath = join(mkdtempSync(join(tmpdir(), 'bsvpoker-chan-')), 'channel.json');
  }

  private cli(args: string[]): string {
    const r = spawnSync('python', ['-m', 'channel.cli', ...args], {
      cwd: this.nodeDir,
      env: { ...process.env, PYTHONPATH: 'src' },
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(`channel CLI failed (${args[0]}): ${r.stderr || r.stdout}`);
    }
    return r.stdout;
  }

  /** Open a real bonded sub-satoshi channel (BS.channel.open). */
  open(p: ChannelOpenParams): void {
    this.cli([
      'open',
      '--parties', String(p.parties),
      '--k', String(p.k),
      '--funded', String(p.funded),
      '--bond', String(p.bond),
      '--out', this.statePath,
    ]);
  }

  /** Apply a sequence of sub-satoshi transfers [[from,to,amount],…] (BS.channel.transfer). */
  transfer(ops: Array<[number, number, number]>): number {
    const scriptPath = join(mkdtempSync(join(tmpdir(), 'bsvpoker-xfer-')), 'ops.json');
    // write the transfer script
    spawnSync('python', ['-c', `import json,sys; open(sys.argv[1],'w').write(json.dumps(${JSON.stringify(ops)}))`, scriptPath], {
      encoding: 'utf8',
    });
    const out = this.cli(['transfer', '--state', this.statePath, '--script', scriptPath]);
    const m = /new version=(\d+)/.exec(out);
    return m ? Number(m[1]) : -1;
  }

  /** Cooperative close with whole-satoshi Q* settlement (BS.channel.close). */
  close(): CloseResult {
    const out = this.cli(['close', '--state', this.statePath]);
    const payouts: number[] = [];
    for (const line of out.split('\n')) {
      const m = /party \d+:.*total=(\d+)/.exec(line);
      if (m) payouts.push(Number(m[1]));
    }
    const total = Number(/total settled: (\d+) satoshis/.exec(out)?.[1] ?? 0);
    const txSize = Number(/tx size: (\d+) bytes/.exec(out)?.[1] ?? 0);
    return { payouts, totalSettled: total, txSizeBytes: txSize };
  }

  /** Contested close: forfeit the offender's bond to the honest counterparties (BS.channel.contested). */
  contested(offender: number): string {
    return this.cli(['contested', '--state', this.statePath, '--offender', String(offender)]);
  }
}
