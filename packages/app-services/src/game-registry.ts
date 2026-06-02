/**
 * 浏览器安全的游戏注册表（app §A21.2）——为全部五种变体提供 variant → 模块工厂的映射。
 * 让 web 客户端和网络客户端能够通用地进行任意变体的对战（SDK 的注册表通过
 * crypto-mentalpoker 引入了 node:crypto，无法在浏览器中运行；而游戏模块本身是
 * 浏览器安全的——它们只使用 protocol-types 提供的可移植 sha256）。
 */

import type { Card, GameState, Variant } from '@bsv-poker/protocol-types';
import type { GameModule } from '@bsv-poker/engine';
import { createHoldem } from '@bsv-poker/game-holdem';
import { createOmaha } from '@bsv-poker/game-omaha';
import { createStud } from '@bsv-poker/game-stud';
import { createDraw } from '@bsv-poker/game-draw';
import { createRazz } from '@bsv-poker/game-razz';

export type GenericGameModule = GameModule<GameState> & { stateHash: (s: GameState) => string };

const FACTORIES: Record<Variant, (deck: readonly Card[], buttonIndex: number) => GenericGameModule> = {
  // Hold'em 在每手牌之间轮转庄家按钮（§19.E S13）；其余变体仅接收牌堆
  // （stud/razz 使用 bring-in 而非按钮；draw/omaha 在此默认使用按钮 0）。
  holdem: (deck, buttonIndex) => createHoldem({ deck, buttonIndex }) as unknown as GenericGameModule,
  omaha: (deck) => createOmaha({ deck }) as unknown as GenericGameModule,
  stud: (deck) => createStud({ deck }) as unknown as GenericGameModule,
  draw: (deck) => createDraw({ deck }) as unknown as GenericGameModule,
  razz: (deck) => createRazz({ deck }) as unknown as GenericGameModule,
};

export function createGameModule(
  variant: Variant,
  deck: readonly Card[],
  buttonIndex = 0,
): GenericGameModule {
  const f = FACTORIES[variant];
  if (!f) throw new Error(`no module for variant: ${variant}`);
  return f(deck, buttonIndex);
}

export const SUPPORTED_VARIANTS: readonly Variant[] = ['holdem', 'omaha', 'stud', 'draw', 'razz'];

/** 供大厅 UI 使用的各变体显示元数据。 */
export const VARIANT_INFO: Record<
  Variant,
  { readonly label: string; readonly minSeats: number; readonly maxSeats: number; readonly note: string }
> = {
  holdem: { label: "Texas Hold'em", minSeats: 2, maxSeats: 9, note: '2 hole cards, community board' },
  omaha: { label: 'Omaha (PLO / Hi-Lo)', minSeats: 2, maxSeats: 9, note: '4 hole cards, use exactly 2+3' },
  stud: { label: 'Seven-Card Stud', minSeats: 2, maxSeats: 8, note: 'ante + bring-in, up/down cards' },
  draw: { label: 'Five-Card Draw', minSeats: 2, maxSeats: 6, note: 'discard & draw' },
  razz: { label: 'Razz (ace-to-five low)', minSeats: 2, maxSeats: 8, note: 'lowest hand wins' },
};

// ---- 预留（计划中）的游戏（REQ-APP-219） ----
export interface PlannedGameProfile {
  readonly id: string;
  readonly label: string;
  readonly status: 'planned';
  readonly reason: string;
  /** 为 UI 预留的变体配置控件（无玩家间底池；设有一个荷官区域）。 */
  readonly controls: readonly string[];
  readonly dealerArea: boolean;
  readonly interPlayerPot: boolean;
}

/**
 * 规范要求（REQUIRES）但其协议模型尚处于 DECISION REQUIRED 的游戏——现在予以预留（注册表
 * 条目 + 变体配置 + 测试义务），但不交付任何项目尚未明确指定的模型（P7/P8）。Blackjack 是
 * 无荷官的，需要它自己的隐藏/结算模型（core D7）；它不会被偷偷塞进扑克流水线中。
 */
export const PLANNED_GAMES: readonly PlannedGameProfile[] = [
  {
    id: 'blackjack',
    label: 'Blackjack (dealerless)',
    status: 'planned',
    reason: 'dealerless blackjack needs its own concealment + settlement model (core D7); protocol model DECISION REQUIRED (REQ-APP-219)',
    controls: ['hit', 'stand', 'double', 'split', 'insurance'],
    dealerArea: true,
    interPlayerPot: false,
  },
];

/** 在其协议模型被确定之前，计划中的游戏无法被实例化——fail-closed（P7/P8）。 */
export function createPlannedGame(id: string): never {
  const g = PLANNED_GAMES.find((p) => p.id === id);
  throw new Error(g ? `${g.label} is reserved but not yet playable: ${g.reason}` : `unknown planned game: ${id}`);
}
