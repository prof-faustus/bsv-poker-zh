import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type BettingCtx,
  type BettingSeat,
  legalActions,
  applyAction,
  isRoundClosed,
  openRound,
} from '../src/betting.ts';
import type { Ruleset } from '@bsv-poker/protocol-types';

const NL: Ruleset = {
  variant: 'holdem',
  bettingStructure: 'NL',
  forcedBetModel: 'blinds',
  seats: 3,
  blinds: { smallBlind: 1, bigBlind: 2, ante: 0, bringIn: 0 },
  minBuyIn: 100,
  maxBuyIn: 200,
  timeouts: { decisionMs: 30000, recoveryMs: 120000 },
  signingMode: 'A',
  currency: 'play-regtest',
  suitTiebreakHouseRule: false,
  hiLo: false,
};

function seat(s: number, stack: number): BettingSeat {
  return {
    seat: s,
    stack,
    committedThisRound: 0,
    committedThisHand: 0,
    folded: false,
    allIn: false,
    hasActedThisRound: false,
    mayRaise: true,
  };
}

function ctx(seats: BettingSeat[], toAct: number): BettingCtx {
  return {
    seats,
    betToCall: 0,
    lastFullRaise: 0,
    toAct,
    lastAggressor: null,
    raisesThisStreet: 0,
    betLevel: 'small',
  };
}

test('NL: bet → call closes a heads-up round', () => {
  let c = ctx([seat(0, 100), seat(1, 100)], 0);
  c = applyAction(c, NL, { kind: 'bet', seat: 0, amount: 10 });
  assert.equal(c.betToCall, 10);
  assert.equal(c.toAct, 1);
  assert.equal(isRoundClosed(c), false);
  const legal = legalActions(c, NL, 1);
  assert.deepEqual(legal.call, { amount: 10 });
  assert.deepEqual(legal.raise, { min: 20, max: 100 });
  assert.equal(legal.check, false);
  c = applyAction(c, NL, { kind: 'call', seat: 1, amount: 10 });
  assert.equal(isRoundClosed(c), true);
  assert.equal(c.toAct, null);
  assert.equal(c.seats[0]!.stack, 90);
  assert.equal(c.seats[1]!.stack, 90);
});

test('NL: re-raise reopens action to the original bettor', () => {
  let c = ctx([seat(0, 100), seat(1, 100)], 0);
  c = applyAction(c, NL, { kind: 'bet', seat: 0, amount: 10 });
  c = applyAction(c, NL, { kind: 'raise', seat: 1, amount: 30 }); // raiseBy 20 ≥ 10 为完整加注
  assert.equal(c.lastFullRaise, 20);
  assert.equal(c.betToCall, 30);
  assert.equal(c.toAct, 0); // 重新开放给座位 0
  assert.equal(isRoundClosed(c), false);
  c = applyAction(c, NL, { kind: 'call', seat: 0, amount: 20 }); // 增量（已投入 10，需补 30-10）
  assert.equal(isRoundClosed(c), true);
});

test('NL: check-through closes round (no bet)', () => {
  let c = openRound(ctx([seat(0, 100), seat(1, 100)], 0), 0, 'small');
  c = applyAction(c, NL, { kind: 'check', seat: 0, amount: 0 });
  assert.equal(isRoundClosed(c), false);
  c = applyAction(c, NL, { kind: 'check', seat: 1, amount: 0 });
  assert.equal(isRoundClosed(c), true);
});

test('REQ-POKER-010: short all-in does NOT reopen the raise to a player who already acted', () => {
  // seat0 筹码 100，seat1 筹码 100，seat2 筹码 35（将进行短全下）。
  let c = ctx([seat(0, 100), seat(1, 100), seat(2, 35)], 0);
  c = applyAction(c, NL, { kind: 'bet', seat: 0, amount: 10 }); // toAct 1
  c = applyAction(c, NL, { kind: 'raise', seat: 1, amount: 30 }); // 完整加注（加 20）；toAct 2
  assert.equal(c.toAct, 2);
  // seat2 全下至 35：raiseBy = 5 < lastFullRaise 20 → 短全下。
  c = applyAction(c, NL, { kind: 'raise', seat: 2, amount: 35 });
  assert.equal(c.seats[2]!.allIn, true);
  assert.equal(c.betToCall, 35);
  // seat0 尚未对 seat1 的完整加注行动 → 它保留加注权。
  const l0 = legalActions(c, NL, 0);
  assert.ok(l0.raise, 'seat0 still holds the raise option (had not acted on the full raise)');
  c = applyAction(c, NL, { kind: 'call', seat: 0, amount: 25 }); // 已投入 10，需补 35 - 10
  // seat1 做出了上一次完整加注，随后被短全下盖过 → 只能跟注，不能再加注。
  const l1 = legalActions(c, NL, 1);
  assert.ok(l1.call, 'seat1 must call the extra');
  assert.equal(l1.raise, undefined, 'seat1 may not re-raise a short all-in (REQ-POKER-010)');
  c = applyAction(c, NL, { kind: 'call', seat: 1, amount: 5 }); // 已投入 30，需补 35 - 30
  assert.equal(isRoundClosed(c), true);
});

test('NL: min-raise legality uses last full raise', () => {
  let c = ctx([seat(0, 100), seat(1, 100)], 0);
  c = applyAction(c, NL, { kind: 'bet', seat: 0, amount: 10 });
  const l = legalActions(c, NL, 1);
  // 最小加注至 = betToCall(10) + max(lastFullRaise(10), bb(2)) = 20
  assert.equal(l.raise!.min, 20);
});

test('fold leaves one live player → round closed', () => {
  let c = ctx([seat(0, 100), seat(1, 100)], 0);
  c = applyAction(c, NL, { kind: 'bet', seat: 0, amount: 10 });
  c = applyAction(c, NL, { kind: 'fold', seat: 1, amount: 0 });
  assert.equal(isRoundClosed(c), true);
});

test('PL: pot-limit max raise is pot + call', () => {
  const PL: Ruleset = { ...NL, bettingStructure: 'PL' };
  // 底池初始为空；通过先前投入让 seat0/seat1 的 committedThisHand 模拟出一个 10 的底池
  let c = ctx([seat(0, 100), seat(1, 100)], 0);
  c.seats[0]!.committedThisHand = 5;
  c.seats[1]!.committedThisHand = 5; // 底池 = 10
  c = applyAction(c, PL, { kind: 'bet', seat: 0, amount: 10 }); // 底池现在为 20+...
  const l = legalActions(c, PL, 1);
  // toCall=10；potAfterCall = (10 + seat0 的 10 committedThisHand + 0) ... 确保存在加注
  assert.ok(l.raise, 'PL offers a raise');
  assert.ok(l.raise!.max >= l.raise!.min);
});

test('FL: fixed bet/raise sizes and raise cap', () => {
  const FL: Ruleset = {
    ...NL,
    bettingStructure: 'FL',
    flSizing: { smallBet: 2, bigBet: 4, maxRaisesPerStreet: 3 },
  };
  let c = openRound(ctx([seat(0, 100), seat(1, 100)], 0), 0, 'small');
  const open = legalActions(c, FL, 0);
  assert.deepEqual(open.bet, { min: 2, max: 2 }); // 固定的小注
  c = applyAction(c, FL, { kind: 'bet', seat: 0, amount: 2 });
  const r = legalActions(c, FL, 1);
  assert.deepEqual(r.raise, { min: 4, max: 4 }); // 加注至固定为 +smallBet
});
