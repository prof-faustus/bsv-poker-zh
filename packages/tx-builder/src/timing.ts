/**
 * 用于共识决策的锚定时序（REQ-TX-007）。超时的“当前时间”来源于
 * 链/中继锚定的高度（以及 median-time），绝不使用本地挂钟时间——这样每个参与者
 * 对某个截止时间是否已过都能达成一致。截止时间在交易层面表达
 * （nLockTime / nSequence；REQ-TX-002），而非通过脚本内的 CLTV/CSV（REQ-TX-001）。
 */

/** 取自链上（或中继锚定来源）而非本地时钟的高度/时间读数。 */
export interface AnchoredClock {
  readonly height: number;
  readonly medianTimeSeconds: number;
}

/** 比锚定高度提前 `blocks` 个区块的截止时间——即恢复花费到期所在的 nLockTime。 */
export function deadlineFromAnchor(clock: AnchoredClock, blocks: number): number {
  return clock.height + Math.max(0, Math.floor(blocks));
}

/** 当且仅当锚定高度已达到/越过截止高度时为 True（共识安全）。 */
export function isDeadlinePassed(deadlineHeight: number, clock: AnchoredClock): boolean {
  return clock.height >= deadlineHeight;
}

/**
 * 基于锚定时钟、针对每次行动超时窗口计算的决策截止时间（秒 → 在主网上
 * 按约 600 秒/区块换算得到的近似区块预算；regtest 按需出块，因此调用方可直接传入
 * 区块数）。本地挂钟时间被刻意 NOT 使用。
 */
export function decisionDeadlineHeight(clock: AnchoredClock, windowSeconds: number, secondsPerBlock = 600): number {
  return deadlineFromAnchor(clock, Math.ceil(windowSeconds / secondsPerBlock));
}
