/**
 * 错误分类体系（REQ-APP-110；错误码见 Appendix III）。每个对外暴露的错误都带有一个稳定的 code、
 * 一个类别（category）以及一个可恢复（recoverable）标志，使 UI 能够一致地作出反应，且日志/指标可以
 * 按 code 进行索引。未知的 code 会降级为不可恢复的内部错误（fail-closed）。
 */

export type ErrorCategory = 'network' | 'protocol' | 'custody' | 'persistence' | 'user' | 'internal';

export interface AppError {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly message: string;
  readonly recoverable: boolean;
}

const TABLE: Record<string, { category: ErrorCategory; recoverable: boolean }> = {
  NET_DISCONNECTED: { category: 'network', recoverable: true },
  NET_RELAY_UNREACHABLE: { category: 'network', recoverable: true },
  PROTO_INVALID_ENVELOPE: { category: 'protocol', recoverable: false },
  PROTO_OUT_OF_TURN: { category: 'protocol', recoverable: false },
  PROTO_REPLAY: { category: 'protocol', recoverable: false },
  CUSTODY_SIGN_REFUSED: { category: 'custody', recoverable: false },
  PERSIST_CORRUPT_RECORD: { category: 'persistence', recoverable: true },
  USER_INSUFFICIENT_FUNDS: { category: 'user', recoverable: true },
  USER_ACTION_ILLEGAL: { category: 'user', recoverable: true },
  INTERNAL: { category: 'internal', recoverable: false },
};

export const ERROR_CODES: readonly string[] = Object.keys(TABLE);

export function makeError(code: string, message?: string): AppError {
  const entry = TABLE[code] ?? TABLE.INTERNAL!;
  const resolvedCode = TABLE[code] ? code : 'INTERNAL';
  return { code: resolvedCode, category: entry.category, recoverable: entry.recoverable, message: message ?? resolvedCode };
}
