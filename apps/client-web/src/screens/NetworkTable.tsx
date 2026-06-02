/**
 * 联网牌桌（§A6.5/§A7）—— 经由 relay 的真实多人对战。它从已入座结果构建一个
 * InteractiveNetworkedTableClient，由其 onUpdate 流驱动 React 状态，
 * 经由 ui-core 渲染座位/公共牌/底池/计时器，并在 hero 回合时弹出签名
 * 模态框（不静默签名，§A6.7），然后再调用 client.submitAction()。当这手牌完成时
 * client.play() 兑现 → 我们展示摊牌 + 结算。底牌会为 hero
 * 自己的座位（我们知道的）渲染。这里没有游戏逻辑 —— 合法性经由
 * 更新中的 `legal` / client.legalActions() 从引擎读取（REQ-APP-052）。
 *
 * InteractiveNetworkedTableClient 每个实例恰好玩一手牌（熵的
 * commit/reveal 握手是每手一次的）；结算后玩家返回大厅。
 * 多手对局会按每手重新执行握手 —— 那超出此处范围，特此注明。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  InteractiveNetworkedTableClient,
  type ClientUpdate,
  type SeatedResult,
} from '@bsv-poker/app-services';
import { RelayClient } from '@bsv-poker/app-services';
import type { Action } from '@bsv-poker/protocol-types';
import type { HoldemState } from '@bsv-poker/game-holdem';
import {
  tableViewModel,
  showdownViewModel,
  settlementViewModel,
  signingPromptVM,
  actionFromChoice,
  networkSeatLabel,
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

export function NetworkTable(props: {
  relay: string;
  tableId: string;
  tableName: string;
  seated: SeatedResult;
  /** 将 hero 的剩余筹码（最终或当前）套现到钱包，然后离开。 */
  onLeave: (heroStack: number) => void;
}): React.JSX.Element {
  const { seated } = props;
  const heroSeat = seated.mySeat;
  const ruleset = seated.ruleset;

  const startingStacks = useMemo(
    () => new Map(seated.seats.map((s) => [s.seat, s.stack])),
    [seated.seats],
  );

  // 仅构建一次客户端（每次挂载）。play() 先执行握手，然后进行这手牌。
  const clientRef = useRef<InteractiveNetworkedTableClient | null>(null);
  if (clientRef.current === null) {
    const entropy = new Uint8Array(32);
    (globalThis.crypto as Crypto).getRandomValues(entropy);
    clientRef.current = new InteractiveNetworkedTableClient({
      relay: new RelayClient(props.relay),
      tableId: props.tableId,
      mySeat: seated.mySeat,
      seats: seated.seats,
      ruleset: seated.ruleset,
      entropy,
    });
  }
  const client = clientRef.current;

  const [update, setUpdate] = useState<ClientUpdate | null>(null);
  const [finalState, setFinalState] = useState<HoldemState | null>(null);
  const [status, setStatus] = useState('Agreeing the deck (commit/reveal handshake)…');
  const [error, setError] = useState<string | null>(null);

  const [betAmount, setBetAmount] = useState(ruleset.blinds.bigBlind);
  const [prompt, setPrompt] = useState<SigningPromptVM | null>(null);
  const pendingAction = useRef<Action | null>(null);

  useEffect(() => {
    const off = client.onUpdate((u) => {
      setUpdate(u);
      if (!u.complete) setStatus('');
    });
    let cancelled = false;
    // 一张连续的牌桌：一手接一手地玩（重新洗牌、延续筹码、轮转庄家按钮）
    // 直到玩家离开（client.abort()）或牌桌无法继续。
    client
      .playSession({ maxHands: 100 })
      .then(() => {
        // 交互式客户端与变体无关（GameState）；此屏幕渲染
        // holdem 形态的投影。运行时形态匹配；在边界处收窄类型。
        const s = client.getState();
        if (!cancelled && s) setFinalState(s as HoldemState);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
      client.abort();
      off();
    };
    // client 在本组件的生命周期内保持稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 将 GameState（与变体无关）收窄为此屏幕渲染的 holdem 形态状态。
  const state = (update?.state ?? null) as HoldemState | null;
  const heroHole = state ? (state.hole?.[heroSeat] ?? []) : [];
  const legal = update?.yourTurn ? client.legalActions() : null;

  const vm = useMemo(() => {
    if (!state) return null;
    return tableViewModel({
      state,
      heroSeat,
      heroHole,
      // 当不是我们的回合时，我们没有合法动作；传入一个空的描述符。
      legal: legal ?? { check: false, fold: false },
      // 超时/后果文案需要引擎的判定结果；交互式客户端并不
      // 暴露它，因此我们呈现一行中性文案（引擎仍会经由 relay 强制执行回合）。
      resolution: null,
      decisionMs: ruleset.timeouts.decisionMs,
    });
  }, [state, heroSeat, heroHole, legal, ruleset.timeouts.decisionMs]);

  function requestAction(
    choice: 'fold' | 'check' | 'call' | 'bet' | 'raise',
    amount: number,
  ): void {
    if (!legal) return;
    const action = actionFromChoice(choice, heroSeat, legal, amount);
    pendingAction.current = action;
    const toCall = legal.call ? legal.call.amount : 0;
    setPrompt(signingPromptVM(action, { potBefore: vm?.totalPot ?? 0, toCall }));
  }

  function confirmAction(): void {
    const action = pendingAction.current;
    setPrompt(null);
    pendingAction.current = null;
    if (action) client.submitAction(action);
  }

  function cancelAction(): void {
    setPrompt(null);
    pendingAction.current = null;
  }

  const seatLabel = useMemo(() => networkSeatLabel(seated.players), [seated.players]);

  const showdown = finalState ? showdownViewModel(finalState, startingStacks) : null;
  const settlement = finalState ? settlementViewModel(finalState, startingStacks) : null;

  // 离开时套现回钱包的 hero 剩余筹码（若这手牌已完成则用最终状态，
  // 否则用实时状态，再否则用初始买入）。
  const heroStack =
    (finalState ?? state)?.seats.find((s) => s.seat === heroSeat)?.stack ??
    (startingStacks.get(heroSeat) ?? 0);

  return (
    <div style={{ maxWidth: 860, margin: '20px auto', padding: 16, display: 'grid', gap: 12 }}>
      <MainnetBanner regtest={ruleset.currency === 'play-regtest'} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>
          {props.tableName} — blinds {ruleset.blinds.smallBlind}/{ruleset.blinds.bigBlind}
          {state ? ` (phase ${state.phase})` : ''}
        </h2>
        <button type="button" onClick={() => props.onLeave(heroStack)}>
          Cash out &amp; leave
        </button>
      </div>

      {error && (
        <div role="alert" style={{ color: '#f88' }}>
          Table error: {error}
        </div>
      )}
      {status && !error && <div style={{ color: '#aaa' }}>{status}</div>}

      {vm && (
        <>
          <PokerTable vm={vm} seatLabel={seatLabel} />
          <TimerBanner timer={vm.timer} />

          {!finalState ? (
            update?.yourTurn ? (
              <ActionBar
                vm={vm.actionBar}
                heroSeat={heroSeat}
                betAmount={betAmount}
                onBetAmountChange={setBetAmount}
                onAction={requestAction}
                pot={vm.totalPot}
              />
            ) : (
              <div role="group" aria-label="actions" style={{ color: '#999', padding: 8 }}>
                Waiting for the other player(s)…
              </div>
            )
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {showdown && <ShowdownPanel vm={showdown} />}
              {settlement && <SettlementSummary vm={settlement} />}
              <p style={{ color: '#aaa', fontSize: 13 }}>
                Hand complete. A networked table plays one hand per session (the deck handshake is
                per-hand); return to the lobby to play another.
              </p>
              <button
                type="button"
                onClick={() => props.onLeave(heroStack)}
                style={{ padding: '8px 16px', fontSize: 16 }}
              >
                Cash out &amp; back to lobby
              </button>
            </div>
          )}
        </>
      )}

      <SigningModal prompt={prompt} onConfirm={confirmAction} onCancel={cancelAction} />
    </div>
  );
}
