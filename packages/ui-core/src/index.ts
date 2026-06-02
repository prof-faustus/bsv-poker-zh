/**
 * @bsv-poker/ui-core — 共享的 UI core（一个 core，两个 shell；§A5）。
 *
 * 子路径导出：
 *   "@bsv-poker/ui-core/view-models" — 纯投影（REQ-APP-051），不依赖 React。
 *   "@bsv-poker/ui-core/components"  — 展示型 React（REQ-APP-052）。
 *   "@bsv-poker/ui-core/store"       — 极小的单向 store（REQ-APP-050）。
 *
 * NOTE: 此根入口有意只重新导出不依赖 React 的 view-models 和 store，
 * 以便使用方（例如 app-services 以及根 `tsc` 类型检查）可以导入此包，
 * 而不会把 JSX/React 引入到 Node 的类型剥离环境中。React 组件位于
 * "./components" 子路径之后。
 */
export * from './view-models/index.ts';
export * from './store/index.ts';
