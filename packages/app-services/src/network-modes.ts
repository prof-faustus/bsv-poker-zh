/**
 * 连接模式（REQ-APP-040/041，§A4.1）以及双路径冲突的暴露（REQ-APP-074，core §8.5）。
 * 客户端要么通过 loopback 与捆绑在本地的 relay+node 通信（开发/regtest，默认），
 * 要么连接远程 relay。当速度路径与权威路径不一致时，权威值胜出且冲突会被暴露——
 * 速度路径绝不会静默地覆盖权威值。
 */

export type ConnectionMode = 'bundled-local' | 'remote-relay';

/**
 * 仅当本地服务处于 READY 状态时，大厅才允许创建/加入牌桌（REQ-APP-023）。
 * 任何其他 supervisor 状态（starting/degraded/shutdown/fatal）都会关闭牌桌操作的闸门。
 */
export function canCreateOrJoin(supervisorStatus: string): boolean {
  return supervisorStatus === 'ready';
}

export interface ConnectionSelection {
  readonly mode: ConnectionMode;
  readonly base: string;
  readonly loopback: boolean;
}

/** 解析连接模式。桌面端/regtest 默认使用 loopback 上捆绑在本地的伴随服务。 */
export function resolveConnectionMode(opts?: { environment?: 'desktop' | 'web'; relayUrl?: string }): ConnectionSelection {
  if (opts?.relayUrl) {
    const loopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(opts.relayUrl);
    return { mode: loopback ? 'bundled-local' : 'remote-relay', base: opts.relayUrl, loopback };
  }
  return { mode: 'bundled-local', base: 'http://127.0.0.1:8091', loopback: true };
}

export interface PathReading<T> {
  readonly speed?: T;
  readonly canonical?: T;
}

export interface Reconciled<T> {
  readonly value: T | undefined;
  readonly conflict: boolean;
  readonly source: 'canonical' | 'speed' | 'none';
}

/**
 * 协调在两条路径上都观察到的值。权威路径具有权威性；如果速度路径与权威路径不同，
 * 那就是一个被暴露出来的冲突（REQ-APP-074）——绝不会被静默覆盖。
 */
export function reconcile<T>(r: PathReading<T>, eq: (a: T, b: T) => boolean = Object.is): Reconciled<T> {
  if (r.canonical !== undefined) {
    const conflict = r.speed !== undefined && !eq(r.speed, r.canonical);
    return { value: r.canonical, conflict, source: 'canonical' };
  }
  if (r.speed !== undefined) return { value: r.speed, conflict: false, source: 'speed' }; // 临时值
  return { value: undefined, conflict: false, source: 'none' };
}
