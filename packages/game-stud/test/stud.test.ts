/**
 * Seven-Card Stud module tests — core §7.3.2, REQ-FSM-005/008. Covers: ante + bring-in posted;
 * lowest up-card brings in; board-driven acting order (highest board acts first post-3rd);
 * best-5-of-7 showdown; determinism.
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

// 3rd-street deal order (round-robin by seat, 3 rounds): each seat's 3rd card is its UP door.
//   seat0 = Ah Kd 2c  (door 2c — the LOWEST up-card → bring-in)
//   seat1 = Qs Qh Ks  (door Ks)
//   seat2 = 7d 3s 9h  (door 9h)
// Subsequent streets draw from the deck tail in seat order.
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
  // Every seat antes 1; the bring-in seat additionally posts 2 (committed 3 this hand).
  assert.equal(s.seats.find((x) => x.seat === 0)!.committedThisHand, 3); // ante 1 + bring-in 2
  assert.equal(s.seats.find((x) => x.seat === 1)!.committedThisHand, 1); // ante only
  assert.equal(s.seats.find((x) => x.seat === 2)!.committedThisHand, 1);
  assert.equal(s.betting.betToCall, 2); // bring-in is the live bet
  // Action proceeds to the seat after the bring-in.
  assert.equal(s.betting.toAct, 1);
});

test('board-driven order: highest exposed board acts first post-3rd (REQ-FSM-005)', () => {
  const m = createStud({ deck: studDeck() });
  let s: StudState = m.init(FL, seats3);
  // Close 3rd street: seat1 calls, seat2 calls, bring-in (seat0) checks.
  s = m.apply(s, { kind: 'call', seat: 1, amount: 2 });
  s = m.apply(s, { kind: 'call', seat: 2, amount: 2 });
  s = m.apply(s, { kind: 'check', seat: 0, amount: 0 });
  assert.equal(s.phase, PHASES.FOURTH);
  // 4th-street up-cards: seat0 = 2c 2d (PAIR), seat1 = Ks 2h, seat2 = 9h 2s.
  // The paired board (seat0) is the highest exposed board and acts FIRST.
  assert.deepEqual(upCardsOf(s, 0).length, 2);
  assert.equal(s.betting.toAct, 0);
});

test('best-5-of-7 showdown: two pair (seat 0) beats one pair; whole pot awarded', () => {
  const m = createStud({ deck: studDeck() });
  let s = m.init(FL, seats3);
  const checkRound = (): void => {
    // each street: three checks in board-driven order
    s = m.apply(s, { kind: 'check', seat: s.betting.toAct!, amount: 0 });
    s = m.apply(s, { kind: 'check', seat: s.betting.toAct!, amount: 0 });
    s = m.apply(s, { kind: 'check', seat: s.betting.toAct!, amount: 0 });
  };
  // 3rd street: seat1 call, seat2 call, seat0 check.
  s = m.apply(s, { kind: 'call', seat: 1, amount: 2 });
  s = m.apply(s, { kind: 'call', seat: 2, amount: 2 });
  s = m.apply(s, { kind: 'check', seat: 0, amount: 0 });
  // 4th, 5th, 6th, 7th: check through.
  checkRound();
  checkRound();
  checkRound();
  checkRound();
  assert.equal(s.phase, PHASES.HAND_END);
  // Pot = 3 antes + (bring-in 2 + two calls 2) = 3 + 6 = 9 → seat 0 (two pair 4s & 2s).
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
