/**
 * 文档与代码一起产出、保持最新并进行版本化（REQ-APP-150/151）。本测试
 * 断言承重的文档存在于仓库中（以便它们与代码在同一轮评审中被审阅，
 * 而非在仓库之外维护），并断言 ADR 集合存在。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('load-bearing docs are present and versioned with the code (REQ-APP-150/151)', () => {
  for (const doc of ['docs/runbook.md', 'docs/user-guide.md', 'docs/assurance.md', 'docs/redteam-02.md']) {
    assert.ok(existsSync(join(ROOT, doc)), `${doc} must exist in-repo`);
  }
});

test('the ADR set records design decisions (versioned with code)', () => {
  const adrs = readdirSync(join(ROOT, 'docs', 'adr')).filter((f) => /^\d{4}-.*\.md$/.test(f));
  assert.ok(adrs.length >= 5, `expected the ADR set, found ${adrs.length}`);
});
