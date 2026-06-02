/**
 * 架构不变量测试（core REQ-APP-012 / REQ-DEP-001）：任何应用包都不得直接导入
 * 依赖仓库——所有访问都经由适配器层。只有 `@bsv-poker/adapters`
 * 被允许引用依赖仓库（它就是边界）。这以一个通过的测试形式强制保证：
 * 依赖仓库的 API 变更会被其适配器吸收，绝不会传播到
 * engine/FSMs/UI（REQ-DEP-002）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // .../packages
// 仅适配器层可引用的外部依赖仓库的名称。
const DEP_REPO_TOKENS = [/@vaa\//, /overlay-broadcast/, /verifiable-accounting/, /bonded-subsat/];

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === 'test') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (e.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('no application package imports a dependency repo directly (only adapters may) — REQ-APP-012', () => {
  const violations: string[] = [];
  for (const pkg of readdirSync(PACKAGES)) {
    if (pkg === 'adapters') continue; // 边界本身被允许引用依赖仓库
    const src = join(PACKAGES, pkg, 'src');
    let files: string[];
    try { files = tsFiles(src); } catch { continue; }
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const line of text.split('\n')) {
        if (!/\b(import|from|require)\b/.test(line)) continue;
        for (const tok of DEP_REPO_TOKENS) {
          if (tok.test(line)) violations.push(`${pkg}: ${f.slice(PACKAGES.length + 1)} → ${line.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `dependency-repo imports must go through @bsv-poker/adapters:\n${violations.join('\n')}`);
});

test('the adapter layer IS where dependency repos are referenced (boundary exists)', () => {
  const adapters = join(PACKAGES, 'adapters', 'src');
  const text = tsFiles(adapters).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.ok(DEP_REPO_TOKENS.some((t) => t.test(text)), 'adapters reference the real dependency repos (real-va/real-ob/real-node)');
});
