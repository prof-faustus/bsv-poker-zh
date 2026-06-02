import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ByteWriter,
  bytesToHex,
  hexToBytes,
  serializeRuleset,
  rulesetHash,
  serializeAction,
} from '../src/serialize.ts';
import type { Ruleset } from '../src/ruleset.ts';
import type { Action } from '../src/actions.ts';

// Phase-1 示例规则集：regtest 上的单挑 NL 德州扑克（core D1）。
const SAMPLE: Ruleset = {
  variant: 'holdem',
  bettingStructure: 'NL',
  forcedBetModel: 'blinds',
  seats: 2,
  blinds: { smallBlind: 1, bigBlind: 2, ante: 0, bringIn: 0 },
  minBuyIn: 100,
  maxBuyIn: 200,
  timeouts: { decisionMs: 30_000, recoveryMs: 120_000 },
  signingMode: 'A',
  currency: 'play-regtest',
  suitTiebreakHouseRule: false,
  hiLo: false,
};

test('ByteWriter primitives are little-endian and bounds-checked', () => {
  assert.equal(bytesToHex(new ByteWriter().u16(0x0102).toBytes()), '0201');
  assert.equal(bytesToHex(new ByteWriter().u32(0x01020304).toBytes()), '04030201');
  assert.equal(bytesToHex(new ByteWriter().u64(1n).toBytes()), '0100000000000000');
  assert.throws(() => new ByteWriter().u8(256));
  // u64 能安全处理超过 2^53 的值（BigInt 路径）。
  assert.equal(bytesToHex(new ByteWriter().u64(2n ** 53n + 1n).toBytes()), '0100000000002000');
});

test('hex round-trip', () => {
  assert.equal(bytesToHex(hexToBytes('deadbeef')), 'deadbeef');
  assert.throws(() => hexToBytes('abc'));
});

test('serializeRuleset is deterministic and byte-exact', () => {
  const a = serializeRuleset(SAMPLE);
  const b = serializeRuleset({ ...SAMPLE });
  assert.deepEqual([...a], [...b]);
  // Phase-1 示例规则集的参考字节（由计算得出，而非手写）：
  // variant=0,struct=0(NL),forced=0(blinds),seats=2, sb=1,bb=2,ante=0,bringin=0,
  // minBuy=100,maxBuy=200, flSizing absent(0), decision=30000,recovery=120000,
  // signing=0(A),currency=0,suitTiebreak=0,hiLo=0
  const expected =
    '000000' +
    '02' +
    '0100000000000000' +
    '0200000000000000' +
    '0000000000000000' +
    '0000000000000000' +
    '6400000000000000' +
    'c800000000000000' +
    '00' +
    '30750000' +
    'c0d40100' +
    '00' +
    '00' +
    '00' +
    '00';
  assert.equal(bytesToHex(a), expected);
});

test('rulesetHash is a stable 32-byte SHA-256 hex', () => {
  const h = rulesetHash(SAMPLE);
  assert.equal(h.length, 64);
  assert.equal(h, rulesetHash({ ...SAMPLE }));
});

test('serializeAction', () => {
  const a: Action = { kind: 'raise', seat: 0, amount: 6 };
  assert.equal(bytesToHex(serializeAction(a)), '03' + '00' + '0600000000000000' + '00');
});
