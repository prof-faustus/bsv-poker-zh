/**
 * 离线练习——一个对各变体通用的 universal bot + 一个完整牌局驱动器，使单个玩家可以
 * 对战 bot 练习五种变体中的任意一种（不只是德州扑克）。浏览器安全；确定性的（注入牌组）。
 * 引擎强制执行合法性；bot 永远只在合法动作中进行选择。
 */

import {
  type Action,
  type Card,
  type GameState,
  type LegalActions,
  type Ruleset,
  type Variant,
} from '@bsv-poker/protocol-types';
import { createGameModule } from './game-registry.ts';

/** 一个简单、始终合法的 bot：check → stand-pat（draw）→ call → min-bet（如 bring-in）→ fold。 */
export function universalBot(legal: LegalActions, seat: number): Action {
  if (legal.check) return { kind: 'check', seat, amount: 0 };
  if (legal.draw) return { kind: 'stand', seat, amount: 0 }; // 抽牌阶段：保留当前手牌
  if (legal.call) return { kind: 'call', seat, amount: legal.call.amount };
  if (legal.bet) return { kind: 'bet', seat, amount: legal.bet.min }; // 开注 / bring-in
  return { kind: 'fold', seat, amount: 0 };
}

export interface OfflineSeatInit {
  readonly seat: number;
  readonly stack: number;
}

/** 与 bot 一起进行一整手 `variant` 的离线牌局；返回结算后的状态。 */
export function playOfflineHand(
  variant: Variant,
  ruleset: Ruleset,
  seats: OfflineSeatInit[],
  deck: readonly Card[],
  strategy: (legal: LegalActions, seat: number, state: GameState) => Action = universalBot,
): GameState {
  const m = createGameModule(variant, deck);
  let state = m.init(ruleset, seats.map((s) => ({ seat: s.seat, stack: s.stack })));
  // 有界循环（Power-of-Ten）：一手牌的可行动转换数量是有限的。
  for (let guard = 0; guard < 5000 && !state.handComplete; guard++) {
    // 下注轮，否则是非下注的决策轮（如抽牌弃牌，drawToAct）
    const toAct = state.betting.toAct ?? state.drawToAct ?? null;
    if (toAct === null) break;
    state = m.apply(state, strategy(m.getLegalActions(state, toAct), toAct, state));
  }
  return state;
}

/** 用于离线练习的某变体默认规则集（按变体使用 blinds 或 ante+bring-in）。 */
export function offlineRuleset(variant: Variant, seats: number): Ruleset {
  const bringInVariant = variant === 'stud' || variant === 'razz';
  return {
    variant,
    bettingStructure: 'NL',
    forcedBetModel: bringInVariant ? 'ante-bringin' : 'blinds',
    seats,
    blinds: {
      smallBlind: bringInVariant ? 0 : 1,
      bigBlind: bringInVariant ? 0 : 2,
      ante: bringInVariant ? 1 : 0,
      bringIn: bringInVariant ? 1 : 0,
    },
    minBuyIn: 100,
    maxBuyIn: 200,
    timeouts: { decisionMs: 30000, recoveryMs: 120000 },
    signingMode: 'A',
    currency: 'play-regtest',
    suitTiebreakHouseRule: false,
    hiLo: false,
  };
}
