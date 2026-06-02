/**
 * 七张梭哈模块测试 —— core §7.3.2, REQ-FSM-005/008。涵盖：已下底注 + bring-in；
 * 最低明牌进行 bring-in；由明面驱动的行动顺序（第三街后最高明面先行动）；
 * 7 张里取最佳 5 张的摊牌；确定性。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, type Card, type Ruleset, type Action } from '@bsv-poker/protocol-types';
import { createStud, PHASES, upCardsOf, type StudState } from '../src/stud.ts';

const FL: Ruleset = {
  variant: 'stud',
  bettingStructure: 'FL',
  forcedBetModel: 'ante-bringin',
  seats: 3,
  blinds: { smallBlind: 0, bigBlind: 0, ante: 1, bringIn: 2 },
  flSizing: { smallBet: 4, bigBet: 8, maxRaisesPerStreet: 4 },
  minBuyIn: 100,
  maxBuyIn: 200,
  timeouts: { decisionMs: 30000, recoveryMs: 120000 },
  signingMode: 'A',
  currency: 'play-regtest',
  suitTiebreakHouseRule: false,
  hiLo: false,
};

const seats3 = [
  { seat: 0, stack: 100 },
  { seat: 1, stack: 100 },
  { seat: 2, stack: 100 },
];

// 第三街发牌顺序（按座位轮转，3 轮）：每个座位的第 3 张牌是其明门牌。
//   seat0 = Ah Kd 2c  （门牌 2c —— 最低明牌 → bring-in）
//   seat1 = Qs Qh Ks  （门牌 Ks）
//   seat2 = 7d 3s 9h  （门牌 9h）
// 后续各街按座位顺序从牌堆尾部抽取。
function studDeck(): Card[] {
  const s0 = ['Ah', 'Kd', '2c'].map(parseCard);
  const s1 = ['Qs', 'Qh', 'Ks'].map(parseCard);
  const s2 = ['7d', '3s', '9h'].map(parseCard);
  const head: Card[] = [];
  for (let k = 0; k < 3; k++) {
    head.push(s0[k]!);
    head.push(s1[k]!);
    head.push(s2[k]!);
  }
  const used = new Set(head);
  const rest: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  return [...head, ...rest];
}

test('ante + bring-in posted; lowest up-card (2c, seat 0) brings in', () => {
  const m = createStud({ deck: studDeck() });
  const s = m.init(FL, seats3);
  assert.equal(s.phase, PHASES.THIRD);
  // 每个座位下底注 1；bring-in 座位额外下注 2（本手共投入 3）。
  assert.equal(s.seats.find((x) => x.seat === 0)!.committedThisHand, 3); // 底注 1 + bring-in 2
  assert.equal(s.seats.find((x) => x.seat === 1)!.committedThisHand, 1); // 仅底注
  assert.equal(s.seats.find((x) => x.seat === 2)!.committedThisHand, 1);
  assert.equal(s.betting.betToCall, 2); // bring-in 是当前的有效下注
  // 行动推进到 bring-in 之后的座位。
  assert.equal(s.betting.toAct, 1);
});

test('board-driven order: highest exposed board acts first post-3rd (REQ-FSM-005)', () => {
  const m = createStud({ deck: studDeck() });
  let s: StudState = m.init(FL, seats3);
  // 结束第三街：seat1 跟注，seat2 跟注，bring-in（seat0）过牌。
  s = m.apply(s, { kind: 'call', seat: 1, amount: 2 });
  s = m.apply(s, { kind: 'call', seat: 2, amount: 2 });
  s = m.apply(s, { kind: 'check', seat: 0, amount: 0 });
  assert.equal(s.phase, PHASES.FOURTH);
  // 第四街明牌：seat0 = 2c 2d（对子），seat1 = Ks 2h，seat2 = 9h 2s。
  // 成对的明面（seat0）是最高明面，先行动。
  assert.deepEqual(upCardsOf(s, 0).length, 2);
  assert.equal(s.betting.toAct, 0);
});

test('best-5-of-7 showdown: two pair (seat 0) beats one pair; whole pot awarded', () => {
  const m = createStud({ deck: studDeck() });
  let s = m.init(FL, seats3);
  const checkRound = (): void => {
    // 每条街：按明面驱动顺序进行三次过牌
    s = m.apply(s, { kind: 'check', seat: s.betting.toAct!, amount: 0 });
    s = m.apply(s, { kind: 'check', seat: s.betting.toAct!, amount: 0 });
    s = m.apply(s, { kind: 'check', seat: s.betting.toAct!, amount: 0 });
  };
  // 第三街：seat1 跟注，seat2 跟注，seat0 过牌。
  s = m.apply(s, { kind: 'call', seat: 1, amount: 2 });
  s = m.apply(s, { kind: 'call', seat: 2, amount: 2 });
  s = m.apply(s, { kind: 'check', seat: 0, amount: 0 });
  // 第四、五、六、七街：全部过牌通过。
  checkRound();
  checkRound();
  checkRound();
  checkRound();
  assert.equal(s.phase, PHASES.HAND_END);
  // 底池 = 3 份底注 + (bring-in 2 + 两次跟注 2) = 3 + 6 = 9 → seat 0（两对 4 与 2）。
  assert.deepEqual([...s.payouts], [{ seat: 0, amount: 9 }]);
  assert.equal(s.seats.find((x) => x.seat === 0)!.stack, 106); // 100 - 3 + 9
});

test('determinism: replay yields byte-identical stateHash (P2)', () => {
  const play: Action[] = [
    { kind: 'call', seat: 1, amount: 2 },
    { kind: 'call', seat: 2, amount: 2 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 2, amount: 0 },
  ];
  const run = (): StudState => {
    const m = createStud({ deck: studDeck() });
    let s = m.init(FL, seats3);
    for (const a of play) s = m.apply(s, a);
    return s;
  };
  const m = createStud({ deck: studDeck() });
  assert.equal(m.stateHash(run()), m.stateHash(run()));
  assert.equal(m.stateHash(run()).length, 64);
});
