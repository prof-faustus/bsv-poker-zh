import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, type Card, type Ruleset, type Action } from '@bsv-poker/protocol-types';
import { createHoldem, type HoldemState } from '@bsv-poker/game-holdem';
import { showdownViewModel, settlementViewModel } from '../src/view-models/showdown.ts';
import { signingPromptVM, actionFromChoice } from '../src/view-models/signing.ts';
import { validateTableCreate, rulesetFromForm } from '../src/view-models/lobby.ts';

const NL: Ruleset = {
  variant: 'holdem',
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

function fixedDeck(): Card[] {
  // seat0 = AA，seat1 = KK，公共牌 Qd Jc 9h 4s 3h → seat0 获胜。
  const head = ['As', 'Ks', 'Ah', 'Kh', 'Qd', 'Jc', '9h', '4s', '3h'].map(parseCard);
  const used = new Set(head);
  const rest: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  return [...head, ...rest];
}

const seats = [
  { seat: 0, stack: 100 },
  { seat: 1, stack: 100 },
];

function playToShowdown(): HoldemState {
  const m = createHoldem({ deck: fixedDeck() });
  let s = m.init(NL, seats);
  const play: Action[] = [
    { kind: 'call', seat: 0, amount: 1 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
    { kind: 'check', seat: 1, amount: 0 },
    { kind: 'check', seat: 0, amount: 0 },
  ];
  for (const a of play) s = m.apply(s, a);
  return s;
}

test('showdownViewModel reveals contested hands and the winning amount', () => {
  const s = playToShowdown();
  assert.equal(s.handComplete, true);
  const vm = showdownViewModel(s, new Map([[0, 100], [1, 100]]));
  assert.equal(vm.uncontested, false);
  assert.equal(vm.board.length, 5);
  const s0 = vm.seats.find((x) => x.seat === 0)!;
  assert.equal(s0.holeCards.length, 2);
  assert.equal(s0.won, 4); // 底池 2+2
});

test('settlementViewModel reports per-seat net deltas from starting stacks', () => {
  const s = playToShowdown();
  const vm = settlementViewModel(s, new Map([[0, 100], [1, 100]]));
  const r0 = vm.rows.find((r) => r.seat === 0)!;
  const r1 = vm.rows.find((r) => r.seat === 1)!;
  assert.equal(r0.delta, 2); // 102 - 100
  assert.equal(r1.delta, -2);
  assert.equal(r0.endingStack, 102);
});

test('signing prompt states the action + amount + pot effect; discloses no real signing', () => {
  const action: Action = { kind: 'call', seat: 0, amount: 1 };
  const vm = signingPromptVM(action, { potBefore: 3, toCall: 1 });
  assert.equal(vm.action.kind, 'call');
  assert.ok(vm.lines.some((l) => /CALL/.test(l)));
  assert.ok(vm.lines.some((l) => /Pot before/.test(l)));
  assert.match(vm.disclosure, /No key is used|no transaction/i);
});

test('actionFromChoice builds the concrete action from the engine legal descriptor', () => {
  const legal = { check: false, call: { amount: 1 }, fold: true } as const;
  assert.deepEqual(actionFromChoice('call', 0, legal, 0), { kind: 'call', seat: 0, amount: 1 });
  assert.deepEqual(actionFromChoice('fold', 0, legal, 0), { kind: 'fold', seat: 0, amount: 0 });
  assert.deepEqual(actionFromChoice('raise', 0, legal, 8), { kind: 'raise', seat: 0, amount: 8 });
});

test('lobby validation rejects bad blinds/stacks and builds a regtest ruleset', () => {
  assert.equal(validateTableCreate({ smallBlind: 0, bigBlind: 2, startingStack: 100, decisionMs: 30000 }).ok, false);
  assert.equal(validateTableCreate({ smallBlind: 2, bigBlind: 2, startingStack: 100, decisionMs: 30000 }).ok, false);
  const v = validateTableCreate({ smallBlind: 1, bigBlind: 2, startingStack: 100, decisionMs: 30000 });
  assert.equal(v.ok, true);
  const rs = rulesetFromForm({ smallBlind: 1, bigBlind: 2, startingStack: 100, decisionMs: 30000 });
  assert.equal(rs.variant, 'holdem');
  assert.equal(rs.currency, 'play-regtest');
  assert.equal(rs.blinds.bigBlind, 2);
  assert.equal(rs.minBuyIn, 100);
});
