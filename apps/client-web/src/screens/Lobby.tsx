/**
 * 练习大厅 / 创建本地牌桌屏幕（§A6.3/§A6.4）。选择盲注/筹码量 → 启动一个与机器人对战的
 * 本地单挑 Hold'em 牌桌。非 <form> 提交 —— 使用显式 onClick（REQ-UI-003）。校验
 * 来自 ui-core 视图模型；此屏幕只负责渲染和发射事件。钱包面板也在
 * 此处显示，以便玩家在买入练习牌桌前充值。
 */
import React, { useState } from 'react';
import { WalletService, type WalletState } from '@bsv-poker/app-services';
import {
  validateTableCreate,
  type TableCreateForm,
} from '@bsv-poker/ui-core/view-models';
import { MainnetBanner, WalletPanel } from '@bsv-poker/ui-core/components';

export function Lobby(props: {
  wallet: WalletService;
  walletState: WalletState;
  onStart: (form: TableCreateForm) => void;
  onBack: () => void;
}): React.JSX.Element {
  const { wallet, walletState } = props;
  const [smallBlind, setSmallBlind] = useState(1);
  const [bigBlind, setBigBlind] = useState(2);
  const [startingStack, setStartingStack] = useState(100);
  const [decisionMs, setDecisionMs] = useState(30000);

  const [addAmount, setAddAmount] = useState(100);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [withdrawDest, setWithdrawDest] = useState('');

  const form: TableCreateForm = { smallBlind, bigBlind, startingStack, decisionMs };
  const validation = validateTableCreate(form);
  const canAfford = walletState.balance >= startingStack;

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: 16, display: 'grid', gap: 12 }}>
      <MainnetBanner regtest={true} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Practice vs bot (offline)</h1>
        <button type="button" onClick={props.onBack}>
          Back
        </button>
      </div>
      <p style={{ color: '#aaa', margin: 0 }}>
        Heads-up No-Limit Texas Hold'em vs a simple bot, played hot-seat in your browser on the real
        game engine — no relay needed. Starting your table buys in for the starting stack from your
        wallet; leaving cashes the remaining chips back out.
      </p>

      <WalletPanel
        snapshot={walletState}
        addAmount={addAmount}
        onAddAmountChange={setAddAmount}
        onAddFunds={(amount) => void wallet.addFunds(amount)}
        withdrawAmount={withdrawAmount}
        onWithdrawAmountChange={setWithdrawAmount}
        withdrawDest={withdrawDest}
        onWithdrawDestChange={setWithdrawDest}
        onWithdraw={(amount, dest) => void wallet.withdraw(amount, dest)}
        compact
      />

      <div role="group" aria-label="create table" style={{ display: 'grid', gap: 10 }}>
        <label>
          Small blind{' '}
          <input type="number" min={1} value={smallBlind} onChange={(e) => setSmallBlind(Number(e.target.value))} />
        </label>
        <label>
          Big blind{' '}
          <input type="number" min={2} value={bigBlind} onChange={(e) => setBigBlind(Number(e.target.value))} />
        </label>
        <label>
          Starting stack{' '}
          <input
            type="number"
            min={4}
            value={startingStack}
            onChange={(e) => setStartingStack(Number(e.target.value))}
          />
        </label>
        <label>
          Decision time (ms){' '}
          <input
            type="number"
            min={1000}
            step={1000}
            value={decisionMs}
            onChange={(e) => setDecisionMs(Number(e.target.value))}
          />
        </label>

        {!validation.ok && (
          <ul style={{ color: '#f88' }}>
            {validation.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {validation.ok && !canAfford && (
          <div style={{ color: '#f88', fontSize: 13 }}>
            Insufficient balance to buy in for {startingStack} (have {walletState.balance}). Add funds
            above.
          </div>
        )}

        <button
          type="button"
          disabled={!validation.ok || !canAfford}
          onClick={() => props.onStart(form)}
          style={{ padding: '8px 16px', fontSize: 16 }}
        >
          Buy in &amp; start table
        </button>
      </div>
    </div>
  );
}
