/**
 * 牌桌布局 view-model（REQ-APP-051）—— 把 N 个玩家围绕椭圆形台面就座的纯几何计算。
 * 不依赖 React、不依赖 DOM：它返回百分比坐标，由展示层映射到一个绝对定位的容器上，
 * 因此这些数学计算可在 `node --test` 的类型剥离环境下进行单元测试
 *（不使用 enum/namespace/param-properties）。
 *
 * 座位被放置在一个椭圆上。hero（本地玩家的座位）锚定在底部中央——正如真实客户端
 * 显示“你”的方式——其余座位沿牌桌边沿顺时针展开。坐标以牌桌区域的百分比表示
 *（0–100），因此布局是自适应的。
 */

export interface SeatPosition {
  /** 该槽位对应的座位索引。 */
  readonly seat: number;
  /** 座位中心 X，占牌桌宽度的百分比（0–100）。 */
  readonly xPct: number;
  /** 座位中心 Y，占牌桌高度的百分比（0–100）。 */
  readonly yPct: number;
  /** 底部中央的 hero 锚点为 true。 */
  readonly isHero: boolean;
}

/**
 * 为 `count` 个座位计算它们在椭圆周围的位置（支持 2–9；超出则钳制），
 * 并进行旋转使 `heroSeat` 位于底部中央。`seatOrder` 允许调用方传入具体的
 * 座位编号（默认为 0..count-1），使该投影与引擎的座位索引相匹配。
 *
 * 椭圆相对牌桌区域内缩，使座位卡片落在边沿之上，而不会跑到边缘之外。
 */
export function seatPositions(args: {
  readonly count: number;
  readonly heroSeat: number;
  readonly seatOrder?: readonly number[];
  /** 水平半径，占半宽的比例（默认 0.92——靠近边沿）。 */
  readonly radiusX?: number;
  /** 垂直半径，占半高的比例（默认 0.92）。 */
  readonly radiusY?: number;
}): readonly SeatPosition[] {
  const count = Math.max(2, Math.min(9, Math.floor(args.count)));
  const order =
    args.seatOrder && args.seatOrder.length >= count
      ? args.seatOrder.slice(0, count)
      : Array.from({ length: count }, (_, i) => i);
  const rx = args.radiusX ?? 0.92;
  const ry = args.radiusY ?? 0.92;

  // hero 在 order 中的索引（我们锚定在底部的槽位）。
  const heroIdx = Math.max(0, order.indexOf(args.heroSeat));

  // 角度约定：90°（屏幕空间向下）是底部中央的 hero 锚点。我们顺时针推进，
  // 使 hero 左侧的玩家成为下一个座位。
  const bottom = Math.PI / 2;
  const out: SeatPosition[] = [];
  for (let i = 0; i < count; i++) {
    const slot = (i - heroIdx + count) % count; // 0 = hero，然后顺时针
    const angle = bottom + (slot * 2 * Math.PI) / count;
    // 屏幕空间：+x 向右，+y 向下。中心为 (50,50)；半径为 50% 再按 rx/ry 缩放。
    const x = 50 + Math.cos(angle) * 50 * rx;
    const y = 50 + Math.sin(angle) * 50 * ry;
    const seat = order[i]!;
    out.push({
      seat,
      xPct: round2(x),
      yPct: round2(y),
      isHero: seat === args.heroSeat,
    });
  }
  // 按座位索引顺序返回，以保证渲染稳定。
  return out.sort((a, b) => a.seat - b.seat);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
