/**
 * Table 屏幕（§A6.5）—— 游戏对局屏幕。它将 ui-core 的展示型组件
 * 接线到 app-services 的 LocalTableClient。人类玩家行动；每个动作在被应用前
 * 都会弹出签名模态框（§A6.7，不静默签名）；客户端自动替机器人行动，且这手牌
 * 一直进行到摊牌 + 结算。所有游戏逻辑都是真实引擎 —— 此屏幕仅渲染
 * 视图模型并发射动作（无业务逻辑，REQ-APP-052）。
 */
import React, { useMemo, useRef, useState } from 'react';
import type { LocalTableClient } from '@bsv-poker/app-services';
import type { Action, Ruleset } from '@bsv-poker/protocol-types';
import {
  tableViewModel,
  showdownViewModel,
  settlementViewModel,
  signingPromptVM,
  actionFromChoice,
  type SigningPromptVM,
} from '@bsv-poker/ui-core/view-models';
import {
  MainnetBanner,
  PokerTable,
  ActionBar,
  TimerBanner,
  SigningModal,
  ShowdownPanel,
  SettlementSummary,
} from '@bsv-poker/ui-core/components';

export function Table(props: {
  client: LocalTableClient;
  ruleset: Ruleset;
  /** 将 hero 的剩余筹码套现到钱包，然后离开。 */
  onLeave: (heroStack: number) => void;
}): React.JSX.Element {
  const { client, ruleset } = props;
  const heroSeat = client.getHeroSeat();

  // 重新渲染计数：客户端在内部进行变更；递增此值以投影新状态。
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const [betAmount, setBetAmount] = useState(ruleset.blinds.bigBlind);
  const [prompt, setPrompt] = useState<SigningPromptVM | null>(null);
  const pendingAction = useRef<Action | null>(null);

  const state = client.getState();
  const legal = client.legalActions(heroSeat);
  const resolution = client.timeout();

  const vm = useMemo(
    () =>
      tableViewModel({
        state,
        heroSeat,
        heroHole: client.getHole(heroSeat),
        legal,
        resolution,
        decisionMs: ruleset.timeouts.decisionMs,
      }),
    // 每当客户端应用一个动作时，state 的标识就会改变。
    [state, heroSeat, legal, resolution, ruleset.timeouts.decisionMs, client],
  );

  function requestAction(
    choice: 'fold' | 'check' | 'call' | 'bet' | 'raise',
    amount: number,
  ): void {
    const action = actionFromChoice(choice, heroSeat, legal, amount);
    pendingAction.current = action;
    const toCall = legal.call ? legal.call.amount : 0;
    setPrompt(signingPromptVM(action, { potBefore: vm.totalPot, toCall }));
  }

  function confirmAction(): void {
    const action = pendingAction.current;
    setPrompt(null);
    pendingAction.current = null;
    if (!action) return;
    client.apply(action);
    rerender();
  }

  function cancelAction(): void {
    setPrompt(null);
    pendingAction.current = null;
  }

  function nextHand(): void {
    client.startHand();
    setBetAmount(ruleset.blinds.bigBlind);
    rerender();
  }

  const showdown = state.handComplete
    ? showdownViewModel(state, client.getStartingStacks())
    : null;
  const settlement = state.handComplete
    ? settlementViewModel(state, client.getStartingStacks())
    : null;

  const heroStack = state.seats.find((s) => s.seat === heroSeat)?.stack ?? 0;

  return (
    <div style={{ maxWidth: 860, margin: '20px auto', padding: 16, display: 'grid', gap: 12 }}>
      <MainnetBanner regtest={ruleset.currency === 'play-regtest'} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>
          Hold'em — blinds {ruleset.blinds.smallBlind}/{ruleset.blinds.bigBlind} (phase {state.phase})
        </h2>
        <button type="button" onClick={() => props.onLeave(heroStack)}>
          Cash out &amp; leave
        </button>
      </div>

      <PokerTable vm={vm} />
      <TimerBanner timer={vm.timer} />

      {!state.handComplete ? (
        <ActionBar
          vm={vm.actionBar}
          heroSeat={heroSeat}
          betAmount={betAmount}
          onBetAmountChange={setBetAmount}
          onAction={requestAction}
          pot={vm.totalPot}
        />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {showdown && <ShowdownPanel vm={showdown} />}
          {settlement && <SettlementSummary vm={settlement} />}
          <button type="button" onClick={nextHand} style={{ padding: '8px 16px', fontSize: 16 }}>
            Deal next hand
          </button>
        </div>
      )}

      <SigningModal prompt={prompt} onConfirm={confirmAction} onCancel={cancelAction} />

      <details style={{ color: '#888', fontSize: 12 }}>
        <summary>Transcript / state hash (debug)</summary>
        <code>{client.stateHash()}</code>
      </details>
    </div>
  );
}
