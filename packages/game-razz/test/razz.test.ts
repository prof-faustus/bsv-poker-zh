/**
 * Razz module tests — core §7.3.4, REQ-FSM-011. Covers: highest up-card brings in; reversed
 * (lowest-board-first) acting order; ace-to-five low showdown where the wheel beats a worse
 * low (§19.D); determinism.
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

// 3rd-street deal order (round-robin, 3 rounds): each seat's 3rd card is its UP door.
//   seat0 = Ah 2d 3c   (door 3c)
//   seat1 = Kh Qd Ks   (door Ks — the HIGHEST up-card → Razz bring-in)
// Tail deals 4th/5th/6th/7th in seat order, building seat0's wheel A-2-3-4-5.
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
  // seat1 holds the highest up-card → posts ante 1 + bring-in 2 = 3 committed.
  assert.equal(s.seats.find((x) => x.seat === 1)!.committedThisHand, 3);
  assert.equal(s.seats.find((x) => x.seat === 0)!.committedThisHand, 1); // ante only
  assert.equal(s.betting.toAct, 0); // action proceeds to the seat after the bring-in
});

test('post-3rd order reversed: LOWEST (best) exposed low acts first (REQ-FSM-011 ii)', () => {
  const m = createRazz({ deck: razzDeck() });
  let s = m.init(RZ, seats2);
  // Close 3rd: seat0 calls the bring-in, seat1 (bring-in) checks.
  s = m.apply(s, { kind: 'call', seat: 0, amount: 2 });
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  assert.equal(s.phase, PHASES.FOURTH);
  // seat0 board (3c, 4s — a low draw) is best; it acts FIRST.
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
  checkRound(); // 4th
  checkRound(); // 5th
  checkRound(); // 6th
  checkRound(); // 7th
  assert.equal(s.phase, PHASES.HAND_END);

  // seat0's best low is the wheel (0, [5,4,3,2,1]); confirm against the evaluator.
  const low0 = bestLow(allCardsOf(s as StudState, 0)).value;
  assert.equal(low0.pairPenalty, 0);
  assert.deepEqual([...low0.values], [5, 4, 3, 2, 1]);

  // The wheel wins the whole pot (2 antes + bring-in 2 + call 2 = 6).
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
