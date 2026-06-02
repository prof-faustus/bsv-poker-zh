/**
 * 交易类别 — core §6.1。这些是概念性类别（wire 名称属于实现细节）。
 * 每笔交易都绑定 gid + rulesetHash + round + 状态哈希 + 后继承诺
 * （core §6.3, REQ-TX-005）以防重放。
 */

export const TX_CLASSES = [
  'Funding',
  'Commitment',
  'Deal',
  'Action',
  'Timeout',
  'Reveal',
  'Fold',
  'FairPlay',
  'Settlement',
  'Recovery',
  'TableMgmt',
] as const;
export type TxClass = (typeof TX_CLASSES)[number];

/**
 * 每笔协议交易携带的防重放绑定（core §6.3）。
 * 作为 pushdata 携带于有效脚本中 — 绝不使用 OP_RETURN（core P11/§6.5）。
 */
export interface BranchBinding {
  readonly gid: string; // hex
  readonly rulesetHash: string; // hex
  readonly round: number;
  readonly stateHash: string; // hex — 被花费状态的哈希
  readonly actingSeat: number; // 不适用时为 -1
  readonly successorCommitment: string; // hex — 对后继状态的承诺
}

/** 引擎所消费的协议交易（链上字节位于 tx-builder 中）。 */
export interface ProtocolTx {
  readonly txid: string; // hex
  readonly cls: TxClass;
  readonly binding: BranchBinding;
  /** 类别特定的载荷，已由 SDK 校验/规范化。 */
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * transcript 是有效牌桌交易的有序集合，外加重新推导状态所需的
 * commit/reveal 材料（core §12.2, REQ-DATA-002）。
 */
export interface Transcript {
  readonly rulesetHash: string;
  readonly txs: readonly ProtocolTx[];
}
