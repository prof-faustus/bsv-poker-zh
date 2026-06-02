/**
 * 下注金额 view-model（REQ-APP-051）—— 用于下注/加注滑块 + 快捷按钮的纯辅助函数。
 *
 * CRITICAL CONTRACT: 此处绝不计算合法性。min/max 边界直接来自引擎提供的
 * `LegalActions` 描述符（legal.bet / legal.raise）。它所做的只是：
 *   - 把请求的金额钳制到 [min, max] 内（滑块/键盘输入安全），以及
 *   - 把“相对底池”的快捷按钮（min、½ 底池、底池、all-in）转换成具体金额，
 *     然后同样钳制到引擎的合法范围内。
 *
 * 如果引擎不提供金额选择器（下注与加注均不合法），这些辅助函数会报告 `available:false`，
 * 组件随之隐藏滑块。不依赖 React / 适合 `node --test` 的类型剥离环境。
 */

import type { LegalActions } from '@bsv-poker/protocol-types';

export interface SizerRange {
  readonly available: boolean;
  /** 开局下注时为 'bet'，再加注时为 'raise'；不可用时为 null。 */
  readonly kind: 'bet' | 'raise' | null;
  readonly min: number;
  readonly max: number;
}

/** 从引擎的合法动作描述符中读取当前可用的金额范围（bet 优先）。 */
export function sizerRange(legal: LegalActions): SizerRange {
  const s = legal.bet ?? legal.raise;
  if (!s) return { available: false, kind: null, min: 0, max: 0 };
  return {
    available: true,
    kind: legal.bet ? 'bet' : 'raise',
    min: s.min,
    max: s.max,
  };
}

/** 把 `amount` 钳制到合法的 [min,max] 内，并取整为整数（satoshis，INV-BS-1）。 */
export function clampToRange(amount: number, range: SizerRange): number {
  if (!range.available) return 0;
  const n = Number.isFinite(amount) ? Math.round(amount) : range.min;
  if (n < range.min) return range.min;
  if (n > range.max) return range.max;
  return n;
}

export type QuickSize = 'min' | 'half-pot' | 'pot' | 'all-in';

export interface QuickButtonVM {
  readonly key: QuickSize;
  readonly label: string;
  /** 此按钮将设置的具体金额，已钳制到引擎的合法范围内。 */
  readonly amount: number;
}

/**
 * 为当前底池 + 合法范围构建快捷金额按钮。原始的相对底池目标值仅用于显示便利，
 * 并会被钳制到引擎范围内——因此 "pot" 按钮永远不会请求非法金额；若按底池下注低于
 * 合法 min，则落在 min 上，若按底池下注超过玩家筹码，则落在 all-in（max）上。
 * 对于 RAISE，目标值是该轮下注的“加注到”总额（当前跟注额 + 底池比例），同样钳制到
 * 合法的加注区间内。
 */
export function quickButtons(args: {
  readonly range: SizerRange;
  readonly pot: number;
  /** hero 为继续行动必须跟注的金额（开局时为 0）—— 用于按底池计算加注大小。 */
  readonly toCall: number;
}): readonly QuickButtonVM[] {
  const { range, pot, toCall } = args;
  if (!range.available) return [];
  // 跟注后底池是按底池加注的标准基准；对于开局下注，toCall 为 0。
  const potAfterCall = pot + toCall;
  const halfPotRaiseTo = toCall + Math.round(potAfterCall * 0.5);
  const potRaiseTo = toCall + potAfterCall;
  const halfTarget = range.kind === 'bet' ? Math.round(pot * 0.5) : halfPotRaiseTo;
  const potTarget = range.kind === 'bet' ? pot : potRaiseTo;
  return [
    { key: 'min', label: range.kind === 'raise' ? 'Min-raise' : 'Min', amount: clampToRange(range.min, range) },
    { key: 'half-pot', label: '½ Pot', amount: clampToRange(halfTarget, range) },
    { key: 'pot', label: 'Pot', amount: clampToRange(potTarget, range) },
    { key: 'all-in', label: 'All-in', amount: clampToRange(range.max, range) },
  ];
}
