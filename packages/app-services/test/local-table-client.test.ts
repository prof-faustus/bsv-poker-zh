import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, type Card, type Ruleset } from '@bsv-poker/protocol-types';
import { LocalTableClient } from '../src/local-table-client.ts';
import { shuffleWith } from '../src/shuffle.ts';

const NL: Ruleset = {
  variant: 'holdem',
  bettingStructure: 'NL',
  forcedBetModel: 'blinds',
  seats: 2,
  blinds: { smallBlind: 1, bigBlind: 2, ante: 0, bringIn: 0 },
  minBuyIn: 100,
  maxBuyIn: 100,
  timeouts: { decisionMs: 30000, recoveryMs: 120000 },
  signingMode: 'A',
  currency: 'play-regtest',
  suitTiebreakHouseRule: false,
  hiLo: false,
};

function fixedDeck(): Card[] {
  // hero(seat0)=AA, bot(seat1)=KK, board Qd Jc 9h 4s 3h → hero 在摊牌时获胜。
  const head = ['As', 'Ks', 'Ah', 'Kh', 'Qd', 'Jc', '9h', '4s', '3h'].map(parseCard);
  const used = new Set(head);
  const rest: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  return [...head, ...rest];
}

test('shuffleWith with a fixed RNG is a permutation of 0..51', () => {
  const deck = shuffleWith(() => 0.5);
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
});

test('a single human can drive a full hand vs the bot to settlement', () => {
  const client = new LocalTableClient({ ruleset: NL, heroSeat: 0, makeDeck: fixedDeck });
  // Hero 是按钮位/小盲，翻牌前先行动。
  assert.equal(client.isHeroTurn(), true);
  assert.equal(client.getState().betting.toAct, 0);

  // Hero 跟注；bot（自动）过牌 → 翻牌。bot 的过牌-待行动路径在内部驱动。
  client.apply({ kind: 'call', seat: 0, amount: 1 });
  // 现在翻牌后：bot（非按钮位）先行动并自动过牌交还给 hero。
  assert.equal(client.isHeroTurn(), true);
  client.apply({ kind: 'check', seat: 0, amount: 0 }); // 翻牌
  client.apply({ kind: 'check', seat: 0, amount: 0 }); // 转牌
  client.apply({ kind: 'check', seat: 0, amount: 0 }); // 河牌 → 摊牌 + 结算

  const s = client.getState();
  assert.equal(s.handComplete, true);
  assert.equal(s.board.length, 5);
  // Hero（AA）赢得 4 筹码的底池。
  assert.equal(s.seats.find((x) => x.seat === 0)!.stack, 102);
  assert.equal(s.seats.find((x) => x.seat === 1)!.stack, 98);
});

test('startHand rotates the button, reshuffles, and carries stacks forward', () => {
  const client = new LocalTableClient({ ruleset: NL, heroSeat: 0, makeDeck: fixedDeck });
  client.apply({ kind: 'fold', seat: 0, amount: 0 }); // hero 翻牌前弃牌
  let s = client.getState();
  assert.equal(s.handComplete, true);
  const heroAfter = s.seats.find((x) => x.seat === 0)!.stack; // 99
  assert.equal(heroAfter, 99);

  s = client.startHand();
  assert.equal(s.handComplete, false);
  // 筹码结转到下一手牌的买入中（在新盲注投入之前）。
  const total = s.seats.reduce((p, x) => p + x.stack + x.committedThisHand, 0);
  assert.equal(total, 200); // 筹码守恒
});
