/**
 * Web 客户端的交互 + 持久化规则，作为一个通过的测试来强制执行（REQ-UI-003 / REQ-APP-053：
 * 交互使用显式处理器，绝不使用 `<form>` 提交 —— 避免 webview 导航；REQ-UI-002
 * / REQ-APP-042：`localStorage`/`sessionStorage` 绝不能持有承重状态 —— 密钥、牌桌
 * 状态、转录都存放在 IndexedDB 中）。扫描已构建的 `apps/client-web` 源码。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'client-web', 'src');

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

// 移除了仅含注释的行的源码，这样规则匹配的是真实代码，而非引用它们的
// 文档注释（例如 "// no <form> submit, REQ-UI-003"）。
function codeLines(text: string): string[] {
  return text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}

test('web client uses explicit handlers — no <form> element and no onSubmit (REQ-UI-003/APP-053)', () => {
  const bad: string[] = [];
  for (const f of files(WEB_SRC)) {
    for (const line of codeLines(readFileSync(f, 'utf8'))) {
      if (/<form[\s>/]/.test(line) || /onSubmit\s*=/.test(line)) bad.push(`${f.slice(WEB_SRC.length + 1)}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, [], `web client must use explicit onClick handlers, not <form> submit:\n${bad.join('\n')}`);
});

test('web client never persists LOAD-BEARING state in localStorage/sessionStorage (REQ-UI-002/APP-042)', () => {
  const bad: string[] = [];
  for (const f of files(WEB_SRC)) {
    for (const line of codeLines(readFileSync(f, 'utf8'))) {
      if (/sessionStorage/.test(line)) bad.push(`${f.slice(WEB_SRC.length + 1)}: sessionStorage is not permitted → ${line.trim()}`);
      // localStorage 可以持有游戏币钱包余额，但绝不能持有密钥/机密/转录/种子。
      if (/localStorage/.test(line) && /(priv|secret|seed|transcript|mnemonic)/i.test(line)) {
        bad.push(`${f.slice(WEB_SRC.length + 1)}: load-bearing material in localStorage → ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(bad, [], `load-bearing state (keys/transcripts) must live in IndexedDB, never web storage:\n${bad.join('\n')}`);
});
