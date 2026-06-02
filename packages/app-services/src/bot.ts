/**
 * 用于本地“同屏对战 bot”的简单对手策略。读取引擎的合法行动（legal-action）
 * 描述符，选择一个安全、绝不激进的动作：能 check 则 check，否则 call，再否则 fold。
 * 这是一个占位用的本地策略——不是 AI，也不是网络对手。通过中继进行的多
 * 客户端对战是后续阶段（§A2.3）。
 */

import type { Action, LegalActions } from '@bsv-poker/protocol-types';

export function botAction(seat: number, legal: LegalActions): Action {
  if (legal.check) return { kind: 'check', seat, amount: 0 };
  if (legal.call) return { kind: 'call', seat, amount: legal.call.amount };
  return { kind: 'fold', seat, amount: 0 };
}
