/**
 * Razz 模块测试 —— core §7.3.4, REQ-FSM-011。涵盖：最高明牌进行 bring-in；反向的
 *（最低明面优先）行动顺序；A-to-5 低牌摊牌中最小顺子击败更差的低牌（§19.D）；
 * 确定性。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, cardToString, type Card, type Ruleset, type Action } from '@bsv-poker/protocol-types';
import { allCardsOf, upCardsOf, type StudState } from '@bsv-poker/game-stud';
import { bestLow } from '@bsv-poker/hand-eval';
import { createRazz, PHASES } from '../src/razz.ts';

const RZ: Ruleset = {
  variant: 'razz',
  bettingStructure: 'FL',
  forcedBetModel: 'ante-bringin',
  seats: 2,
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

const seats2 = [
  { seat: 0, stack: 100 },
  { seat: 1, stack: 100 },
];

// 第三街发牌顺序（轮转，3 轮）：每个座位的第 3 张牌是其明门牌。
//   seat0 = Ah 2d 3c   （门牌 3c）
//   seat1 = Kh Qd Ks   （门牌 Ks —— 最高明牌 → Razz bring-in）
// 牌尾按座位顺序发第 4/5/6/7 张，构建出 seat0 的最小顺子 A-2-3-4-5。
function razzDeck(): Card[] {
  const s0 = ['Ah', '2d', '3c'].map(parseCard);
  const s1 = ['Kh', 'Qd', 'Ks'].map(parseCard);
  const tail = ['4s', 'Jd', '5h', 'Td', '8c', '9c', '7h', '8d'].map(parseCard);
  const head: Card[] = [];
  for (let k = 0; k < 3; k++) {
    head.push(s0[k]!);
    head.push(s1[k]!);
  }
  const used = new Set([...head, ...tail]);
  const rest: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  return [...head, ...tail, ...rest];
}

test('highest up-card (Ks, seat 1) brings in — reversed from stud (REQ-FSM-011 i)', () => {
  const m = createRazz({ deck: razzDeck() });
  const s = m.init(RZ, seats2);
  assert.equal(s.phase, PHASES.THIRD);
  assert.equal(cardToString(upCardsOf(s as StudState, 1)[0]!), 'Ks');
  // seat1 持有最高明牌 → 下 ante 1 + bring-in 2 = 共投入 3。
  assert.equal(s.seats.find((x) => x.seat === 1)!.committedThisHand, 3);
  assert.equal(s.seats.find((x) => x.seat === 0)!.committedThisHand, 1); // 仅 ante
  assert.equal(s.betting.toAct, 0); // 行动推进到 bring-in 之后的座位
});

test('post-3rd order reversed: LOWEST (best) exposed low acts first (REQ-FSM-011 ii)', () => {
  const m = createRazz({ deck: razzDeck() });
  let s = m.init(RZ, seats2);
  // 结束第三街：seat0 跟 bring-in，seat1（bring-in）过牌。
  s = m.apply(s, { kind: 'call', seat: 0, amount: 2 });
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  assert.equal(s.phase, PHASES.FOURTH);
  // seat0 的明面（3c, 4s —— 低牌听牌）最好；它先行动。
  assert.equal(s.betting.toAct, 0);
});

test('ace-to-five low showdown: the wheel beats a worse low (§19.D / REQ-POKER-006)', () => {
  const m = createRazz({ deck: razzDeck() });
  let s = m.init(RZ, seats2);
  s = m.apply(s, { kind: 'call', seat: 0, amount: 2 });
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  const checkRound = (): void => {
    s = m.apply(s, { kind: 'check', seat: s.betting.toAct!, amount: 0 });
    s = m.apply(s, { kind: 'check', seat: s.betting.toAct!, amount: 0 });
  };
  checkRound(); // 第四街
  checkRound(); // 第五街
  checkRound(); // 第六街
  checkRound(); // 第七街
  assert.equal(s.phase, PHASES.HAND_END);

  // seat0 的最佳低牌是最小顺子 (0, [5,4,3,2,1])；与评估器核对确认。
  const low0 = bestLow(allCardsOf(s as StudState, 0)).value;
  assert.equal(low0.pairPenalty, 0);
  assert.deepEqual([...low0.values], [5, 4, 3, 2, 1]);

  // 最小顺子赢得整个底池（2 份 ante + bring-in 2 + 跟注 2 = 6）。
  assert.deepEqual([...s.payouts], [{ seat: 0, amount: 6 }]);
  assert.equal(s.seats.find((x) => x.seat === 0)!.stack, 103); // 100 - 3 + 6
});

test('determinism: replay yields byte-identical stateHash (P2)', () => {
  const play: Action[] = [
    { kind: 'call', seat: 0, amount: 2 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
  ];
  const run = (): StudState => {
    const m = createRazz({ deck: razzDeck() });
    let s = m.init(RZ, seats2);
    for (const a of play) s = m.apply(s, a);
    return s;
  };
  const m = createRazz({ deck: razzDeck() });
  assert.equal(m.stateHash(run()), m.stateHash(run()));
  assert.equal(m.stateHash(run()).length, 64);
});
