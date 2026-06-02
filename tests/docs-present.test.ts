/**
 * Documentation is produced, kept current, and versioned WITH the code (REQ-APP-150/151). This test
 * asserts the load-bearing docs exist in-repo (so they are reviewed in the same pass as the code,
 * not maintained out-of-band) and that the ADR set is present.
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
