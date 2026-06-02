/**
 * Five-Card Draw module tests — core §7.3.3, REQ-FSM-004 / 009 / 010. Covers: deal 5;
 * discard+redraw changes the hand and the count is public; stand-pat default; the second
 * betting round; showdown best-5; determinism.
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

// Deal order (button-first, 5 rounds): seat0 = deck[0,2,4,6,8]; seat1 = deck[1,3,5,7,9].
// Undealt tail starts at deck[10] and supplies redraws in order.
//   seat0 dealt: Ah Kh Qh Jh 2c  (four to a royal-ish + a junk 2c)
//   seat1 dealt: 9s 9d 4c 5h 7s  (pair of nines)
//   tail[10..] : Th ...          (seat0 discards the 2c (slot 4) and draws Th → Ah Kh Qh Jh Th
//                                 = a ROYAL FLUSH in hearts, beating seat1's pair)
function drawDeck(): Card[] {
  const s0 = ['Ah', 'Kh', 'Qh', 'Jh', '2c'].map(parseCard);
  const s1 = ['9s', '9d', '4c', '5h', '7s'].map(parseCard);
  const tail = ['Th'].map(parseCard); // first redraw card
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
  // BET1: SB completes, BB checks → DRAW opens.
  s = m.apply(s, { kind: 'call', seat: 0, amount: 1 });
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  assert.equal(s.phase, PHASES.DRAW);
  assert.equal(s.drawToAct, 1); // first live seat left-of-button draws first (HU: non-button)

  // seat1 stands pat; seat0 discards the junk 2c (slot 4) and redraws.
  s = m.apply(s, { kind: 'stand', seat: 1, amount: 0, discard: [] });
  assert.equal(s.drawCounts[1], 0); // public count
  s = m.apply(s, { kind: 'draw', seat: 0, amount: 0, discard: [4] });
  assert.equal(s.drawCounts[0], 1); // public count of 1 card drawn
  // seat0 hand now Ah Kh Qh Jh Th (royal flush); identity is engine-known but the COUNT is public.
  assert.deepEqual([...s.hole[0]!], ['Ah', 'Kh', 'Qh', 'Jh', 'Th'].map(parseCard));
  assert.equal(s.hole[0]!.length, 5);

  // After both have drawn, the second betting round opens.
  assert.equal(s.phase, PHASES.BET2);
});

test('second betting round then showdown: improved hand wins the pot', () => {
  const m = createDraw({ deck: drawDeck() });
  let s = m.init(NL, seats);
  s = m.apply(s, { kind: 'call', seat: 0, amount: 1 });
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  s = m.apply(s, { kind: 'stand', seat: 1, amount: 0, discard: [] });
  s = m.apply(s, { kind: 'draw', seat: 0, amount: 0, discard: [4] });
  // BET2: non-button (seat1) acts first; both check → showdown.
  assert.equal(s.betting.toAct, 1);
  s = m.apply(s, { kind: 'check', seat: 1, amount: 0 });
  s = m.apply(s, { kind: 'check', seat: 0, amount: 0 });
  assert.equal(s.phase, PHASES.HAND_END);
  // seat0 (royal flush) beats seat1 (pair of nines); pot = 2 + 2 = 4.
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
