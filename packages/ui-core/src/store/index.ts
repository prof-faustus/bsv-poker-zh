/**
 * 极小的单向 store（REQ-APP-050）。它不包含任何业务逻辑：仅保存一份
 * 渲染快照并通知订阅者。游戏逻辑位于引擎中（通过 app-services 客户端）；
 * 此 store 只是把该输出投影为渲染状态，并让 React 通过 useSyncExternalStore
 * 进行订阅。
 */

export interface Store<T> {
  getSnapshot(): T;
  setSnapshot(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot() {
      return snapshot;
    },
    setSnapshot(next: T) {
      snapshot = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
