/**
 * 游戏模块状态机框架 —— core §7.1, REQ-FSM-001。一个游戏模块是其输入的纯函数：
 * 无 I/O、无网络、不读取时间、无随机性（P2 / REQ-ARCH-002）。
 * 每个可行动状态都会枚举其后继状态，包括超时默认动作（P4）。
 *
 * 关于该契约的说明：core §7.1/§15.2 将 getLegalActions 类型定为 `Action[]`；本引擎
 * 返回更丰富的 `LegalActions` 描述符（规范的超集），并暴露 `enumerateActions`
 * 以生成字面的 `Action[]` —— 这是一种细化，而非矛盾。
 */

import type {
  Action,
  GameState,
  LegalActions,
  Payouts,
  Ruleset,
  Variant,
} from '@bsv-poker/protocol-types';

/** 决策/恢复超时所解析到的结果（core §6.4）：安全的默认动作。 */
export interface TimeoutResolution {
  readonly seat: number;
  readonly defaultAction: Action;
}

export interface GameModule<S extends GameState = GameState> {
  readonly id: Variant;
  init(ruleset: Ruleset, seats: SeatInit[]): S;
  getLegalActions(state: S, seat: number): LegalActions;
  apply(state: S, action: Action): S;
  /** 处于计时中座位的超时资格；若在 `now` 时刻没有符合条件者则为 null。 */
  isTimeoutEligible(state: S, now: number): TimeoutResolution | null;
  isHandComplete(state: S): boolean;
  settle(state: S): Payouts;
  serialize(state: S): Uint8Array;
}

export interface SeatInit {
  readonly seat: number;
  readonly stack: number;
}

/** 为某座位枚举具体的合法动作（字面的 core §7.1 `Action[]` 契约）。 */
export function enumerateActions(legal: LegalActions, seat: number): Action[] {
  const out: Action[] = [];
  if (legal.fold) out.push({ kind: 'fold', seat, amount: 0 });
  if (legal.check) out.push({ kind: 'check', seat, amount: 0 });
  if (legal.call) out.push({ kind: 'call', seat, amount: legal.call.amount });
  if (legal.bet) out.push({ kind: 'bet', seat, amount: legal.bet.min });
  if (legal.raise) out.push({ kind: 'raise', seat, amount: legal.raise.min });
  return out;
}

/** 从一手新牌开始重放有序动作列表 —— 确定性内核驱动器（P2）。 */
export function replay<S extends GameState>(
  module: GameModule<S>,
  ruleset: Ruleset,
  seats: SeatInit[],
  actions: readonly Action[],
): S {
  let state = module.init(ruleset, seats);
  for (const a of actions) state = module.apply(state, a);
  return state;
}
