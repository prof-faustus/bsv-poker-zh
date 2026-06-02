import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCard,
  cardToString,
  cardRank,
  cardSuit,
  compareRank,
  lowRankValue,
  isCard,
  NUM_CARDS,
} from '../src/cards.ts';

test('card encoding matches the oracle (rank*4+suit; 2=0..A=12; c,d,h,s)', () => {
  // 来自预言机输出：As=51, Ts=35, 9h=30, Ac=48, 5c=12。
  assert.equal(parseCard('As'), 51);
  assert.equal(parseCard('Ts'), 35);
  assert.equal(parseCard('9h'), 30);
  assert.equal(parseCard('Ac'), 48);
  assert.equal(parseCard('5c'), 12);
  assert.equal(parseCard('2c'), 0);
});

test('round-trips for all 52 cards', () => {
  for (let c = 0; c < NUM_CARDS; c++) {
    assert.ok(isCard(c));
    assert.equal(parseCard(cardToString(c)), c);
  }
});

test('rank/suit/compareRank/lowRankValue', () => {
  assert.equal(cardRank(parseCard('As')), 12);
  assert.equal(cardSuit(parseCard('As')), 3);
  assert.equal(compareRank(parseCard('As')), 14);
  assert.equal(compareRank(parseCard('2c')), 2);
  assert.equal(lowRankValue(parseCard('As')), 1); // ace is low
  assert.equal(lowRankValue(parseCard('2c')), 2);
  assert.equal(lowRankValue(parseCard('Kd')), 13);
});
