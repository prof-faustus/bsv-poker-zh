/**
 * Ruleset 模型 — core §5.2。Ruleset 固定了玩法变体、下注结构、座位数、盲注/前注
 * 计划、bring-in、买入额、注额规则、加注上限、超时配置、牌堆格式以及
 * 货币语义（D8）。rulesetHash = H(canonicalSerialize(Ruleset)) 被绑定到每一笔
 * 交易中（core §6.3）— 参见 ./serialize.ts。
 */

/** 玩法变体（core §0.3, §7）。21 点属于后续阶段（core D7）— 不是扑克变体。 */
export const VARIANTS = ['holdem', 'omaha', 'stud', 'draw', 'razz'] as const;
export type Variant = (typeof VARIANTS)[number];

/** 下注结构（core §5.4, D3）。 */
export const BETTING_STRUCTURES = ['NL', 'PL', 'FL'] as const;
export type BettingStructure = (typeof BETTING_STRUCTURES)[number];

/** 强制下注模型（core §A21.2）：盲注（holdem/omaha/draw）对比 ante+bring-in（stud/razz）。 */
export const FORCED_BET_MODELS = ['blinds', 'ante-bringin'] as const;
export type ForcedBetModel = (typeof FORCED_BET_MODELS)[number];

/** 签名模式（core §4.3, D9）。第 1 阶段默认使用模式 A。 */
export const SIGNING_MODES = ['A', 'B'] as const;
export type SigningMode = (typeof SIGNING_MODES)[number];

/** 货币语义（core D8）。默认使用游戏币 / regtest。 */
export const CURRENCY_SEMANTICS = ['play-regtest', 'mainnet-research'] as const;
export type CurrencySemantics = (typeof CURRENCY_SEMANTICS)[number];

export interface TimeoutProfile {
  /** UI/运营层面的决策倒计时；不是共识值（计时在交易层面，core §6.2）。 */
  readonly decisionMs: number;
  /** 恢复窗口；必须 > decisionMs。 */
  readonly recoveryMs: number;
}

export interface BlindSchedule {
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** 每个座位的前注（无则为 0）。Stud/razz 使用 ante+bringIn 而非盲注。 */
  readonly ante: number;
  /** Bring-in 金额（仅 stud/razz；其余为 0）。 */
  readonly bringIn: number;
}

export interface FixedLimitSizing {
  readonly smallBet: number;
  readonly bigBet: number;
  /** FL 中每条街的加注次数上限（标准为 1 次下注 + N 次加注）。 */
  readonly maxRaisesPerStreet: number;
}

export interface Ruleset {
  readonly variant: Variant;
  readonly bettingStructure: BettingStructure;
  readonly forcedBetModel: ForcedBetModel;
  readonly seats: number; // 2..9（core D2）
  readonly blinds: BlindSchedule;
  readonly minBuyIn: number;
  readonly maxBuyIn: number;
  /** 固定限注（Fixed-Limit）注额 — 当且仅当 bettingStructure === 'FL' 时存在。 */
  readonly flSizing?: FixedLimitSizing;
  readonly timeouts: TimeoutProfile;
  readonly signingMode: SigningMode;
  readonly currency: CurrencySemantics;
  /**
   * 房规：零头筹码按花色破平。默认为 false（core §5.5.1, RT-01 m3）。
   * 绝不能在牌力评估内部实现 — 它仅用于彩池分配时的破平。
   */
  readonly suitTiebreakHouseRule: boolean;
  /** Omaha 高低分池（core REQ-FSM-007）。未设置时关闭。 */
  readonly hiLo: boolean;
}
