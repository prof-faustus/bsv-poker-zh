/**
 * 签名提示 view-model（REQ-UI-006 / §A6.7；core §11.6）。
 *
 * 不进行静默签名：每个发出的动作都必须准确说明被授权的内容——动作类型、金额，
 * 以及受影响的底池/状态。在 Phase-1 的同机轮流（hot-seat）对局中没有真正的
 * 密钥/tx（链上 crypto + tx-builder 属于后续阶段，§A2.3）；此 view-model
 * 仍会生成诚实的、人类可读的意图，以便该 modal 端到端打通，并验证“不静默签名”
 * 的约定。此处有意不包含精确字节（exact-bytes）字段，并据此加以标注。
 */

import type { Action, LegalActions } from '@bsv-poker/protocol-types';

export interface SigningPromptVM {
  readonly title: string;
  /** 每条被授权事实对应一行人类可读文本（动作、金额、对底池的影响）。 */
  readonly lines: readonly string[];
  /** 确认后将被应用的具体动作。 */
  readonly action: Action;
  /** 关于本阶段“签了什么、没签什么”的诚实说明。 */
  readonly disclosure: string;
}

export function signingPromptVM(
  action: Action,
  ctx: { readonly potBefore: number; readonly toCall: number },
): SigningPromptVM {
  const lines: string[] = [];
  switch (action.kind) {
    case 'fold':
      lines.push('Action: FOLD — you forfeit the hand.');
      lines.push('Your cards are NOT revealed (fold without reveal).');
      break;
    case 'check':
      lines.push('Action: CHECK — wager nothing, pass action.');
      break;
    case 'call':
      lines.push(`Action: CALL — add ${action.amount} to match the bet.`);
      lines.push(`Amount to call: ${ctx.toCall}.`);
      break;
    case 'bet':
      lines.push(`Action: BET ${action.amount}.`);
      break;
    case 'raise':
      lines.push(`Action: RAISE to ${action.amount} (total this round).`);
      break;
    default:
      lines.push(`Action: ${action.kind.toUpperCase()} ${action.amount}.`);
  }
  lines.push(`Pot before your action: ${ctx.potBefore}.`);
  return {
    title: 'Confirm your action',
    lines,
    action,
    disclosure:
      'REGTEST / play-money. No key is used and no transaction is broadcast in this ' +
      'phase — the on-chain signing path (SDK custody + tx-builder) is wired in a later ' +
      'phase (§A2.3). Confirming applies the move to the local engine only.',
  };
}

/** 根据引擎的合法动作描述符，构建所选 UI 控件映射到的具体 Action。 */
export function actionFromChoice(
  choice: 'fold' | 'check' | 'call' | 'bet' | 'raise',
  seat: number,
  legal: LegalActions,
  amount: number,
): Action {
  switch (choice) {
    case 'fold':
      return { kind: 'fold', seat, amount: 0 };
    case 'check':
      return { kind: 'check', seat, amount: 0 };
    case 'call':
      return { kind: 'call', seat, amount: legal.call ? legal.call.amount : 0 };
    case 'bet':
      return { kind: 'bet', seat, amount };
    case 'raise':
      return { kind: 'raise', seat, amount };
    default:
      return { kind: 'check', seat, amount: 0 };
  }
}
