/**
 * 规则集 SDK 接口（core §15.3）：validate、hash、resolveDefaultAction。
 */

import {
  type Action,
  type Ruleset,
  rulesetHash,
  BETTING_STRUCTURES,
  VARIANTS,
} from '@bsv-poker/protocol-types';

export interface RulesetError {
  readonly field: string;
  readonly message: string;
}

/** 校验一个规则集；返回问题列表（为空 = 有效）。失败即关闭（§A10.4）。 */
export function validateRuleset(r: Ruleset): RulesetError[] {
  const errs: RulesetError[] = [];
  if (!VARIANTS.includes(r.variant)) errs.push({ field: 'variant', message: 'unknown variant' });
  if (!BETTING_STRUCTURES.includes(r.bettingStructure))
    errs.push({ field: 'bettingStructure', message: 'unknown structure' });
  if (r.seats < 2 || r.seats > 9) errs.push({ field: 'seats', message: 'seats must be 2..9 (D2)' });
  if (r.bettingStructure === 'FL' && !r.flSizing)
    errs.push({ field: 'flSizing', message: 'Fixed-Limit requires flSizing' });
  if (r.forcedBetModel === 'blinds' && r.blinds.bigBlind < r.blinds.smallBlind)
    errs.push({ field: 'blinds', message: 'bigBlind must be >= smallBlind' });
  if (r.minBuyIn <= 0 || r.maxBuyIn < r.minBuyIn)
    errs.push({ field: 'buyIn', message: 'require 0 < minBuyIn <= maxBuyIn' });
  if (r.timeouts.recoveryMs <= r.timeouts.decisionMs)
    errs.push({ field: 'timeouts', message: 'recoveryMs must exceed decisionMs' });
  return errs;
}

/** rulesetHash = H(canonicalSerialize(Ruleset)) —— core §5.2, REQ-POKER-002。 */
export function hashRuleset(r: Ruleset): string {
  return rulesetHash(r);
}

/**
 * 面对下注的决策在超时时的安全默认动作（core §6.4）：若过牌合法则过牌，
 * 否则弃牌——绝不强制下注。（引擎的 isTimeoutEligible 计算实际的
 * 合格座位 + 默认动作；这只是策略辅助函数。）
 */
export function resolveDefaultAction(seat: number, facingBet: boolean): Action {
  return facingBet ? { kind: 'fold', seat, amount: 0 } : { kind: 'check', seat, amount: 0 };
}
