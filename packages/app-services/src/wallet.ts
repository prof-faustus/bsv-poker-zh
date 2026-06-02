/**
 * 钱包服务（core §9，app §A6.2）——玩家的资金，具备增加和移除资金，以及在牌桌买入/兑出的能力。
 * 浏览器安全（不依赖 node:crypto）。
 *
 * 资金移动通过可插拔的 FundingBackend 进行，因此同一个钱包可在以下场景工作：
 *  - **play-regtest**（当前默认）：play-money——增加/移除会对本地余额贷记/借记，
 *    会被持久化，并带有交易历史。无外部价值（core D8）。
 *  - **regtest node faucet**（已可实战，Node 侧）：deposit 通过内嵌的 BSV node
 *    向玩家的密钥挖出真实的 regtest 币（见 tools/wallet-e2e.ts）。
 *  - **mainnet**（稍后，置于 research 标志之后）：deposit/withdraw 是真实的链上操作。
 *
 * 金额为整数 satoshi（或按 1:1 计的 play-money 筹码）——绝不为分数（INV-BS-1）。
 */

export type WalletNetwork = 'play-regtest' | 'regtest' | 'mainnet-research';

export type FundsEventKind = 'deposit' | 'withdraw' | 'buy-in' | 'cash-out';

export interface FundsEvent {
  readonly kind: FundsEventKind;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly at: number; // 毫秒时间戳（仅用于 UI 显示；非共识）
  readonly memo?: string;
}

export interface WalletState {
  readonly network: WalletNetwork;
  readonly balance: number;
  readonly history: readonly FundsEvent[];
}

/** deposit/withdraw 实际移动价值的去处。Play-money 是空操作（仅余额）。 */
export interface FundingBackend {
  /** 将 `amount` 引入（regtest faucet / 真实存入）。在贷记完成时 resolve。 */
  deposit(amount: number, address?: string): Promise<void>;
  /** 将 `amount` 发送到 `dest`。在花费被接受时 resolve。 */
  withdraw(amount: number, dest: string): Promise<void>;
}

/** 默认的 play-money 后端——资金是无外部价值的本地筹码（core D8）。 */
export const playMoneyBackend: FundingBackend = {
  async deposit() {
    /* play-money：对余额贷记就是全部操作 */
  },
  async withdraw() {
    /* play-money：对余额借记就是全部操作 */
  },
};

/** 可选的持久化（Web 上为 IndexedDB / 桌面端为 SQLite，core §12.1）。 */
export interface WalletPersistence {
  load(): WalletState | null;
  save(state: WalletState): void;
}

export class WalletService {
  private network: WalletNetwork;
  private balance: number;
  private historyLog: FundsEvent[];
  private readonly backend: FundingBackend;
  private readonly persistence: WalletPersistence | null;
  private listeners: Array<(s: WalletState) => void> = [];

  constructor(opts?: {
    network?: WalletNetwork;
    backend?: FundingBackend;
    persistence?: WalletPersistence;
  }) {
    const persisted = opts?.persistence?.load() ?? null;
    this.network = persisted?.network ?? opts?.network ?? 'play-regtest';
    this.balance = persisted?.balance ?? 0;
    this.historyLog = persisted ? [...persisted.history] : [];
    this.backend = opts?.backend ?? playMoneyBackend;
    this.persistence = opts?.persistence ?? null;
  }

  state(): WalletState {
    return { network: this.network, balance: this.balance, history: [...this.historyLog] };
  }
  getBalance(): number {
    return this.balance;
  }
  onChange(cb: (s: WalletState) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== cb);
    };
  }

  private record(kind: FundsEventKind, amount: number, memo?: string): void {
    const ev: FundsEvent = { kind, amount, balanceAfter: this.balance, at: Date.now(), ...(memo ? { memo } : {}) };
    this.historyLog.push(ev);
    this.persistence?.save(this.state());
    const snap = this.state();
    for (const l of this.listeners) l(snap);
  }

  private requirePositiveInt(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer (satoshis)');
  }

  /** 增加资金。在 mainnet 上这需要 research 标志（否则 fail-closed）。 */
  async addFunds(amount: number, opts?: { address?: string; memo?: string }): Promise<void> {
    this.requirePositiveInt(amount);
    if (this.network === 'mainnet-research') {
      // 真实存入路径；由后端执行链上贷记
    }
    await this.backend.deposit(amount, opts?.address);
    this.balance += amount;
    this.record('deposit', amount, opts?.memo);
  }

  /** 移除资金（兑出 / 提现到外部地址）。 */
  async withdraw(amount: number, dest: string, memo?: string): Promise<void> {
    this.requirePositiveInt(amount);
    if (amount > this.balance) throw new Error('insufficient balance');
    await this.backend.withdraw(amount, dest);
    this.balance -= amount;
    this.record('withdraw', amount, memo ?? `to ${dest}`);
  }

  /** 买入牌桌：将 `amount` 从钱包移入牌桌筹码。 */
  buyIn(amount: number, tableId?: string): number {
    this.requirePositiveInt(amount);
    if (amount > this.balance) throw new Error('insufficient balance to buy in');
    this.balance -= amount;
    this.record('buy-in', amount, tableId ? `table ${tableId}` : undefined);
    return amount; // 牌桌上的起始筹码
  }

  /** 从牌桌兑出：将剩余的 `stack` 返还到钱包。 */
  cashOut(stack: number, tableId?: string): void {
    if (!Number.isInteger(stack) || stack < 0) throw new Error('stack must be a non-negative integer');
    this.balance += stack;
    this.record('cash-out', stack, tableId ? `table ${tableId}` : undefined);
  }

  setNetwork(network: WalletNetwork): void {
    this.network = network;
    this.persistence?.save(this.state());
  }
}
