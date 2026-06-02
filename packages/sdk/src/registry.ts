/**
 * 游戏注册表（app §A21.2）：variant -> 模块工厂。新增一个游戏就是新增一条注册表
 * 条目 + 一个模块，而不是修改界面（REQ-APP-213）。game-holdem 在此注册；
 * 其他 variant 模块在落地时注册（Phase 3）。
 */

import type { Card, GameState, Variant } from '@bsv-poker/protocol-types';
import type { GameModule } from '@bsv-poker/engine';
import { createHoldem } from '@bsv-poker/game-holdem';
import { createOmaha } from '@bsv-poker/game-omaha';
import { createStud } from '@bsv-poker/game-stud';
import { createDraw } from '@bsv-poker/game-draw';
import { createRazz } from '@bsv-poker/game-razz';

export interface ModuleConfig {
  readonly deck: readonly Card[];
}
export type ModuleFactory = (config: ModuleConfig) => GameModule<GameState> & {
  stateHash: (s: GameState) => string;
};

const registry = new Map<Variant, ModuleFactory>();

export function registerGame(variant: Variant, factory: ModuleFactory): void {
  registry.set(variant, factory);
}

export function getGame(variant: Variant): ModuleFactory {
  const f = registry.get(variant);
  if (!f) throw new Error(`no game module registered for variant: ${variant}`);
  return f;
}

export function registeredVariants(): Variant[] {
  return [...registry.keys()];
}

// 注册内置模块。该模块在其自身的具体状态类型上运作
// （HoldemState 继承 GameState）；注册表以不透明方式将其作为 GameState 返回——状态
// 始终只来自同一模块的 init/apply，因此该类型转换在运行时是安全的。
registerGame('holdem', (cfg) => createHoldem({ deck: cfg.deck }) as unknown as ReturnType<ModuleFactory>);
registerGame('omaha', (cfg) => createOmaha({ deck: cfg.deck }) as unknown as ReturnType<ModuleFactory>);
registerGame('stud', (cfg) => createStud({ deck: cfg.deck }) as unknown as ReturnType<ModuleFactory>);
registerGame('draw', (cfg) => createDraw({ deck: cfg.deck }) as unknown as ReturnType<ModuleFactory>);
registerGame('razz', (cfg) => createRazz({ deck: cfg.deck }) as unknown as ReturnType<ModuleFactory>);
