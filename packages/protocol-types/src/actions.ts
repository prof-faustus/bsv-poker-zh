/**
 * 玩家动作与下注动作类型 — core §5.4, §7.1。
 * Action 是窗口内的操作；每个动作对应一笔已签名的交易（core §6.1 Action）。
 */

export const ACTION_KINDS = [
  'check',
  'bet',
  'call',
  'raise',
  'fold',
  'draw', // 五张抽牌（core §7.3.3）
  'stand', // 不换牌（抽 0 张）
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface Action {
  readonly kind: ActionKind;
  readonly seat: number;
  /** 对于 bet/call/raise：金额（raise = 本轮加注至的总额）。其余情况为 0。 */
  readonly amount: number;
  /** 对于 draw：玩家弃掉的暗牌槽位索引集合（0..n）。 */
  readonly discard?: readonly number[];
}

/** 由 BettingStructure.legalBets 返回的合法动作描述符（core §5.4, REQ-POKER-008）。 */
export interface LegalActions {
  readonly check: boolean;
  readonly call?: { readonly amount: number };
  readonly bet?: { readonly min: number; readonly max: number };
  readonly raise?: { readonly min: number; readonly max: number };
  readonly fold: boolean;
  /** 仅限抽牌类玩法。 */
  readonly draw?: boolean;
}
