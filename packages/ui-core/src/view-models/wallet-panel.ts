/**
 * 钱包面板 view-model（REQ-APP-051；core §9 / §A6.2）—— 把钱包快照纯投影为
 * 渲染 props，并为充值/提现/买入流程提供纯校验。
 *
 * ui-core 必须不导入 app-services，因此钱包形状在此处以结构性方式镜像
 *（与 app-services WalletService.state() 匹配）。不依赖 React / 无 I/O——
 * 适合 `node --test` 的类型剥离环境。
 */

/** app-services FundsEventKind 的结构性镜像。 */
export type WalletEventKind = 'deposit' | 'withdraw' | 'buy-in' | 'cash-out';

export interface WalletEventVM {
  readonly kind: WalletEventKind;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly at: number;
  readonly memo?: string;
}

/** app-services WalletState 的结构性镜像。 */
export interface WalletSnapshot {
  readonly network: string;
  readonly balance: number;
  readonly history: readonly WalletEventVM[];
}

export interface WalletRow {
  readonly kind: WalletEventKind;
  /** 带符号的显示标签，例如充值 "+100"、买入 "-40"。 */
  readonly signedAmount: string;
  readonly balanceAfter: number;
  readonly memo: string;
  /** 流入（充值 / 兑现）为 true——渲染为绿色；流出渲染为红色。 */
  readonly inflow: boolean;
}

export interface WalletPanelVM {
  readonly network: string;
  readonly balance: number;
  /** 是否为模拟币（决定横幅显示）。 */
  readonly playMoney: boolean;
  /** 最新在前的历史记录行（为显示而截断）。 */
  readonly rows: readonly WalletRow[];
}

const INFLOW: ReadonlySet<WalletEventKind> = new Set<WalletEventKind>(['deposit', 'cash-out']);

/** 把钱包快照投影为面板渲染 props（历史最新在前，截断到 `limit`）。 */
export function walletPanelVM(snap: WalletSnapshot, limit = 8): WalletPanelVM {
  const rows: WalletRow[] = snap.history
    .slice()
    .reverse()
    .slice(0, limit)
    .map((e) => {
      const inflow = INFLOW.has(e.kind);
      return {
        kind: e.kind,
        signedAmount: `${inflow ? '+' : '-'}${e.amount}`,
        balanceAfter: e.balanceAfter,
        memo: e.memo ?? '',
        inflow,
      };
    });
  return {
    network: snap.network,
    balance: snap.balance,
    playMoney: snap.network === 'play-regtest',
    rows,
  };
}

export interface AmountValidation {
  readonly ok: boolean;
  readonly error: string | null;
}

/** 校验一个正整数金额（satoshis / 模拟筹码；INV-BS-1 不允许小数）。 */
export function validateAmount(amount: number): AmountValidation {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { ok: false, error: 'Enter a whole number of chips.' };
  }
  if (amount <= 0) return { ok: false, error: 'Amount must be greater than zero.' };
  return { ok: true, error: null };
}

/** 校验一笔提现：正整数且不超过可用余额。 */
export function validateWithdraw(amount: number, balance: number, dest: string): AmountValidation {
  const a = validateAmount(amount);
  if (!a.ok) return a;
  if (dest.trim().length === 0) return { ok: false, error: 'Enter a destination address.' };
  if (amount > balance) return { ok: false, error: `Insufficient balance (have ${balance}).` };
  return { ok: true, error: null };
}

export interface BuyInCheck {
  /** 玩家是否负担得起牌桌要求的买入。 */
  readonly canAfford: boolean;
  /** 所需的买入额（牌桌的起始筹码）。 */
  readonly required: number;
  /** 被阻止时的明确提示信息（可负担时为空）。 */
  readonly message: string;
}

/** 玩家能否用 `balance` 支付 `required` 的买入？若不能则以明确信息阻止加入。 */
export function buyInCheck(balance: number, required: number): BuyInCheck {
  const canAfford = balance >= required && required > 0;
  return {
    canAfford,
    required,
    message: canAfford
      ? ''
      : `You need ${required} chips to buy in but have ${balance}. Add funds first.`,
  };
}
