/**
 * 网络大厅（§A6.3/§A6.4）—— 列出来自 relay 的开放牌桌（轮询 + 手动刷新），让
 * 玩家加入其中一个，提供带玩法变体选择器的创建牌桌表单（五种变体任选其一、
 * 在该变体范围内的座位数，以及 Omaha hi-lo 开关）、一个练习对战机器人按钮，
 * 以及一个始终可见的钱包面板（余额 / 充值 / 提现 / 历史）。纯渲染 + 显式
 * 处理函数（非 <form> 提交，REQ-UI-003）；校验/meta 来自 ui-core 的 network-lobby
 * 视图模型 —— 此屏幕从不重新计算规则。变体标签/座位范围来自
 * app-services 的 VARIANT_INFO / SUPPORTED_VARIANTS。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  LobbyClient,
  WalletService,
  VARIANT_INFO,
  SUPPORTED_VARIANTS,
  type OpenTable,
  type WalletState,
} from '@bsv-poker/app-services';
import {
  validateNetworkTable,
  VARIANT_SEAT_RANGE,
  type NetworkTableForm,
  type VariantId,
} from '@bsv-poker/ui-core/view-models';
import { MainnetBanner, WalletPanel, VariantPicker, type VariantOption } from '@bsv-poker/ui-core/components';

const VARIANT_OPTIONS: readonly VariantOption[] = SUPPORTED_VARIANTS.map((v) => ({
  id: v as VariantId,
  label: VARIANT_INFO[v].label,
  minSeats: VARIANT_INFO[v].minSeats,
  maxSeats: VARIANT_INFO[v].maxSeats,
  note: VARIANT_INFO[v].note,
}));

export function NetworkLobby(props: {
  lobby: LobbyClient;
  relay: string;
  identityId: string;
  wallet: WalletService;
  walletState: WalletState;
  createError: string | null;
  onCreate: (form: NetworkTableForm) => void;
  onJoin: (table: OpenTable) => void;
  onPractice: () => void;
  onDisconnect: () => void;
}): React.JSX.Element {
  const { lobby, wallet, walletState } = props;
  const [tables, setTables] = useState<OpenTable[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('Friday night');
  const [variant, setVariant] = useState<VariantId>('holdem');
  const [hiLo, setHiLo] = useState(false);
  const [smallBlind, setSmallBlind] = useState(1);
  const [bigBlind, setBigBlind] = useState(2);
  const [startingStack, setStartingStack] = useState(100);
  const [maxSeats, setMaxSeats] = useState(2);

  // 钱包表单状态。
  const [addAmount, setAddAmount] = useState(100);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [withdrawDest, setWithdrawDest] = useState('');

  const form: NetworkTableForm = { name, variant, hiLo, smallBlind, bigBlind, startingStack, maxSeats };
  const validation = validateNetworkTable(form);
  const seatRange = VARIANT_SEAT_RANGE[variant];

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await lobby.listTables();
      setTables(list);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [lobby]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // 当变体改变时，将座位数夹取到所选变体的范围内。
  const changeVariant = useCallback((v: VariantId): void => {
    setVariant(v);
    const r = VARIANT_SEAT_RANGE[v];
    setMaxSeats((s) => Math.min(Math.max(s, r.minSeats), r.maxSeats));
  }, []);

  return (
    <div style={{ maxWidth: 880, margin: '24px auto', padding: 16, display: 'grid', gap: 16 }}>
      <MainnetBanner regtest={true} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Lobby</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: 13 }}>
            {props.relay} · <code>{props.identityId}</code>
          </span>
          <button type="button" onClick={props.onDisconnect}>
            Disconnect
          </button>
        </div>
      </div>

      {/* 始终可见的钱包面板（头部 + 大厅）。 */}
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
      />

      {props.createError && (
        <div role="alert" style={{ color: '#f88', fontSize: 13 }}>
          {props.createError}
        </div>
      )}

      <section style={{ border: '1px solid #444', borderRadius: 8, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Open tables</h2>
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {loadError && <div style={{ color: '#f88', fontSize: 13 }}>Failed to load tables: {loadError}</div>}
        {tables.length === 0 ? (
          <p style={{ color: '#999' }}>No open tables yet — create one below.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
            {tables.map((t) => (
              <li
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: '1px solid #555',
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                <span>
                  <strong>{t.meta.name}</strong>{' '}
                  <span style={{ color: '#aaa' }}>
                    — {VARIANT_INFO[t.meta.variant]?.label ?? t.meta.variant}
                    {(t.meta as { hiLo?: boolean }).hiLo ? ' Hi-Lo' : ''} · blinds {t.meta.smallBlind}/
                    {t.meta.bigBlind}, stack {t.meta.startingStack}, {t.meta.maxSeats} seats ·{' '}
                    {t.members} present
                  </span>
                </span>
                <button type="button" onClick={() => props.onJoin(t)}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        role="group"
        aria-label="create table"
        style={{ border: '1px solid #444', borderRadius: 8, padding: 12, display: 'grid', gap: 10 }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Create a table</h2>
        <label>
          Name{' '}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 240 }} />
        </label>

        <VariantPicker
          options={VARIANT_OPTIONS}
          value={variant}
          onChange={changeVariant}
          hiLo={hiLo}
          onHiLoChange={setHiLo}
        />

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
          Seats ({seatRange.minSeats}–{seatRange.maxSeats}){' '}
          <input
            type="number"
            min={seatRange.minSeats}
            max={seatRange.maxSeats}
            value={maxSeats}
            onChange={(e) => setMaxSeats(Number(e.target.value))}
          />
        </label>
        {!validation.ok && (
          <ul style={{ color: '#f88', margin: 0 }}>
            {validation.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <p style={{ color: '#888', fontSize: 12, margin: 0 }}>
          Joining buys in for the starting stack from your wallet ({walletState.balance} chips
          available).
        </p>
        <button
          type="button"
          disabled={!validation.ok}
          onClick={() => props.onCreate(form)}
          style={{ padding: '8px 16px', fontSize: 16 }}
        >
          Create &amp; open waiting room
        </button>
      </section>

      <section style={{ border: '1px solid #444', borderRadius: 8, padding: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Offline</h2>
        <p style={{ color: '#999', marginTop: 6 }}>
          Heads-up Hold'em vs a simple bot, on the real engine — no relay needed.
        </p>
        <button type="button" onClick={props.onPractice} style={{ padding: '8px 16px', fontSize: 16 }}>
          Practice vs bot
        </button>
      </section>
    </div>
  );
}
