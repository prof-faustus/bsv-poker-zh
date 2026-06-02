/**
 * 仓库中存在构建/打包产物（REQ-BUILD-002 锁定的 lockfile；REQ-VM-003 容器
 * 打包）。断言锁定的依赖清单以及容器 Dockerfile + CI/CD
 * 工作流存在。（安装器签名 + 记录的产物哈希属于发布流水线关注点，
 * 在 RT-02 F3 中跟踪，此处不作断言。）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('dependency lockfiles are committed (locked deps — REQ-BUILD-002)', () => {
  assert.ok(existsSync(join(ROOT, 'pnpm-lock.yaml')), 'pnpm-lock.yaml committed');
  assert.ok(existsSync(join(ROOT, 'apps/client-desktop/src-tauri/Cargo.lock')), 'Cargo.lock committed');
});

test('container packaging exists: web image + the VM service images (REQ-VM-003)', () => {
  assert.ok(existsSync(join(ROOT, 'apps/client-web/Dockerfile')), 'web container');
  for (const d of ['Dockerfile.node', 'Dockerfile.relay', 'Dockerfile.indexer', 'Dockerfile.client']) {
    assert.ok(existsSync(join(ROOT, 'vm', d)), `vm/${d}`);
  }
});

test('CI/CD release workflows are present (REQ-VM-003 one-liner pipeline)', () => {
  const wf = readdirSync(join(ROOT, '.github', 'workflows'));
  assert.ok(wf.includes('publish-web.yml') && wf.includes('release-desktop.yml') && wf.includes('ci.yml'));
});
