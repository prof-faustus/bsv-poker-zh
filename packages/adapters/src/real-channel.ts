/**
 * 真实的微下注通道适配器（core §2.2 BS / §5.7 / §9.4；app §A23）—— 通过驱动其 CLI，将平台的
 * BS.channel 生命周期绑定到真实的 `bonded-subsat-channel` 参考实现：open → transfer（亚聪）→
 * close（整聪 Q* 结算）→ contested（1 聪保证金没收）。这是 §A23.3 集成测试所针对的真实适配器
 * （REQ-DEP-004）；链上绝不写出任何带小数的输出（INV-BS-1），承担的风险资本固定为每个参与者
 * 1 聪（INV-BS-2）。
 *
 * 仅限 Node 端（child_process）；通过 `@bsv-poker/adapters/real-channel` 导出。
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

export interface ChannelOpenParams {
  parties: number;
  /** 亚聪粒度 k。 */
  k: number;
  /** 注资的整聪数 S。 */
  funded: number;
  /** 每个玩家的反作弊保证金（1 聪 —— INV-BS-2）。 */
  bond: number;
}

export interface CloseResult {
  /** 每个玩家的整聪赔付（q_i + bond_i）。 */
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

  /** 开启一个真实的带保证金亚聪通道（BS.channel.open）。 */
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

  /** 应用一系列亚聪转账 [[from,to,amount],…]（BS.channel.transfer）。 */
  transfer(ops: Array<[number, number, number]>): number {
    const scriptPath = join(mkdtempSync(join(tmpdir(), 'bsvpoker-xfer-')), 'ops.json');
    // 写入转账脚本
    spawnSync('python', ['-c', `import json,sys; open(sys.argv[1],'w').write(json.dumps(${JSON.stringify(ops)}))`, scriptPath], {
      encoding: 'utf8',
    });
    const out = this.cli(['transfer', '--state', this.statePath, '--script', scriptPath]);
    const m = /new version=(\d+)/.exec(out);
    return m ? Number(m[1]) : -1;
  }

  /** 以整聪 Q* 结算进行的合作式关闭（BS.channel.close）。 */
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

  /** 争议式关闭：将违规方的保证金没收并赔付给诚实的对手方（BS.channel.contested）。 */
  contested(offender: number): string {
    return this.cli(['contested', '--state', this.statePath, '--offender', String(offender)]);
  }
}
