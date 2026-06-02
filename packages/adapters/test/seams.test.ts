/**
 * 审计（VA）与撤销/托管（OB）接缝集成（core §12.4 / §2.4）。这些测试演练
 * 平台所依赖的契约行为，并且关键在于断言所声明的边界已被
 * 展示（INV-VA-2），以及撤销是一个链上到期事实（INV-OB-2），绝不被夸大
 * （P8）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeVA, makeFakeOB } from '../src/index.ts';

test('VA selective-disclosure proves one figure and reveals nothing else; boundary surfaced (REQ-DATA-004)', async () => {
  const va = makeFakeVA();
  const ledger = ['settle:hand1=+80', 'settle:hand1=-20', 'settle:hand1=-60', 'rake=0', 'pot=160'];
  // 证明 "pot=160" 记录已被包含/锚定，而不泄露其他记录。
  const idx = 4;
  const bundle = await va.merkleProve(ledger, idx);
  assert.equal(bundle.leaf.length, 64); // 仅为被查询记录的哈希叶
  assert.equal(await va.merkleVerify(bundle), true);
  // path 中的兄弟节点是不透明的哈希，而非其他记录的内容
  for (const step of bundle.path) assert.equal(step.hashHex.length, 64);
  // 凡是展示审计输出的地方，都必须展示 INV-VA-2 边界
  assert.match(va.boundary, /inclusion/i);
  assert.match(va.boundary, /never truth-at-origin/i);
});

test('VA does not detect a lie entered at origin in otherwise-consistent books (INV-VA-2 honesty)', async () => {
  const va = makeFakeVA();
  // 一条虚假录入但内部一致的记录仍会产生有效的包含性证明——
  // 系统确立的是包含性/完整性，而非源头真实性。我们断言该证明能通过验证
  //（系统无法也并不声称能够捕捉这个谎言）。
  const books = ['false-but-consistent', 'b', 'c', 'd'];
  const bundle = await va.merkleProve(books, 0);
  assert.equal(await va.merkleVerify(bundle), true);
});

test('OB revocation is an unspent-expiring-output fact, decided by no operator (INV-OB-2)', async () => {
  const ob = makeFakeOB();
  assert.equal(await ob.isRevoked('nft-session@200', 199), false, 'live before expiry');
  assert.equal(await ob.isRevoked('nft-session@200', 201), true, 'revoked after expiry');
  // 带撤销的转移：重新生成密钥会将内容密钥封装给新成员；旧密钥无法解开
  const contentKey = 'deadbeefcafe';
  const wrapped = await ob.wrap(contentKey, '02newowner');
  assert.notEqual(wrapped, contentKey);
  assert.equal(await ob.unwrap(wrapped, 'priv-new'), contentKey);
});
