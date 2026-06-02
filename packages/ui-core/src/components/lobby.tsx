/**
 * 面向大厅的展示型组件（REQ-APP-052）：WalletPanel（余额 / 充值 / 提现
 * / 历史记录 + 买入可负担性）以及 VariantPicker（在五种变体中选择一种、在该变体
 * 范围内选择座位数，以及 Omaha hi-lo 开关）。纯渲染 + 显式处理函数
 *（不使用 <form> 提交，REQ-UI-003）。无业务逻辑——金额/可负担性来自纯粹的
 * wallet-panel view-model；合法性/资金变动发生在 app-services WalletService 中。
 */
import React from 'react';
import { Chip } from './primitives.tsx';
import {
  walletPanelVM,
  validateAmount,
  validateWithdraw,
  type WalletSnapshot,
} from '../view-models/wallet-panel.ts';
import type { VariantId } from '../view-models/network-lobby.ts';

const KIND_LABEL: Record<string, string> = {
  deposit: 'Add funds',
  withdraw: 'Withdraw',
  'buy-in': 'Buy-in',
  'cash-out': 'Cash-out',
};

export function WalletPanel(props: {
  snapshot: WalletSnapshot;
  /** Controlled add-funds amount. */
  addAmount: number;
  onAddAmountChange: (n: number) => void;
  onAddFunds: (amount: number) => void;
  /** Controlled withdraw amount + destination. */
  withdrawAmount: number;
  onWithdrawAmountChange: (n: number) => void;
  withdrawDest: string;
  onWithdrawDestChange: (s: string) => void;
  onWithdraw: (amount: number, dest: string) => void;
  /** Compact header variant (less chrome) when true. */
  compact?: boolean;
}): React.JSX.Element {
  const vm = walletPanelVM(props.snapshot);
  const addV = validateAmount(props.addAmount);
  const wdV = validateWithdraw(props.withdrawAmount, vm.balance, props.withdrawDest);

  return (
    <section
      aria-label="wallet"
      style={{
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 12,
        padding: props.compact ? 10 : 14,
        background: 'linear-gradient(180deg,#1b1d23,#141519)',
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Chip value={undefined} color="#2e7d32" size={28} />
          <div>
            <div style={{ fontSize: 12, color: '#9aa' }}>Wallet balance</div>
            <div aria-label="wallet balance" style={{ fontSize: 22, fontWeight: 800, color: '#ffd24d' }}>
              {vm.balance} chips
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            color: vm.playMoney ? '#9c8' : '#f88',
            border: '1px solid currentColor',
            borderRadius: 999,
            padding: '2px 8px',
          }}
        >
          {vm.playMoney ? 'PLAY-MONEY (REGTEST)' : vm.network.toUpperCase()}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#bbb', display: 'grid', gap: 2 }}>
          Add funds
          <input
            type="number"
            min={1}
            aria-label="add funds amount"
            value={props.addAmount}
            onChange={(e) => props.onAddAmountChange(Number(e.target.value))}
            style={{ width: 110 }}
          />
        </label>
        <button
          type="button"
          disabled={!addV.ok}
          onClick={() => props.onAddFunds(props.addAmount)}
          style={{ padding: '6px 12px' }}
        >
          Add
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#bbb', display: 'grid', gap: 2 }}>
          Withdraw
          <input
            type="number"
            min={1}
            aria-label="withdraw amount"
            value={props.withdrawAmount}
            onChange={(e) => props.onWithdrawAmountChange(Number(e.target.value))}
            style={{ width: 110 }}
          />
        </label>
        <label style={{ fontSize: 12, color: '#bbb', display: 'grid', gap: 2 }}>
          To address
          <input
            type="text"
            aria-label="withdraw address"
            value={props.withdrawDest}
            onChange={(e) => props.onWithdrawDestChange(e.target.value)}
            placeholder="regtest address"
            style={{ width: 180 }}
          />
        </label>
        <button
          type="button"
          disabled={!wdV.ok}
          onClick={() => props.onWithdraw(props.withdrawAmount, props.withdrawDest)}
          style={{ padding: '6px 12px' }}
        >
          Withdraw
        </button>
      </div>
      {!wdV.ok && wdV.error && props.withdrawAmount > 0 && (
        <div style={{ color: '#f88', fontSize: 12 }}>{wdV.error}</div>
      )}

      {vm.rows.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: '#9aa', marginBottom: 4 }}>Recent transactions</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 2, fontSize: 12 }}>
            {vm.rows.map((r, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: '#ccc' }}>
                  {KIND_LABEL[r.kind] ?? r.kind}
                  {r.memo ? <span style={{ color: '#888' }}> · {r.memo}</span> : null}
                </span>
                <span style={{ color: r.inflow ? '#8f8' : '#f88', fontWeight: 700 }}>{r.signedAmount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
        Play-money balance only — persisted locally. The live on-chain deposit/withdraw backend is
        wired separately on the Node side (regtest faucet / custody, §A2.3); here Add/Withdraw move
        the local balance.
      </p>
    </section>
  );
}

export interface VariantOption {
  readonly id: VariantId;
  readonly label: string;
  readonly minSeats: number;
  readonly maxSeats: number;
  readonly note: string;
}

export function VariantPicker(props: {
  options: readonly VariantOption[];
  value: VariantId;
  onChange: (v: VariantId) => void;
  /** Omaha hi-lo toggle (only shown when omaha is selected). */
  hiLo: boolean;
  onHiLoChange: (b: boolean) => void;
}): React.JSX.Element {
  const selected = props.options.find((o) => o.id === props.value);
  return (
    <div role="group" aria-label="variant" style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#bbb' }}>Game variant</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {props.options.map((o) => {
          const active = o.id === props.value;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              onClick={() => props.onChange(o.id)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                border: active ? '2px solid #ffd24d' : '1px solid #555',
                background: active ? '#1c4a2e' : '#1a1a1a',
                color: '#fff',
                fontWeight: active ? 700 : 500,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {selected && <span style={{ fontSize: 12, color: '#9aa' }}>{selected.note} · {selected.minSeats}–{selected.maxSeats} seats</span>}
      {props.value === 'omaha' && (
        <label style={{ fontSize: 13, color: '#ddd', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={props.hiLo} onChange={(e) => props.onHiLoChange(e.target.checked)} />
          Hi-Lo split (8-or-better)
        </label>
      )}
    </div>
  );
}
