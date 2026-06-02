/**
 * 针对扑克房间 UI 逻辑的纯视图模型测试（REQ-APP-051）：
 *   - seatPositions：椭圆座位几何（英雄锚定在底部中央，N=2..9）。
 *   - bet-sizing：sizerRange / clampToRange / quickButtons 从引擎描述符读取边界，
 *     绝不扩大合法范围。
 *   - wallet-panel：walletPanelVM 投影 + 充值/提现/买入校验。
 *   - network-lobby variant：validateNetworkTable 按变体的座位范围 + metaFromNetworkForm。
 *
 * 无 React 依赖——在 `node --test` 的类型剥离下运行。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LegalActions } from '@bsv-poker/protocol-types';
import { seatPositions } from '../src/view-models/table-layout.ts';
import { sizerRange, clampToRange, quickButtons } from '../src/view-models/bet-sizing.ts';
import {
  walletPanelVM,
  validateAmount,
  validateWithdraw,
  buyInCheck,
  type WalletSnapshot,
} from '../src/view-models/wallet-panel.ts';
import { validateNetworkTable, metaFromNetworkForm } from '../src/view-models/network-lobby.ts';

test('seatPositions: hero is anchored at the bottom centre for any seat count', () => {
  for (const count of [2, 3, 6, 9]) {
    const pos = seatPositions({ count, heroSeat: 0 });
    assert.equal(pos.length, count);
    const hero = pos.find((p) => p.isHero)!;
    // 底部中央：x ~ 50%，y 接近底部（> 90%）。
    assert.ok(Math.abs(hero.xPct - 50) < 0.5, `hero x ~50 (got ${hero.xPct})`);
    assert.ok(hero.yPct > 90, `hero y near bottom (got ${hero.yPct})`);
    // 所有坐标都在 0..100 的范围框内。
    for (const p of pos) {
      assert.ok(p.xPct >= 0 && p.xPct <= 100, `x in range (${p.xPct})`);
      assert.ok(p.yPct >= 0 && p.yPct <= 100, `y in range (${p.yPct})`);
    }
  }
});

test('seatPositions: rotates so a non-zero heroSeat sits at the bottom', () => {
  const pos = seatPositions({ count: 6, heroSeat: 3 });
  const hero = pos.find((p) => p.seat === 3)!;
  assert.equal(hero.isHero, true);
  assert.ok(Math.abs(hero.xPct - 50) < 0.5 && hero.yPct > 90);
  // 按座位索引顺序返回。
  assert.deepEqual(pos.map((p) => p.seat), [0, 1, 2, 3, 4, 5]);
});

test('seatPositions clamps an out-of-range count into 2..9', () => {
  assert.equal(seatPositions({ count: 1, heroSeat: 0 }).length, 2);
  assert.equal(seatPositions({ count: 12, heroSeat: 0 }).length, 9);
});

test('bet-sizing: sizerRange reads bounds straight from the engine descriptor', () => {
  const betLegal: LegalActions = { fold: true, check: true, bet: { min: 2, max: 100 } };
  const r = sizerRange(betLegal);
  assert.equal(r.available, true);
  assert.equal(r.kind, 'bet');
  assert.equal(r.min, 2);
  assert.equal(r.max, 100);

  const none: LegalActions = { fold: true, check: true };
  assert.equal(sizerRange(none).available, false);
});

test('bet-sizing: clampToRange never escapes the engine range and snaps to integer', () => {
  const r = sizerRange({ fold: true, check: false, raise: { min: 6, max: 80 } });
  assert.equal(clampToRange(1, r), 6); // 低于最小值 → 最小值
  assert.equal(clampToRange(999, r), 80); // 高于最大值 → 最大值
  assert.equal(clampToRange(40.7, r), 41); // 四舍五入
  assert.equal(clampToRange(NaN, r), 6); // 非法输入 → 最小值
});

test('bet-sizing: quick buttons clamp pot-relative targets into the legal band', () => {
  // 开局下注：底池 20，合法下注 2..100。底池按钮 = 20（在区间内）；全押 = 最大值。
  const range = sizerRange({ fold: true, check: true, bet: { min: 2, max: 100 } });
  const q = quickButtons({ range, pot: 20, toCall: 0 });
  const byKey = Object.fromEntries(q.map((b) => [b.key, b.amount]));
  assert.equal(byKey.min, 2);
  assert.equal(byKey['half-pot'], 10);
  assert.equal(byKey.pot, 20);
  assert.equal(byKey['all-in'], 100);

  // 超过筹码量的底池下注会落到全押（最大值），绝不会非法。
  const tight = sizerRange({ fold: true, check: true, bet: { min: 2, max: 15 } });
  const q2 = quickButtons({ range: tight, pot: 50, toCall: 0 });
  assert.equal(q2.find((b) => b.key === 'pot')!.amount, 15);

  // 无尺度控件 → 无按钮。
  assert.equal(quickButtons({ range: sizerRange({ fold: true, check: true }), pot: 10, toCall: 0 }).length, 0);
});

test('wallet-panel: projection signs history and flags play-money', () => {
  const snap: WalletSnapshot = {
    network: 'play-regtest',
    balance: 160,
    history: [
      { kind: 'deposit', amount: 200, balanceAfter: 200, at: 1 },
      { kind: 'buy-in', amount: 100, balanceAfter: 100, at: 2, memo: 'table tbl-1' },
      { kind: 'cash-out', amount: 60, balanceAfter: 160, at: 3 },
    ],
  };
  const vm = walletPanelVM(snap);
  assert.equal(vm.balance, 160);
  assert.equal(vm.playMoney, true);
  // 最新的排在最前。
  assert.equal(vm.rows[0]!.kind, 'cash-out');
  assert.equal(vm.rows[0]!.signedAmount, '+60');
  assert.equal(vm.rows[1]!.kind, 'buy-in');
  assert.equal(vm.rows[1]!.signedAmount, '-100');
  assert.equal(vm.rows[1]!.inflow, false);
});

test('wallet-panel: amount + withdraw validation', () => {
  assert.equal(validateAmount(0).ok, false);
  assert.equal(validateAmount(1.5).ok, false);
  assert.equal(validateAmount(50).ok, true);

  assert.equal(validateWithdraw(50, 100, 'addr').ok, true);
  assert.equal(validateWithdraw(150, 100, 'addr').ok, false); // 超出余额
  assert.equal(validateWithdraw(50, 100, '').ok, false); // 无地址
});

test('wallet-panel: buyInCheck blocks an unaffordable buy-in with a clear message', () => {
  const ok = buyInCheck(100, 100);
  assert.equal(ok.canAfford, true);
  const blocked = buyInCheck(40, 100);
  assert.equal(blocked.canAfford, false);
  assert.match(blocked.message, /need 100 chips/);
});

test('network-lobby: seat range validation is per-variant; meta carries variant + hi-lo', () => {
  // Draw 变体上限为 6 个座位——7 个无效。
  const draw7 = validateNetworkTable({
    name: 'd', variant: 'draw', smallBlind: 1, bigBlind: 2, startingStack: 100, maxSeats: 7,
  });
  assert.equal(draw7.ok, false);

  const omaha9 = validateNetworkTable({
    name: 'o', variant: 'omaha', smallBlind: 1, bigBlind: 2, startingStack: 100, maxSeats: 9,
  });
  assert.equal(omaha9.ok, true);

  const meta = metaFromNetworkForm({
    name: '  PLO8  ', variant: 'omaha', hiLo: true, smallBlind: 1, bigBlind: 2, startingStack: 200, maxSeats: 6,
  });
  assert.equal(meta.name, 'PLO8');
  assert.equal(meta.variant, 'omaha');
  assert.equal(meta.hiLo, true);

  // hi-lo 仅对 omaha 有意义——在其他情况下强制为 false。
  const hm = metaFromNetworkForm({
    name: 'h', variant: 'holdem', hiLo: true, smallBlind: 1, bigBlind: 2, startingStack: 100, maxSeats: 2,
  });
  assert.equal(hm.hiLo, false);
});
