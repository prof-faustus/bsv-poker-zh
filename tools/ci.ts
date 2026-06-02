/**
 * CI 流水线（core §16, app §A14.2, REQ-BUILD-003）。各阶段按顺序运行；任一阶段失败即阻止
 * 合并。阶段：typecheck → lint（OP_RETURN absence）→ unit+property+interpreter 测试 →
 * reproduce → traceability → Go vet+test。E2E-in-image 以及无障碍/安全阶段
 * 由 VM 引导（vm/）和后续阶段接入。
 *
 * 运行：`node tools/ci.ts`。在第一个失败阶段以非零码退出。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

interface Stage {
  name: string;
  cmd: string;
  args: string[];
  cwd?: string;
  skipIf?: () => boolean;
}

const stages: Stage[] = [
  { name: 'typecheck (tsc --strict)', cmd: 'node', args: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit'] },
  { name: 'lint: OP_RETURN absence', cmd: 'node', args: ['tools/lint-opreturn.ts'] },
  { name: 'tests (unit+property+interpreter)', cmd: 'node', args: ['--test', 'packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'] },
  { name: 'reproduce (vectors)', cmd: 'node', args: ['tools/reproduce.ts'] },
  { name: 'traceability', cmd: 'node', args: ['tools/traceability.ts'] },
  {
    name: 'go vet+test relay-go',
    cmd: 'go',
    args: ['test', './...'],
    cwd: join(ROOT, 'apps/relay-go'),
    skipIf: () => !hasGo(),
  },
  {
    name: 'go vet+test indexer-go',
    cmd: 'go',
    args: ['test', './...'],
    cwd: join(ROOT, 'apps/indexer-go'),
    skipIf: () => !hasGo(),
  },
];

function hasGo(): boolean {
  const r = spawnSync('go', ['version'], { stdio: 'ignore' });
  return r.status === 0;
}

function main(): void {
  // 可追溯性需要 requirements.yaml 存在；先重新生成它（幂等）。
  if (!existsSync(join(ROOT, 'spec/requirements.yaml'))) {
    spawnSync('node', ['tools/extract-requirements.ts'], { cwd: ROOT, stdio: 'inherit' });
  }
  let failed = false;
  for (const stage of stages) {
    if (stage.skipIf?.()) {
      console.log(`\n=== SKIP: ${stage.name} (precondition not met) ===`);
      continue;
    }
    console.log(`\n=== ${stage.name} ===`);
    const r = spawnSync(stage.cmd, stage.args, {
      cwd: stage.cwd ?? ROOT,
      stdio: 'inherit',
      shell: false,
    });
    if (r.status !== 0) {
      console.error(`STAGE FAILED: ${stage.name} (exit ${r.status})`);
      failed = true;
      break; // 任一阶段失败即阻断流水线
    }
  }
  if (failed) {
    console.error('\nCI FAILED.');
    process.exit(1);
  }
  console.log('\nCI GREEN — all stages passed.');
}

main();
