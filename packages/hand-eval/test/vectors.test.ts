import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '@bsv-poker/protocol-types';
import {
  eval5High,
  bestHigh,
  bestOmaha,
  compareHigh,
  CATEGORY_NAMES,
  type HandValue,
} from '../src/high.ts';
import { bestLow, bestOmaha8Low, compareLow, type LowValue } from '../src/low.ts';

// §19.D 高牌类别向量 —— 来自 oracle 的 category + tiebreak 元组。
const HIGH: Array<[string, string, string, number[]]> = [
  ['royal flush', 'As Ks Qs Js Ts', 'straight flush', [14]],
  ['sf 9-high', '9h 8h 7h 6h 5h', 'straight flush', [9]],
  ['steel wheel', '5c 4c 3c 2c Ac', 'straight flush', [5]],
  ['quads K-kick', 'Qs Qh Qd Qc Ks', 'four of a kind', [12, 13]],
  ['quads 2-kick', 'Qs Qh Qd Qc 2s', 'four of a kind', [12, 2]],
  ['boat AAA KK', 'As Ah Ad Ks Kh', 'full house', [14, 13]],
  ['boat KKK AA', 'Ks Kh Kd As Ah', 'full house', [13, 14]],
  ['flush A-high', 'Ad Jd 9d 6d 3d', 'flush', [14, 11, 9, 6, 3]],
  ['flush K-high', 'Kd Jd 9d 6d 3d', 'flush', [13, 11, 9, 6, 3]],
  ['broadway', 'As Kd Qh Jc Ts', 'straight', [14]],
  ['wheel', '5s 4d 3h 2c As', 'straight', [5]],
  ['trips 7s', '7s 7h 7d Ks Qd', 'three of a kind', [7, 13, 12]],
  ['two pair k5', 'As Ah Ks Kh 5d', 'two pair', [14, 13, 5]],
  ['two pair k4', 'As Ah Ks Kh 4d', 'two pair', [14, 13, 4]],
  ['pair A-kick', '8s 8h Ad 7c 5h', 'one pair', [8, 14, 7, 5]],
  ['pair K-kick', '8s 8h Kd 7c 5h', 'one pair', [8, 13, 7, 5]],
  ['high card', 'As Kd Jh 8c 6s', 'high card', [14, 13, 11, 8, 6]],
];

test('§19.D high-hand category vectors reproduce the oracle bit-for-bit', () => {
  for (const [label, hand, cat, tb] of HIGH) {
    const v = eval5High(parseHand(hand));
    assert.equal(CATEGORY_NAMES[v.category], cat, `${label}: category`);
    assert.deepEqual([...v.tiebreak], tb, `${label}: tiebreak`);
  }
});

test('§19.D ordering checks (all must hold)', () => {
  const val = (h: string): HandValue => eval5High(parseHand(h));
  const ladder = [
    'As Ks Qs Js Ts', // 皇家同花顺
    '9h 8h 7h 6h 5h', // 同花顺-9
    '5c 4c 3c 2c Ac', // 钢轮（最小同花顺）
    'Qs Qh Qd Qc Ks', // 四条
    'As Ah Ad Ks Kh', // 葫芦
    'Ad Jd 9d 6d 3d', // 同花
    'As Kd Qh Jc Ts', // 百老汇顺子
    '7s 7h 7d Ks Qd', // 三条
    'As Ah Ks Kh 5d', // 两对
    '8s 8h Ad 7c 5h', // 一对
    'As Kd Jh 8c 6s', // 高牌
  ];
  for (let i = 1; i < ladder.length; i++) {
    assert.equal(compareHigh(val(ladder[i - 1]!), val(ladder[i]!)), 1, `ladder ${i}`);
  }
  assert.equal(compareHigh(val('Qs Qh Qd Qc Ks'), val('Qs Qh Qd Qc 2s')), 1, 'quads kicker');
  assert.equal(compareHigh(val('As Ah Ad Ks Kh'), val('Ks Kh Kd As Ah')), 1, 'AAA-KK > KKK-AA');
  assert.equal(compareHigh(val('Ad Jd 9d 6d 3d'), val('Kd Jd 9d 6d 3d')), 1, 'flush A>K');
  assert.equal(compareHigh(val('As Ah Ks Kh 5d'), val('As Ah Ks Kh 4d')), 1, 'two pair kicker');
  assert.equal(compareHigh(val('8s 8h Ad 7c 5h'), val('8s 8h Kd 7c 5h')), 1, 'pair kicker');
  assert.equal(compareHigh(val('As Kd Qh Jc Ts'), val('5s 4d 3h 2c As')), 1, 'broadway>wheel');
});

test('transitivity over 20000 random triples (oracle property)', () => {
  // 确定性 LCG，使该性质可复现（不使用 Math.random）。
  let s = 1n;
  const rnd = (n: number): number => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return Number((s >> 17n) % BigInt(n));
  };
  const sample5 = (): number[] => {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 0; i < 5; i++) {
      const j = i + rnd(52 - i);
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    return deck.slice(0, 5);
  };
  let ok = true;
  for (let i = 0; i < 20000; i++) {
    const va = eval5High(sample5());
    const vb = eval5High(sample5());
    const vc = eval5High(sample5());
    if (compareHigh(va, vb) <= 0 && compareHigh(vb, vc) <= 0 && !(compareHigh(va, vc) <= 0)) {
      ok = false;
      break;
    }
  }
  assert.ok(ok, 'transitive');
});

test('§19.D Omaha 2+3 constraint differs from generic best-of-7 (REQ-POKER-005)', () => {
  const board = parseHand('As Ks Qs 2s 7d');
  const hole = parseHand('Js 9h 4c 3d');
  const generic = bestHigh([...board, ...hole]);
  const omaha = bestOmaha(hole, board);
  assert.equal(CATEGORY_NAMES[generic.value.category], 'flush');
  assert.equal(CATEGORY_NAMES[omaha.value.category], 'high card');
  assert.notEqual(generic.value.category, omaha.value.category);
  assert.deepEqual([...omaha.value.tiebreak], [14, 13, 12, 11, 9]);
});

test('§19.D ace-to-five low (Razz) vectors reproduce the oracle', () => {
  const LOW: Array<[string, string, LowValue]> = [
    ['bicycle', 'Ah 2d 3c 4s 5h Kd Qs', { pairPenalty: 0, values: [5, 4, 3, 2, 1] }],
    ['six-low', 'Ah 2d 3c 4s 6h Ks Qd', { pairPenalty: 0, values: [6, 4, 3, 2, 1] }],
    ['seven-low', 'Ah 2d 4c 5s 7h Ks Qd', { pairPenalty: 0, values: [7, 5, 4, 2, 1] }],
    ['paired→nine-low', 'Ah Ad 2c 3s 8h 9s Td', { pairPenalty: 0, values: [9, 8, 3, 2, 1] }],
    ['all hearts=wheel', 'Ah 2h 3h 4h 5h Kh Qh', { pairPenalty: 0, values: [5, 4, 3, 2, 1] }],
  ];
  for (const [label, hand, expected] of LOW) {
    const { value } = bestLow(parseHand(hand));
    assert.equal(value.pairPenalty, expected.pairPenalty, `${label}: penalty`);
    assert.deepEqual([...value.values], [...expected.values], `${label}: values`);
  }
  const v = (h: string): LowValue => bestLow(parseHand(h)).value;
  assert.equal(compareLow(v('Ah 2d 3c 4s 5h Kd Qs'), v('Ah 2d 3c 4s 6h Ks Qd')), -1, 'bicycle<six');
  assert.equal(compareLow(v('Ah 2d 3c 4s 6h Ks Qd'), v('Ah 2d 4c 5s 7h Ks Qd')), -1, 'six<seven');
  assert.equal(
    compareLow(v('Ah 2d 4c 5s 7h Ks Qd'), v('Ah Ad 2c 3s 8h 9s Td')),
    -1,
    'seven<paired-nine',
  );
  assert.equal(compareLow(v('Ah 2h 3h 4h 5h Kh Qh'), v('Ah 2d 3c 4s 5h Kd Qs')), 0, 'flush ignored');
});

test('§19.D Omaha-8 qualifying low: exactly-8-high qualifies, 9-high does not (REQ-FSM-007)', () => {
  // 满足最小顺子的合格情形：底牌 A,5 + 公共牌 2,3,4 → A-2-3-4-5 合格（最佳低牌）。
  const wheel = bestOmaha8Low(parseHand('As 5h 7d 9c'), parseHand('2c 3d 4h 8s Kc'));
  assert.ok(wheel, 'a qualifying low exists');
  assert.equal(wheel!.value.pairPenalty, 0);
  assert.deepEqual([...wheel!.value.values], [5, 4, 3, 2, 1], 'best qualifying low is the wheel');

  // 恰好以 8 为最高的边界合格：底牌 A,8 + 公共牌 2,4,6 → 8-6-4-2-A（全部不同，全部 ≤8）。
  const eightHigh = bestOmaha8Low(parseHand('As 8h 9d Tc'), parseHand('2c 4d 6h Qs Kc'));
  assert.ok(eightHigh, '8-high qualifies (≤8)');
  assert.equal(Math.max(...eightHigh!.value.values), 8, 'top card is exactly 8');

  // 无合格低牌：只有两张 ≤ 8 的牌可用 → 无法凑出五个 ≤8 的不同点数。
  const none = bestOmaha8Low(parseHand('As 2h Kd Qc'), parseHand('9c Td Jh Qs Kh'));
  assert.equal(none, null, 'no eight-or-better low qualifies');
});

test('§19.D tie / odd-chip: two identical best hands compare equal (split, §5.5.1)', () => {
  // 相同公共牌、不同花色 → 完全相同的 category+tiebreak → 平局并平分底池。
  const board = 'Ah Kd 7c 4s 2d';
  const a = bestHigh(parseHand('Qs Js ' + board)); // Q 高无对子？使用 A K Q J 7 的高牌
  const b = bestHigh(parseHand('Qh Jh ' + board));
  assert.equal(compareHigh(a.value, b.value), 0, 'identical hands tie (suits never break ties)');
});
