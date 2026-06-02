/**
 * 五张换牌扑克模块测试 —— 核心 §7.3.3,REQ-FSM-004 / 009 / 010。涵盖:发 5 张;
 * 弃牌+重抽改变手牌且数量公开;stand-pat 默认动作;第二轮
 * 下注;摊牌 best-5;确定性。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, type Card, type Ruleset, type Action } from '@bsv-poker/protocol-types';
import { createDraw, PHASES, type DrawState } from '../src/draw.ts';

const NL: Ruleset = {
  variant: 'draw',
  bettingStructure: 'NL',
  forcedBetModel: 'blinds',
  seats: 2,
  blinds: { smallBlind: 1, bigBlind: 2, ante: 0, bringIn: 0 },
  minBuyIn: 100,
  maxBuyIn: 200,
  timeouts: { decisionMs: 30000, recoveryMs: 120000 },
  signingMode: 'A',
  currency: 'play-regtest',
  suitTiebreakHouseRule: false,
  hiLo: false,
};

const seats = [
  { seat: 0, stack: 100 },
  { seat: 1, stack: 100 },
];

// 发牌顺序(从庄家开始,5 轮):seat0 = deck[0,2,4,6,8];seat1 = deck[1,3,5,7,9]。
// 未发出的牌尾从 deck[10] 开始,按顺序提供重抽牌。
//   seat0 发到: Ah Kh Qh Jh 2c  (差一张成皇家同花 + 一张废牌 2c)
//   seat1 发到: 9s 9d 4c 5h 7s  (一对 9)
//   tail[10..] : Th ...          (seat0 弃掉 2c(槽位 4)并抽到 Th → Ah Kh Qh Jh Th
//                                 = 红心皇家同花顺,击败 seat1 的对子)
function drawDeck(): Card[] {
  const s0 = ['Ah', 'Kh', 'Qh', 'Jh', '2c'].map(parseCard);
  const s1 = ['9s', '9d', '4c', '5h', '7s'].map(parseCard);
  const tail = ['Th'].map(parseCard); // 第一张重抽牌
  const head: Card[] = [];
  for (let k = 0; k < 5; k++) {
    head.push(s0[k]!);
    head.push(s1[k]!);
  }
  head.push(...tail);
  const used = new Set(head);
  const rest: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  return [...head, ...rest];
}

test('deals 5 concealed cards per seat; opens BET1', () => {
  const m = createDraw({ deck: drawDeck() });
  const s = m.init(NL, seats);
  assert.equal(s.hole[0]!.length, 5);
  assert.equal(s.hole[1]!.length, 5);
  assert.equal(s.phase, PHASES.BET1);
  assert.equal(s.betting.toAct, 0);
});

test('discard+redraw changes the hand to a royal flush; draw count is public (REQ-FSM-009)', () => {
  const m = createDraw({ deck: drawDeck() });
  let s: DrawState = m.init(NL, seats);
  // BET1:小盲补齐,大盲看牌 → 换牌阶段开启。
  s = m.apply(s, { kind: 'call', seat: 0, amount: 1 });
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  assert.equal(s.phase, PHASES.DRAW);
  assert.equal(s.drawToAct, 1); // 庄家左侧的第一个存活座位首先换牌(单挑:非庄家)

  // seat1 不换牌(stand pat);seat0 弃掉废牌 2c(槽位 4)并重抽。
  s = m.apply(s, { kind: 'stand', seat: 1, amount: 0, discard: [] });
  assert.equal(s.drawCounts[1], 0); // 公共数量
  s = m.apply(s, { kind: 'draw', seat: 0, amount: 0, discard: [4] });
  assert.equal(s.drawCounts[0], 1); // 公共数量为换了 1 张牌
  // seat0 现在的手牌为 Ah Kh Qh Jh Th(皇家同花顺);身份为引擎已知,但数量(COUNT)是公开的。
  assert.deepEqual([...s.hole[0]!], ['Ah', 'Kh', 'Qh', 'Jh', 'Th'].map(parseCard));
  assert.equal(s.hole[0]!.length, 5);

  // 两人都换牌之后,第二轮下注开启。
  assert.equal(s.phase, PHASES.BET2);
});

test('second betting round then showdown: improved hand wins the pot', () => {
  const m = createDraw({ deck: drawDeck() });
  let s = m.init(NL, seats);
  s = m.apply(s, { kind: 'call', seat: 0, amount: 1 });
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  s = m.apply(s, { kind: 'stand', seat: 1, amount: 0, discard: [] });
  s = m.apply(s, { kind: 'draw', seat: 0, amount: 0, discard: [4] });
  // BET2:非庄家(seat1)首先行动;两人都看牌 → 摊牌。
  assert.equal(s.betting.toAct, 1);
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  s = m.apply(s, { kind: 'check', seat: 0, amount: 0 });
  assert.equal(s.phase, PHASES.HAND_END);
  // seat0(皇家同花顺)击败 seat1(一对 9);底池 = 2 + 2 = 4。
  assert.deepEqual([...s.payouts], [{ seat: 0, amount: 4 }]);
  assert.equal(s.seats.find((x) => x.seat === 0)!.stack, 102);
});

test('DRAW timeout-default is STAND PAT (draw 0) — REQ-FSM-010', () => {
  const m = createDraw({ deck: drawDeck() });
  let s = m.init(NL, seats);
  s = m.apply(s, { kind: 'call', seat: 0, amount: 1 });
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  assert.equal(s.phase, PHASES.DRAW);
  const t = m.isTimeoutEligible(s, 0);
  assert.equal(t!.seat, 1);
  assert.equal(t!.defaultAction.kind, 'stand');
  assert.deepEqual([...(t!.defaultAction.discard ?? [])], []);
});

test('determinism: replay yields byte-identical stateHash (P2)', () => {
  const play: Action[] = [
    { kind: 'call', seat: 0, amount: 1 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'stand', seat: 1, amount: 0, discard: [] },
    { kind: 'draw', seat: 0, amount: 0, discard: [4] },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
  ];
  const run = (): DrawState => {
    const m = createDraw({ deck: drawDeck() });
    let s = m.init(NL, seats);
    for (const a of play) s = m.apply(s, a);
    return s;
  };
  const m = createDraw({ deck: drawDeck() });
  assert.equal(m.stateHash(run()), m.stateHash(run()));
  assert.equal(m.stateHash(run()).length, 64);
});
