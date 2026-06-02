/**
 * 牌桌 view-model（REQ-APP-051）—— 把引擎状态纯投影为渲染 props。
 *
 * 不依赖 React、无 I/O、无业务逻辑：它读取一个 HoldemState（外加机器人/自身座位的
 * 视角）以及模块的合法动作 / 超时资格输出，并发出展示型组件用于渲染的 props。
 * 合法性绝不在此计算——而是从引擎读取（game-holdem getLegalActions / isTimeoutEligible）。
 * UI 隐藏复杂性，但绝不隐藏后果（core §11.4 / §6.4）：后果文本由 isTimeoutEligible 推导而来。
 *
 * 保持适合类型剥离（不使用 enum/namespace/param-properties），以便单元测试可在
 * `node --test` 的类型剥离下运行。
 */

import { cardToString } from '@bsv-poker/protocol-types';
import type { Card, LegalActions, Pot, SeatState } from '@bsv-poker/protocol-types';
import type { HoldemState } from '@bsv-poker/game-holdem';
import type { TimeoutResolution } from '@bsv-poker/engine';

export interface CardVM {
  /** 完整的两字符代码，例如 "As"。 */
  readonly code: string;
  /** 点数字形，例如 "A"、"T"。 */
  readonly rank: string;
  /** 花色字母，例如 "s"——以字形形式携带，使信息绝不仅靠颜色表达（§A3.5 a11y）。 */
  readonly suit: string;
}

export interface SeatVM {
  readonly seat: number;
  readonly stack: number;
  readonly committedThisRound: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly isButton: boolean;
  readonly isToAct: boolean;
  /** 此视图所渲染的座位（人类玩家的视角）为 true。 */
  readonly isHero: boolean;
  /** hero 自己的底牌（与托管绑定——只会为 hero 座位填充）。 */
  readonly holeCards: readonly CardVM[];
}

export interface PotVM {
  readonly amount: number;
  readonly eligible: readonly number[];
}

export interface ActionBarVM {
  /** 是否轮到 hero 行动（控件激活）——直接从引擎读取。 */
  readonly isHeroTurn: boolean;
  readonly legal: LegalActions;
}

export interface TimerVM {
  /** 计时所针对的座位。 */
  readonly seat: number | null;
  /** 来自 ruleset 超时配置的 decisionMs（运营性的，非共识——core §6.2）。 */
  readonly decisionMs: number;
  /** 精确的后果文本（core §11.4）。 */
  readonly consequenceText: string;
  /** 安全默认动作所解析为的类型（"check" | "fold"）；若无座位在计时中则为 null。 */
  readonly defaultKind: string | null;
}

export interface TableViewModel {
  readonly phase: string;
  readonly handComplete: boolean;
  readonly board: readonly CardVM[];
  readonly seats: readonly SeatVM[];
  readonly pots: readonly PotVM[];
  /** 所有底池之和，加上本轮已置于各座位面前但尚未计入的筹码。 */
  readonly totalPot: number;
  readonly toAct: number | null;
  readonly heroSeat: number;
  readonly actionBar: ActionBarVM;
  readonly timer: TimerVM;
}

export function cardVM(c: Card): CardVM {
  const code = cardToString(c);
  return { code, rank: code[0] ?? '?', suit: code[1] ?? '?' };
}

function seatVM(
  s: SeatState,
  heroSeat: number,
  buttonSeat: number,
  toAct: number | null,
  hole: readonly Card[],
): SeatVM {
  const isHero = s.seat === heroSeat;
  return {
    seat: s.seat,
    stack: s.stack,
    committedThisRound: s.committedThisRound,
    folded: s.folded,
    allIn: s.allIn,
    isButton: s.seat === buttonSeat,
    isToAct: toAct === s.seat,
    isHero,
    holeCards: isHero ? hole.map(cardVM) : [],
  };
}

/**
 * 由模块的超时解析推导出的后果文本（core §11.4 / §6.4）。
 * 玩家绝不会被强制下注：面对下注时默认弃牌，否则过牌。
 */
export function consequenceText(
  resolution: TimeoutResolution | null,
  heroSeat: number,
  decisionMs: number,
): { text: string; defaultKind: string | null } {
  if (resolution === null) {
    return { text: 'Waiting for the hand to advance.', defaultKind: null };
  }
  const seconds = Math.round(decisionMs / 1000);
  const onClock = resolution.seat === heroSeat ? 'you' : `seat ${resolution.seat}`;
  if (resolution.defaultAction.kind === 'fold') {
    return {
      text: `If ${onClock === 'you' ? 'you do' : onClock + ' does'} nothing while facing a bet, ${onClock} fold${onClock === 'you' ? '' : 's'} in ${seconds}s — you are never forced to wager.`,
      defaultKind: 'fold',
    };
  }
  return {
    text: `If ${onClock === 'you' ? 'you do' : onClock + ' does'} nothing, ${onClock} check${onClock === 'you' ? '' : 's'} in ${seconds}s.`,
    defaultKind: 'check',
  };
}

/**
 * 把一个 HoldemState 投影为给定 hero 座位的牌桌渲染 props。
 * `legal` 与 `resolution` 是引擎的输出（getLegalActions / isTimeoutEligible）——
 * 作为参数传入，使该投影保持纯粹，组件永不重新计算合法性。
 */
export function tableViewModel(args: {
  readonly state: HoldemState;
  readonly heroSeat: number;
  readonly heroHole: readonly Card[];
  readonly legal: LegalActions;
  readonly resolution: TimeoutResolution | null;
  readonly decisionMs: number;
}): TableViewModel {
  const { state, heroSeat, heroHole, legal, resolution, decisionMs } = args;
  const toAct = state.betting.toAct;
  const seats = state.seats.map((s) =>
    seatVM(s, heroSeat, state.buttonSeat, toAct, heroHole),
  );
  const pots: PotVM[] = (state.pots as readonly Pot[]).map((p) => ({
    amount: p.amount,
    eligible: [...p.eligible],
  }));
  const committed = state.seats.reduce((sum, s) => sum + s.committedThisHand, 0);
  const cons = consequenceText(resolution, heroSeat, decisionMs);
  return {
    phase: state.phase,
    handComplete: state.handComplete,
    board: state.board.map(cardVM),
    seats,
    pots,
    totalPot: committed,
    toAct,
    heroSeat,
    actionBar: { isHeroTurn: toAct === heroSeat && !state.handComplete, legal },
    timer: {
      seat: resolution ? resolution.seat : null,
      decisionMs,
      consequenceText: cons.text,
      defaultKind: cons.defaultKind,
    },
  };
}
