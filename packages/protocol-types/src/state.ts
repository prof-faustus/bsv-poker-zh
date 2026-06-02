/**
 * 牌桌 / 游戏状态模型 — core §3.3, §7。引擎以 (orderedValidTxSet, ruleset) 的纯函数
 * 形式推导状态（REQ-ARCH-001）；这些类型描述的是推导出的状态。
 *
 * 牌的生命周期（core §4.3）：minted → drawn(position) → revealed | folded → discarded。
 */

import type { Card } from './cards.ts';

/** 阶段标识符是游戏模块特定的字符串（例如 §19.E 的 S0..S13 / RECOVERY）。 */
export type PhaseId = string;

export interface SeatState {
  readonly seat: number;
  readonly stack: number;
  /** 当前下注轮中投入的筹码。 */
  readonly committedThisRound: number;
  /** 本手牌中投入的筹码总额（包括已弃牌的玩家 — core §19.B）。 */
  readonly committedThisHand: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** 该座位自上一次激进动作以来是否已行动（core REQ-POKER-009）。 */
  readonly hasActedThisRound: boolean;
  /** 分配给该座位的暗牌槽位（在揭示前牌序号保持隐藏）。 */
  readonly holeSlots: readonly number[];
}

/** 一个彩池（主池或边池）— core §5.5 / §19.B。 */
export interface Pot {
  readonly amount: number;
  /** 有资格赢取该彩池的存活座位。 */
  readonly eligible: readonly number[];
}

export interface BettingState {
  /** 座位为留在牌局中所需跟注的当前金额（core REQ-POKER-009）。 */
  readonly betToCall: number;
  /** 上一次完整加注的额度，用于最小加注合法性判定（core §5.4）。 */
  readonly lastFullRaise: number;
  /** 正在等待其行动的座位索引；本轮结束时为 null。 */
  readonly toAct: number | null;
  /** 本轮最后一位激进者（下注/加注者）的座位；无则为 null。 */
  readonly lastAggressor: number | null;
  /** 本条街已进行的加注次数（FL 上限，core §5.4）。 */
  readonly raisesThisStreet: number;
}

export interface GameState {
  readonly rulesetHash: string; // hex（core §5.2）
  readonly gid: string; // 游戏 id（hex）
  readonly phase: PhaseId;
  readonly handNumber: number;
  readonly buttonSeat: number;
  readonly seats: readonly SeatState[];
  /** 目前已揭示的公共牌（board / 公共牌，公开）。 */
  readonly board: readonly Card[];
  readonly betting: BettingState;
  readonly pots: readonly Pot[];
  /**
   * 引擎已知的每个座位的底牌（在 UI/托管边界处隐藏；客户端仅通过 viewer 路径
   * 渲染自己座位的牌，core §11.5）。一旦发牌即存在。
   */
  readonly hole?: Readonly<Record<number, readonly Card[]>>;
  /**
   * 在非下注的决策阶段（例如五张抽牌的弃牌步骤，core §7.3.3）中应行动的座位，
   * 此时 `betting.toAct` 为 null 但玩家仍需做出一个动作。其余情况为 null。
   */
  readonly drawToAct?: number | null;
  /** 一旦该手牌进入终止阶段则为 true。 */
  readonly handComplete: boolean;
}

/** 结算结果 — core §5.7。 */
export interface Payout {
  readonly seat: number;
  readonly amount: number;
}
export type Payouts = readonly Payout[];
