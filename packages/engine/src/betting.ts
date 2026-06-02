/**
 * 下注结构与下注状态机 —— core §5.4, REQ-POKER-008/009/010。
 *
 * 单一接口下的多种策略：无限注（max = 筹码量）、底池限注（max = 底池 + 跟注）、
 * 固定限注（固定的小/大注，加注次数有上限）。状态机跟踪每个座位的筹码量、
 * 本轮已投入、本手已投入、需跟注金额、上一次完整加注、谁全下（all-in）、
 * 自上一次激进动作以来谁已行动，以及本轮结束条件。一个不构成完整加注的
 * 短全下不会为已经行动过的玩家重新开放下注（REQ-POKER-010）。
 */

import type { Action, BettingStructure, LegalActions, Ruleset } from '@bsv-poker/protocol-types';

export interface BettingSeat {
  seat: number;
  stack: number;
  committedThisRound: number;
  committedThisHand: number;
  folded: boolean;
  allIn: boolean;
  hasActedThisRound: boolean;
  /**
   * 该座位当前是否拥有加注权。当一个短全下（小于完整加注）抬高下注额时，
   * 对已经行动过的座位会清除此权——它们只能跟注，不能再加注（REQ-POKER-010）。
   * 在任何完整下注/加注时恢复。
   */
  mayRaise: boolean;
}

export interface BettingCtx {
  seats: BettingSeat[];
  betToCall: number;
  lastFullRaise: number;
  toAct: number | null;
  lastAggressor: number | null;
  raisesThisStreet: number;
  /** 固定限注下：适用于当前街的下注级别。 */
  betLevel: 'small' | 'big';
}

function clone(ctx: BettingCtx): BettingCtx {
  return {
    ...ctx,
    seats: ctx.seats.map((s) => ({ ...s })),
  };
}

function find(ctx: BettingCtx, seat: number): BettingSeat {
  const s = ctx.seats.find((x) => x.seat === seat);
  if (!s) throw new Error(`no such seat ${seat}`);
  return s;
}

function liveNonAllIn(ctx: BettingCtx): BettingSeat[] {
  return ctx.seats.filter((s) => !s.folded && !s.allIn);
}

function liveSeats(ctx: BettingCtx): BettingSeat[] {
  return ctx.seats.filter((s) => !s.folded);
}

/** 本街中该结构的基础下注额（最小起手下注 / 加注步长）。 */
function betUnit(ctx: BettingCtx, ruleset: Ruleset): number {
  if (ruleset.bettingStructure === 'FL') {
    if (!ruleset.flSizing) throw new Error('FL ruleset missing flSizing');
    return ctx.betLevel === 'big' ? ruleset.flSizing.bigBet : ruleset.flSizing.smallBet;
  }
  return ruleset.blinds.bigBlind;
}

function potSize(ctx: BettingCtx): number {
  return ctx.seats.reduce((s, x) => s + x.committedThisHand, 0);
}

/** 给定行动座位时，该结构下的最大下注/加注至（raise-TO）金额。 */
function maxFor(
  structure: BettingStructure,
  ctx: BettingCtx,
  seat: BettingSeat,
  isRaise: boolean,
): number {
  const allInTo = seat.committedThisRound + seat.stack; // 若全下，本轮的总投入
  if (structure === 'NL') return allInTo;
  if (structure === 'PL') {
    const toCall = Math.max(0, ctx.betToCall - seat.committedThisRound);
    const potAfterCall = potSize(ctx) + toCall;
    const cap = isRaise ? ctx.betToCall + potAfterCall : potAfterCall;
    return Math.min(cap, allInTo);
  }
  // FL：max == min（固定）。调用方计算固定目标值；上限钳制到全下额。
  return allInTo;
}

export function legalActions(ctx: BettingCtx, ruleset: Ruleset, seat: number): LegalActions {
  const s = find(ctx, seat);
  if (s.folded || s.allIn) {
    return { check: false, fold: false };
  }
  const toCall = Math.max(0, ctx.betToCall - s.committedThisRound);
  const unit = betUnit(ctx, ruleset);
  const structure = ruleset.bettingStructure;
  const flCapped =
    structure === 'FL' && ruleset.flSizing
      ? ctx.raisesThisStreet >= ruleset.flSizing.maxRaisesPerStreet
      : false;

  const out: {
    check: boolean;
    call?: { amount: number };
    bet?: { min: number; max: number };
    raise?: { min: number; max: number };
    fold: boolean;
    draw?: boolean;
  } = { check: toCall === 0, fold: true };

  if (toCall > 0) {
    out.call = { amount: Math.min(toCall, s.stack) };
  }

  if (toCall === 0 && s.stack > 0) {
    // 起手下注
    const min = Math.min(unit, s.stack);
    const max = structure === 'FL' ? min : maxFor(structure, ctx, s, false);
    out.bet = { min, max };
  }

  if (toCall > 0 && s.stack > toCall && !flCapped && s.mayRaise) {
    // 加注至（raise-TO）
    const minRaiseTo = ctx.betToCall + Math.max(ctx.lastFullRaise, unit);
    const allInTo = s.committedThisRound + s.stack;
    if (structure === 'FL') {
      const target = ctx.betToCall + unit;
      if (target <= allInTo) out.raise = { min: target, max: target };
    } else {
      const max = maxFor(structure, ctx, s, true);
      const min = Math.min(minRaiseTo, allInTo);
      if (min <= max) out.raise = { min, max };
    }
  }

  return out;
}

/** 应用一个已校验的动作，返回 toAct 已推进的新上下文。 */
export function applyAction(ctx: BettingCtx, ruleset: Ruleset, action: Action): BettingCtx {
  const next = clone(ctx);
  const s = find(next, action.seat);
  if (s.folded || s.allIn) throw new Error(`seat ${action.seat} cannot act`);

  // 失败即关闭（fail-closed）：该动作必须属于此状态下的合法动作之一（REQ-POKER-008）。
  assertLegal(ctx, ruleset, action);

  const move = (target: number): void => {
    const delta = target - s.committedThisRound;
    if (delta < 0) throw new Error('negative commit');
    if (delta > s.stack) throw new Error('insufficient stack');
    s.stack -= delta;
    s.committedThisRound += delta;
    s.committedThisHand += delta;
    if (s.stack === 0) s.allIn = true;
  };

  switch (action.kind) {
    case 'check': {
      if (next.betToCall !== s.committedThisRound) throw new Error('cannot check facing a bet');
      s.hasActedThisRound = true;
      break;
    }
    case 'fold': {
      s.folded = true;
      s.hasActedThisRound = true;
      break;
    }
    case 'call': {
      // action.amount 是跟注所需的增量筹码（== legalActions().call.amount）。
      move(s.committedThisRound + action.amount);
      s.hasActedThisRound = true;
      break;
    }
    case 'bet': {
      if (next.betToCall !== 0) throw new Error('cannot bet facing a bet (use raise)');
      move(action.amount);
      next.betToCall = action.amount;
      next.lastFullRaise = action.amount;
      next.lastAggressor = s.seat;
      fullReopen(next, s.seat);
      s.hasActedThisRound = true;
      break;
    }
    case 'raise': {
      if (next.betToCall === 0) throw new Error('cannot raise without a bet (use bet)');
      if (!s.mayRaise) throw new Error('seat may not re-raise after a short all-in');
      const raiseBy = action.amount - next.betToCall;
      if (raiseBy <= 0) throw new Error('raise must exceed current bet');
      move(action.amount);
      const full = raiseBy >= next.lastFullRaise;
      next.betToCall = action.amount;
      next.lastAggressor = s.seat;
      next.raisesThisStreet += 1;
      if (full) {
        next.lastFullRaise = raiseBy;
        fullReopen(next, s.seat); // 完整加注为所有人重新开放加注权
      } else {
        partialReopen(next, s.seat); // 短全下：其他人必须应对，但只能跟注
      }
      s.hasActedThisRound = true;
      break;
    }
    default:
      throw new Error(`betting action not handled: ${action.kind}`);
  }

  advance(next);
  return next;
}

/** 拒绝在当前状态下不合法的动作（失败即关闭）。 */
function assertLegal(ctx: BettingCtx, ruleset: Ruleset, action: Action): void {
  const legal = legalActions(ctx, ruleset, action.seat);
  switch (action.kind) {
    case 'check':
      if (!legal.check) throw new Error('illegal check');
      return;
    case 'fold':
      if (!legal.fold) throw new Error('illegal fold');
      return;
    case 'call':
      if (!legal.call || action.amount !== legal.call.amount) throw new Error('illegal call');
      return;
    case 'bet':
      if (!legal.bet || action.amount < legal.bet.min || action.amount > legal.bet.max)
        throw new Error('illegal bet size');
      return;
    case 'raise':
      if (!legal.raise || action.amount < legal.raise.min || action.amount > legal.raise.max)
        throw new Error('illegal raise size');
      return;
    default:
      throw new Error(`not a betting action: ${action.kind}`);
  }
}

/** 完整下注/加注：其余每个仍在局且未全下的座位都必须再次行动，并重新获得加注权。 */
function fullReopen(ctx: BettingCtx, aggressor: number): void {
  for (const s of ctx.seats) {
    if (s.seat !== aggressor && !s.folded && !s.allIn) {
      s.hasActedThisRound = false;
      s.mayRaise = true;
    }
  }
}

/**
 * 短全下（不足一个完整加注）：已经行动过的座位必须应对新的需跟注额，但只能
 * 跟注/弃牌（mayRaise 被清除）；尚未行动的座位保留其加注权（REQ-POKER-010）。
 */
function partialReopen(ctx: BettingCtx, aggressor: number): void {
  for (const s of ctx.seats) {
    if (s.seat === aggressor || s.folded || s.allIn) continue;
    if (s.hasActedThisRound) {
      s.hasActedThisRound = false;
      s.mayRaise = false;
    }
  }
}

/** 将 toAct 推进到下一个符合条件的座位；若本轮已结束则置为 null。 */
function advance(ctx: BettingCtx): void {
  if (isRoundClosed(ctx)) {
    ctx.toAct = null;
    return;
  }
  const order = ctx.seats.map((s) => s.seat);
  const from = ctx.toAct ?? order[0]!;
  const startIdx = order.indexOf(from);
  for (let i = 1; i <= order.length; i++) {
    const seat = order[(startIdx + i) % order.length]!;
    const s = find(ctx, seat);
    if (!s.folded && !s.allIn && !s.hasActedThisRound) {
      ctx.toAct = seat;
      return;
    }
  }
  ctx.toAct = null;
}

/**
 * 当行动回到上一个激进者、且所有仍在局且未全下的玩家都已跟平当前下注（或全部
 * 过牌通过），或仅剩一名在局玩家时，本轮结束（REQ-POKER-010）。
 */
export function isRoundClosed(ctx: BettingCtx): boolean {
  if (liveSeats(ctx).length <= 1) return true;
  const contenders = liveNonAllIn(ctx);
  if (contenders.length === 0) return true; // 剩余玩家全部全下
  if (contenders.length === 1) {
    // 只有一名玩家可以主动行动；没有对手可供下注。一旦该玩家不再欠任何
    // 筹码（已跟平当前下注），本轮即结束。避免等待对全下对手的下注
    //（标准的"除一人外全部全下"规则）。
    return contenders[0]!.committedThisRound === ctx.betToCall;
  }
  return contenders.every((s) => s.hasActedThisRound && s.committedThisRound === ctx.betToCall);
}

/** 开启一个全新的下注轮：清除本轮已投入和已行动标志。 */
export function openRound(ctx: BettingCtx, firstToAct: number, betLevel: 'small' | 'big'): BettingCtx {
  const next = clone(ctx);
  for (const s of next.seats) {
    s.committedThisRound = 0;
    s.hasActedThisRound = false;
    s.mayRaise = true;
  }
  next.betToCall = 0;
  next.lastFullRaise = 0;
  next.lastAggressor = null;
  next.raisesThisStreet = 0;
  next.betLevel = betLevel;
  next.toAct = firstToAct;
  return next;
}
