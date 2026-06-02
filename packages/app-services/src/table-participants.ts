/**
 * 参与者集合策略（REQ-CRYPTO-011）：一手牌的玩家集合是在两手牌之间计算的
 * （sit-out / join / 破产仅在此生效），然后在整手牌期间被冻结——N 方洗牌和结算
 * 恰好作用于该集合。在牌局进行中到达的变更永远不会改变进行中的这手牌；它将应用于下一手。
 */

export interface SeatRef {
  readonly seat: number;
}

/** 下一手牌的就座集合：筹码为正的座位（破产的座位被剔除）。 */
export function seatedForNextHand<T extends SeatRef>(seats: readonly T[], stackOf: (seat: number) => number): T[] {
  return seats.filter((s) => stackOf(s.seat) > 0);
}

/** 在牌局开始时冻结参与者集合——以该手牌的不可变快照形式返回。 */
export function freezeParticipants<T extends SeatRef>(seated: readonly T[]): readonly T[] {
  return Object.freeze([...seated]);
}

export interface SeatChange {
  readonly kind: 'join' | 'sit-out';
  readonly seat: number;
}

/**
 * 应用 sit-out/join 变更——仅在两手牌之间有效。返回新的就座集合；进行中牌局的冻结集合
 * 不受影响，因为调用方在牌局前冻结、在牌局后重新派生。
 */
export function applyBetweenHands<T extends SeatRef>(current: readonly T[], changes: readonly SeatChange[], make: (seat: number) => T): T[] {
  const set = new Map(current.map((s) => [s.seat, s]));
  for (const ch of changes) {
    if (ch.kind === 'join') set.set(ch.seat, make(ch.seat));
    else set.delete(ch.seat);
  }
  return [...set.values()].sort((a, b) => a.seat - b.seat);
}
