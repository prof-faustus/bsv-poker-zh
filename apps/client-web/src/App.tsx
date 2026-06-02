/**
 * 应用外壳 —— 一个小型屏幕状态机，用于真实的、由 relay 支撑的多人对战，外加离线
 * 练习流程：
 *
 *   Connect → Lobby → WaitingRoom → NetworkTable      （经由 relay 的真实多人对战）
 *   Connect/Lobby → Practice (local Table vs bot)     （现有的离线引擎流程）
 *
 * 重要（浏览器 bundle 范围）：本应用仅经由 ui-core / app-services 导入浏览器安全的工作区
 * package：protocol-types（纯 TS sha256）、hand-eval、engine、五个游戏
 * 模块（经由 app-services createGameModule），以及 relay 传输（network.ts 中的 fetch/SSE）。
 * 它绝不导入 crypto-mentalpoker / script-templates-ts / tx-builder / wallet-custody —— 那些
 * 使用 node:crypto，属于 Node SDK 路径（§A2.3）。
 *
 * 钱包：单个 WalletService（游戏币，由 localStorage 持久化）持有玩家的余额。
 * 加入/创建会为牌桌的初始筹码量买入（若余额过低则以明确消息阻止）；离开牌桌会将剩余
 * 筹码套现回钱包。资金流动目前是本地余额 —— 实时链上后端在 Node 端单独接线。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LobbyClient,
  LocalTableClient,
  RelayClient,
  WalletService,
  type WalletPersistence,
  type WalletState,
  type OpenTable,
  type SeatedResult,
  type TableMeta,
} from '@bsv-poker/app-services';
import {
  rulesetFromForm,
  generateIdentity,
  buyInCheck,
  type NetworkTableForm,
  type SessionIdentity,
} from '@bsv-poker/ui-core/view-models';
import type { Ruleset } from '@bsv-poker/protocol-types';
import { Connect } from './screens/Connect.tsx';
import { NetworkLobby } from './screens/NetworkLobby.tsx';
import { WaitingRoom } from './screens/WaitingRoom.tsx';
import { NetworkTable } from './screens/NetworkTable.tsx';
import { Lobby } from './screens/Lobby.tsx';
import { Table } from './screens/Table.tsx';
import type { TableCreateForm } from '@bsv-poker/ui-core/view-models';

type Screen =
  | { kind: 'connect' }
  | { kind: 'lobby' }
  | { kind: 'waiting' }
  | { kind: 'networkTable'; tableId: string; tableName: string; seated: SeatedResult }
  | { kind: 'practiceForm' }
  | { kind: 'practiceTable'; client: LocalTableClient; ruleset: Ruleset };

function metaFromForm(form: NetworkTableForm): TableMeta {
  // 表单携带所选的玩法变体 + hi-lo；relay 客户端与变体无关，因此
  // 创建出的 TableMeta.variant 会直接贯通到对局。（hiLo 仅用于展示；
  // app-services 的 rulesetFromMeta 目前只构建 high-only —— 见 NetworkLobby 备注。）
  return {
    name: form.name.trim(),
    variant: form.variant,
    smallBlind: form.smallBlind,
    bigBlind: form.bigBlind,
    startingStack: form.startingStack,
    maxSeats: form.maxSeats,
    // hiLo 不属于 app-services TableMeta 的类型，但能在 relay 的 JSON 往返中保留；
    // 它会显示在大厅列表中。注意：app-services 的 rulesetFromMeta 目前在已入座一侧
    // 只构建 high-only（hiLo:false），因此联网 Omaha 在其读取 hiLo 之前按 high-only 结算。
    ...(form.variant === 'omaha' && form.hiLo ? { hiLo: true } : {}),
  } as TableMeta;
}

/** 基于 localStorage 的钱包持久化。游戏币余额可以使用 localStorage（任务
 * 允许）；承载关键作用的密钥/牌桌状态绝不能 —— 也确实没有 —— 存放于此。 */
const WALLET_KEY = 'bsv-poker.wallet.v1';
const walletPersistence: WalletPersistence = {
  load(): WalletState | null {
    try {
      const raw = globalThis.localStorage?.getItem(WALLET_KEY);
      return raw ? (JSON.parse(raw) as WalletState) : null;
    } catch {
      return null;
    }
  },
  save(state: WalletState): void {
    try {
      globalThis.localStorage?.setItem(WALLET_KEY, JSON.stringify(state));
    } catch {
      /* 存储不可用 —— 钱包在本对局内仍可在内存中工作 */
    }
  },
};

export function App(): React.JSX.Element {
  const identity = useMemo<SessionIdentity>(() => generateIdentity(), []);
  const wallet = useMemo(() => new WalletService({ persistence: walletPersistence }), []);

  // 任何钱包变更时重新渲染，使余额/历史在整个应用中保持实时。
  const [walletState, setWalletState] = useState<WalletState>(() => wallet.state());
  useEffect(() => wallet.onChange(setWalletState), [wallet]);

  const [screen, setScreen] = useState<Screen>({ kind: 'connect' });
  const [relay, setRelay] = useState('http://localhost:8091');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const lobbyRef = useRef<LobbyClient | null>(null);

  // 跟踪当前活跃的买入（table id + 金额），使离开/取消时套现正确的牌桌。
  const activeTableId = useRef<string | null>(null);
  const activeBuyIn = useRef<number>(0);

  // 等待室状态（存放在 App 中，使其在加入进行中跨多次渲染时得以保留）。
  const [waitName, setWaitName] = useState('');
  const [waitCapacity, setWaitCapacity] = useState(2);
  const [waitPlayers, setWaitPlayers] = useState<{ id: string; pub: string }[]>([]);
  const [waitError, setWaitError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const connect = useCallback(
    async (base: string): Promise<void> => {
      setConnecting(true);
      setConnectError(null);
      const lobby = new LobbyClient(new RelayClient(base));
      try {
        // listTables 兼作连通性检查（CORS / relay 可达）。
        await lobby.listTables();
        lobbyRef.current = lobby;
        setRelay(base);
        setScreen({ kind: 'lobby' });
      } catch (e) {
        setConnectError(`Could not reach relay: ${(e as Error).message}`);
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const enterWaitingRoom = useCallback(
    (tableId: string, meta: TableMeta): void => {
      const lobby = lobbyRef.current;
      if (!lobby) return;
      // 为牌桌的初始筹码量买入 —— 若过低则（以明确消息）阻止。
      const check = buyInCheck(wallet.getBalance(), meta.startingStack);
      if (!check.canAfford) {
        setConnectError(check.message);
        return;
      }
      wallet.buyIn(meta.startingStack, tableId);
      activeTableId.current = tableId;
      activeBuyIn.current = meta.startingStack;

      setWaitName(meta.name);
      setWaitCapacity(meta.maxSeats);
      setWaitPlayers([{ id: identity.id, pub: identity.pub }]);
      setWaitError(null);
      setConnectError(null);
      setScreen({ kind: 'waiting' });

      const { seated, abort } = lobby.joinWaitingRoom(
        tableId,
        { id: identity.id, pub: identity.pub },
        meta,
        (players) => setWaitPlayers([...players]),
      );
      abortRef.current = abort;
      seated.then(
        (result) => {
          abortRef.current = null;
          setScreen({ kind: 'networkTable', tableId, tableName: meta.name, seated: result });
        },
        (e) => setWaitError((e as Error).message),
      );
    },
    [identity, wallet],
  );

  const createTable = useCallback(
    async (form: NetworkTableForm): Promise<void> => {
      const lobby = lobbyRef.current;
      if (!lobby) return;
      const meta = metaFromForm(form);
      // 在 relay 上创建牌桌之前先预检查是否买得起。
      const check = buyInCheck(wallet.getBalance(), meta.startingStack);
      if (!check.canAfford) {
        setConnectError(check.message);
        return;
      }
      try {
        const tableId = await lobby.createTable(meta);
        enterWaitingRoom(tableId, meta);
      } catch (e) {
        setConnectError(`Create failed: ${(e as Error).message}`);
      }
    },
    [enterWaitingRoom, wallet],
  );

  const joinTable = useCallback(
    (table: OpenTable): void => {
      enterWaitingRoom(table.id, table.meta);
    },
    [enterWaitingRoom],
  );

  /** 将 hero 在当前牌桌的剩余筹码套现回钱包，然后进入大厅。 */
  const cashOutAndLeave = useCallback(
    (heroStack: number): void => {
      const id = activeTableId.current;
      wallet.cashOut(Math.max(0, Math.floor(heroStack)), id ?? undefined);
      activeTableId.current = null;
      activeBuyIn.current = 0;
      setScreen(lobbyRef.current ? { kind: 'lobby' } : { kind: 'connect' });
    },
    [wallet],
  );

  const cancelWaiting = useCallback((): void => {
    abortRef.current?.();
    abortRef.current = null;
    // 我们从未入座 —— 将全部买入退回钱包。
    wallet.cashOut(activeBuyIn.current, activeTableId.current ?? undefined);
    activeTableId.current = null;
    activeBuyIn.current = 0;
    setScreen({ kind: 'lobby' });
  }, [wallet]);

  function startPractice(form: TableCreateForm): void {
    const ruleset = rulesetFromForm(form);
    // 练习牌桌也要买入（若余额过低则阻止）。
    const check = buyInCheck(wallet.getBalance(), ruleset.minBuyIn);
    if (!check.canAfford) {
      setConnectError(check.message);
      setScreen({ kind: lobbyRef.current ? 'lobby' : 'connect' });
      return;
    }
    wallet.buyIn(ruleset.minBuyIn, 'practice');
    activeTableId.current = 'practice';
    activeBuyIn.current = ruleset.minBuyIn;
    const client = new LocalTableClient({ ruleset, heroSeat: 0 });
    setScreen({ kind: 'practiceTable', client, ruleset });
  }

  switch (screen.kind) {
    case 'connect':
      return (
        <Connect
          defaultRelay={relay}
          identityId={identity.id}
          connecting={connecting}
          error={connectError}
          onConnect={(base) => void connect(base)}
          onPractice={() => setScreen({ kind: 'practiceForm' })}
        />
      );

    case 'lobby':
      return (
        <NetworkLobby
          lobby={lobbyRef.current!}
          relay={relay}
          identityId={identity.id}
          wallet={wallet}
          walletState={walletState}
          createError={connectError}
          onCreate={(form) => void createTable(form)}
          onJoin={joinTable}
          onPractice={() => setScreen({ kind: 'practiceForm' })}
          onDisconnect={() => {
            lobbyRef.current = null;
            setScreen({ kind: 'connect' });
          }}
        />
      );

    case 'waiting':
      return (
        <WaitingRoom
          tableName={waitName}
          capacity={waitCapacity}
          players={waitPlayers}
          myId={identity.id}
          error={waitError}
          onCancel={cancelWaiting}
        />
      );

    case 'networkTable':
      return (
        <NetworkTable
          relay={relay}
          tableId={screen.tableId}
          tableName={screen.tableName}
          seated={screen.seated}
          onLeave={cashOutAndLeave}
        />
      );

    case 'practiceForm':
      return (
        <Lobby
          wallet={wallet}
          walletState={walletState}
          onStart={startPractice}
          onBack={() => setScreen(lobbyRef.current ? { kind: 'lobby' } : { kind: 'connect' })}
        />
      );

    case 'practiceTable':
      return <Table client={screen.client} ruleset={screen.ruleset} onLeave={cashOutAndLeave} />;
  }
}
