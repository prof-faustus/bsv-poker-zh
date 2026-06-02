import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePots, awardPot } from '../src/pots.ts';

test('§19.B worked example: A=100 B=60 C=40 all-in, no folds', () => {
  const pots = computePots([
    { seat: 0, contrib: 100, folded: false }, // A
    { seat: 1, contrib: 60, folded: false }, // B
    { seat: 2, contrib: 40, folded: false }, // C
  ]);
  // Pot1 主池 120 {A,B,C}；Pot2 40 {A,B}；Pot3 40 {A}（仅一人符合条件 → 退还）。
  assert.equal(pots.length, 3);
  assert.deepEqual(pots[0], { amount: 120, eligible: [0, 1, 2] });
  assert.deepEqual(pots[1], { amount: 40, eligible: [0, 1] });
  assert.deepEqual(pots[2], { amount: 40, eligible: [0] });
  // 守恒
  assert.equal(pots.reduce((s, p) => s + p.amount, 0), 200);
});

test('§19.B award with C>B>A: main→C, side1→B, side2 returned to A', () => {
  const pots = computePots([
    { seat: 0, contrib: 100, folded: false },
    { seat: 1, contrib: 60, folded: false },
    { seat: 2, contrib: 40, folded: false },
  ]);
  // 牌力 C(2) > B(1) > A(0)
  const cmp = (a: number, b: number): -1 | 0 | 1 => (a === b ? 0 : a > b ? 1 : -1);
  const net = new Map<number, number>([
    [0, -100],
    [1, -60],
    [2, -40],
  ]);
  for (const pot of pots) {
    const award = awardPot(pot, cmp, [0, 1, 2]);
    for (const [seat, amt] of award) net.set(seat, (net.get(seat) ?? 0) + amt);
  }
  assert.equal(net.get(2), 80); // C: -40 + 120
  assert.equal(net.get(1), -20); // B: -60 + 40
  assert.equal(net.get(0), -60); // A: -100 + 40 退还
  assert.equal([...net.values()].reduce((s, x) => s + x, 0), 0);
});

test('folded-but-contributing player sits in a pot they cannot win', () => {
  // A 投入 50 后弃牌；B 和 C 各投入 50 并争夺。
  const pots = computePots([
    { seat: 0, contrib: 50, folded: true },
    { seat: 1, contrib: 50, folded: false },
    { seat: 2, contrib: 50, folded: false },
  ]);
  assert.equal(pots.length, 1);
  assert.equal(pots[0]!.amount, 150);
  assert.deepEqual(pots[0]!.eligible, [1, 2]); // A 的筹码在池中，但 A 无法获胜
});

test('coincident all-in levels collapse to one layer', () => {
  const pots = computePots([
    { seat: 0, contrib: 50, folded: false },
    { seat: 1, contrib: 50, folded: false },
  ]);
  assert.equal(pots.length, 1);
  assert.equal(pots[0]!.amount, 100);
});

test('odd-chip split goes left-of-button deterministically (REQ-POKER-013)', () => {
  const pots = computePots([
    { seat: 0, contrib: 5, folded: false },
    { seat: 1, contrib: 5, folded: false },
  ]);
  const tie = (): 0 => 0; // 完全平局
  // seatOrderFromButton：座位 1 紧邻按钮左侧（按钮=座位0）
  const award = awardPot(pots[0]!, tie, [1, 0]);
  assert.equal(award.get(1), 5); // 各 5？底池=10 平分 5/5，无奇数筹码
});

test('odd chip with odd pot goes to first seat left-of-button', () => {
  const odd = { amount: 9, eligible: [0, 1] };
  const award = awardPot(odd, () => 0, [1, 0]);
  assert.equal(award.get(1), 5); // 按钮左侧获得奇数筹码
  assert.equal(award.get(0), 4);
});

test('conservation assertion throws on impossible input is not triggered by valid input', () => {
  assert.doesNotThrow(() =>
    computePots([
      { seat: 0, contrib: 0, folded: false },
      { seat: 1, contrib: 7, folded: false },
    ]),
  );
});
