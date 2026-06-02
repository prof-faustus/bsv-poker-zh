/**
 * 网络选择闸门（core REQ-PROD-012；RT-02 F3）。平台默认处于 research/regtest 模式；
 * 只有在提供显式的、类型化的确认后才能访问 mainnet，且每次选择都会产生一条 UI 必须显示的横幅。
 * 这使得"mainnet 置于显式标志之后"成为一条经过测试的代码路径，而不仅仅是一种约定。
 */

export type Network = 'play-regtest' | 'regtest' | 'mainnet';

export interface NetworkSelection {
  readonly network: Network;
  /** 面向用户的横幅，UI 必须显示（REQ-PROD-012）。 */
  readonly banner: string;
  /** 仅当 mainnet 被显式且正确地确认后才为 true。 */
  readonly mainnetEnabled: boolean;
  readonly realFunds: boolean;
}

/** 调用方为启用 mainnet 必须传入的精确令牌——没有它任何资金都不会移动。 */
export const MAINNET_ACK_TOKEN = 'I-UNDERSTAND-MAINNET-USES-REAL-FUNDS';

const LOOPBACK = /^(127(?:\.\d{1,3}){3}|::1|localhost)$/;

/**
 * 桌面端服务（node/relay/indexer）默认绑定到 loopback（REQ-APP-106）。非 loopback 的绑定
 * 会把本地节点暴露到网络中，因此除非显式选择启用，否则会被拒绝。
 */
export function resolveBindHost(opts?: { host?: string; allowNonLoopback?: boolean }): string {
  const host = opts?.host ?? '127.0.0.1';
  if (!LOOPBACK.test(host) && opts?.allowNonLoopback !== true) {
    throw new Error(`refusing to bind local services to non-loopback host "${host}" without explicit allowNonLoopback (REQ-APP-106)`);
  }
  return host;
}

export function isLoopback(host: string): boolean {
  return LOOPBACK.test(host);
}

export function selectNetwork(opts?: { network?: Network; mainnetAck?: string }): NetworkSelection {
  const requested: Network = opts?.network ?? 'play-regtest';
  if (requested === 'mainnet') {
    if (opts?.mainnetAck !== MAINNET_ACK_TOKEN) {
      throw new Error(
        'mainnet is disabled by default and requires the explicit acknowledgement token ' +
          '(mainnetAck = MAINNET_ACK_TOKEN); refusing — this build is research/regtest only',
      );
    }
    return { network: 'mainnet', banner: '⚠ MAINNET — REAL FUNDS AT RISK (research use only)', mainnetEnabled: true, realFunds: true };
  }
  return {
    network: requested,
    banner: requested === 'regtest' ? '● REGTEST — test coins only, no real value' : '● PLAY-MONEY (regtest) — no real value',
    mainnetEnabled: false,
    realFunds: false,
  };
}
