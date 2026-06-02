import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateIdentity,
  bytesToHexLower,
  validateNetworkTable,
  metaFromNetworkForm,
  waitingRoomVM,
  networkSeatLabel,
  type RandomBytes,
} from '../src/view-models/network-lobby.ts';

test('bytesToHexLower pads and lowercases', () => {
  assert.equal(bytesToHexLower(Uint8Array.from([0x00, 0x0f, 0xab])), '000fab');
});

test('generateIdentity produces a readable id and a 33-byte (66-hex) compressed-shaped pub', () => {
  // 确定性 RNG：用固定字节填充，以便我们可以断言其形态。
  const rng: RandomBytes = (n) => Uint8Array.from({ length: n }, () => 0xff);
  const me = generateIdentity(rng);
  assert.equal(me.id, 'player-ffff');
  assert.equal(me.pub.length, 66); // 33 bytes
  // 首字节强制为 02/03；0xff 为奇数 → 03。
  assert.equal(me.pub.slice(0, 2), '03');
});

test('generateIdentity defaults to platform crypto and yields distinct pubs', () => {
  const a = generateIdentity();
  const b = generateIdentity();
  assert.equal(a.pub.length, 66);
  assert.notEqual(a.pub, b.pub);
  assert.match(a.pub.slice(0, 2), /^0[23]$/);
});

test('validateNetworkTable rejects bad input and accepts a sane table', () => {
  assert.equal(
    validateNetworkTable({ name: '', variant: 'holdem', smallBlind: 1, bigBlind: 2, startingStack: 100, maxSeats: 2 }).ok,
    false,
  );
  assert.equal(
    validateNetworkTable({ name: 'T', variant: 'holdem', smallBlind: 0, bigBlind: 2, startingStack: 100, maxSeats: 2 }).ok,
    false,
  );
  assert.equal(
    validateNetworkTable({ name: 'T', variant: 'holdem', smallBlind: 2, bigBlind: 2, startingStack: 100, maxSeats: 2 }).ok,
    false,
  );
  assert.equal(
    validateNetworkTable({ name: 'T', variant: 'holdem', smallBlind: 1, bigBlind: 2, startingStack: 3, maxSeats: 2 }).ok,
    false,
  );
  assert.equal(
    validateNetworkTable({ name: 'T', variant: 'holdem', smallBlind: 1, bigBlind: 2, startingStack: 100, maxSeats: 1 }).ok,
    false,
  );
  assert.equal(
    validateNetworkTable({ name: 'T', variant: 'holdem', smallBlind: 1, bigBlind: 2, startingStack: 100, maxSeats: 10 }).ok,
    false,
  );
  const ok = validateNetworkTable({
    name: '  Friday  ',
    variant: 'holdem',
    smallBlind: 1,
    bigBlind: 2,
    startingStack: 100,
    maxSeats: 6,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, []);
});

test('metaFromNetworkForm trims the name and carries the chosen variant', () => {
  const meta = metaFromNetworkForm({
    name: '  HU  ',
    variant: 'holdem',
    smallBlind: 1,
    bigBlind: 2,
    startingStack: 100,
    maxSeats: 2,
  });
  assert.equal(meta.name, 'HU');
  assert.equal(meta.variant, 'holdem');
  assert.equal(meta.maxSeats, 2);
});

test('waitingRoomVM reports progress and fullness', () => {
  const empty = waitingRoomVM([], 2);
  assert.equal(empty.joined, 0);
  assert.equal(empty.full, false);
  assert.equal(empty.statusText, 'Waiting for players (0/2)…');

  const one = waitingRoomVM([{ id: 'a', pub: '02' }], 2);
  assert.equal(one.statusText, 'Waiting for players (1/2)…');

  const full = waitingRoomVM([{ id: 'a', pub: '02' }, { id: 'b', pub: '03' }], 2);
  assert.equal(full.full, true);
  assert.match(full.statusText, /seats and starting/i);
});

test('networkSeatLabel names opponents by id and the hero as (you)', () => {
  const players = [
    { id: 'alice', pub: '02' },
    { id: 'bob', pub: '03' },
  ];
  const label = networkSeatLabel(players);
  assert.equal(label({ seat: 0, isHero: true }), '(you)');
  assert.equal(label({ seat: 1, isHero: false }), '(bob)');
  assert.equal(label({ seat: 5, isHero: false }), '(opponent)');
});
