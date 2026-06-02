/**
 * LocalTableClient——用于第一阶段“同屏对战 bot”的客户端 app-services 接缝（§A2.3）。
 *
 * 它持有一个 game-holdem 模块实例 + 当前的 HoldemState，并暴露一个面向 UI 的小型
 * 接口面：getState / legalActions / timeout / apply / startHand。它使用真实引擎处理
 * 所有游戏逻辑（下注/底池/FSM/结算）——此处不重新实现任何规则。
 *
 * 本阶段被打桩（STUBBED）的接缝（清晰地按 §A2.3 处理——中继/索引器/托管的接线属于
 * 后续阶段）：
 *   - 连接/同步客户端：没有 peer；这唯一的客户端在本地具有权威性。
 *   - 托管/签名客户端：无密钥，无交易；“签名”只是 UI 中的一个确认步骤。
 *   - 洗牌：单方 CSPRNG Fisher–Yates（见 shuffle.ts），而非 mental-poker。
 *
 * 人类玩家是 hero 座位；另一座位由简单的 bot 策略驱动。在 hero 的动作被应用后，
 * 每当轮到 bot 行动时客户端会自动替 bot 出牌，因此单个人类玩家就能把一整手牌
 * 推进到摊牌 + 结算。
 */

import type { Action, Card, LegalActions, Ruleset } from '@bsv-poker/protocol-types';
import type { TimeoutResolution, SeatInit } from '@bsv-poker/engine';
import { createHoldem, type HoldemModule, type HoldemState } from '@bsv-poker/game-holdem';
import { shuffleDeck } from './shuffle.ts';
import { botAction } from './bot.ts';

export interface LocalTableConfig {
  readonly ruleset: Ruleset;
  /** 人类玩家所坐的座位（单挑时为 0 或 1）。 */
  readonly heroSeat: number;
  /** 可选的牌堆注入器（测试会传入固定牌堆）；默认使用 CSPRNG 洗牌。 */
  readonly makeDeck?: () => Card[];
  /** 传给 createHoldem 的可选按钮索引（在各手牌之间轮转）。 */
  readonly buttonIndex?: number;
}

export class LocalTableClient {
  private readonly ruleset: Ruleset;
  private readonly heroSeat: number;
  private readonly seatInits: SeatInit[];
  private readonly makeDeck: () => Card[];
  private buttonIndex: number;

  private module: HoldemModule;
  private state: HoldemState;
  private startingStacks: Map<number, number>;

  constructor(config: LocalTableConfig) {
    this.ruleset = config.ruleset;
    this.heroSeat = config.heroSeat;
    this.makeDeck = config.makeDeck ?? shuffleDeck;
    this.buttonIndex = config.buttonIndex ?? 0;
    this.seatInits = [
      { seat: 0, stack: config.ruleset.minBuyIn },
      { seat: 1, stack: config.ruleset.minBuyIn },
    ];
    this.module = createHoldem({ deck: this.makeDeck(), buttonIndex: this.buttonIndex });
    this.state = this.module.init(this.ruleset, this.seatInits);
    this.startingStacks = new Map(this.seatInits.map((s) => [s.seat, s.stack]));
    // 如果 bot 先行动（例如 hero 在翻牌前不是按钮位），让它先出牌。
    this.runBots();
  }

  getHeroSeat(): number {
    return this.heroSeat;
  }

  getBotSeat(): number {
    return this.heroSeat === 0 ? 1 : 0;
  }

  getState(): HoldemState {
    return this.state;
  }

  /** 引擎已知的某座位底牌（受托管绑定；在 UI 中仅会向 hero 展示）。 */
  getHole(seat: number): readonly Card[] {
    return this.state.hole[seat] ?? [];
  }

  getStartingStacks(): ReadonlyMap<number, number> {
    return this.startingStacks;
  }

  /** 某座位的合法行动——直接来自引擎（UI 永远不自行计算合法性）。 */
  legalActions(seat: number): LegalActions {
    return this.module.getLegalActions(this.state, seat);
  }

  /** 对正在计时座位的超时裁决（后果文案来源，core §6.4）。 */
  timeout(): TimeoutResolution | null {
    // holdem 模块的资格判断不使用 `now`（它返回安全默认值）；传入 0。
    return this.module.isTimeoutEligible(this.state, 0);
  }

  isHeroTurn(): boolean {
    return !this.state.handComplete && this.state.betting.toAct === this.heroSeat;
  }

  /** 应用 hero 的行动，然后在轮到 bot 计时期间自动替 bot 出牌。 */
  apply(action: Action): HoldemState {
    if (action.seat !== this.heroSeat) {
      throw new Error('LocalTableClient.apply only accepts the hero seat; bots are automatic');
    }
    this.state = this.module.apply(this.state, action);
    this.runBots();
    return this.state;
  }

  /** 只要 bot 是正在计时的座位且这手牌仍在进行，就持续驱动 bot 出牌。 */
  private runBots(): void {
    const botSeat = this.getBotSeat();
    while (!this.state.handComplete && this.state.betting.toAct === botSeat) {
      const legal = this.module.getLegalActions(this.state, botSeat);
      this.state = this.module.apply(this.state, botAction(botSeat, legal));
    }
  }

  /** 开始新的一手牌（轮转按钮），并重新洗牌。 */
  startHand(): HoldemState {
    // 将当前筹码量延续为下一手牌的买入额（使筹码在各手牌之间保持延续）。
    const stacks = new Map(this.state.seats.map((s) => [s.seat, s.stack]));
    const seatInits: SeatInit[] = this.seatInits.map((s) => ({
      seat: s.seat,
      stack: stacks.get(s.seat) ?? s.stack,
    }));
    this.buttonIndex = (this.buttonIndex + 1) % seatInits.length;
    this.module = createHoldem({ deck: this.makeDeck(), buttonIndex: this.buttonIndex });
    this.state = this.module.init(this.ruleset, seatInits);
    this.startingStacks = new Map(seatInits.map((s) => [s.seat, s.stack]));
    this.runBots();
    return this.state;
  }

  /** 状态哈希（用于重放/分支绑定；为调试 transcript 而暴露）。 */
  stateHash(): string {
    return this.module.stateHash(this.state);
  }
}
