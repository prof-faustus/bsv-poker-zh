/**
 * 信任边界处的输入校验（REQ-APP-103）。每一条跨越信任边界的消息——中继 / peer 的
 * envelope（以及在桌面端的 IPC）——在使用前都会被校验；任何无法识别或格式错误的内容
 * 都会被拒绝（返回 null），绝不部分信任。这是网络客户端对来自（不可信的）中继通道的
 * 入站 envelope 所施加的结构性防护。
 */

export type EnvelopeKind = 'commit' | 'reveal' | 'action';

export interface WireEnvelope {
  readonly t: EnvelopeKind;
  readonly seat: number;
  readonly hand: number;
  readonly c?: string; // commit：H(entropy) 的 hex
  readonly r?: string; // reveal：entropy 的 hex
  readonly kind?: string; // action：ActionKind
  readonly amount?: number; // action：可选下注额
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]+$/i.test(v) && v.length > 0;
const isSeatOrHand = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 校验一个入站 envelope；返回带类型的 envelope，若必须拒绝则返回 null。 */
export function validateEnvelope(raw: unknown): WireEnvelope | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.t !== 'commit' && o.t !== 'reveal' && o.t !== 'action') return null; // 无法识别 → 拒绝
  if (!isSeatOrHand(o.seat) || !isSeatOrHand(o.hand)) return null;

  if (o.t === 'commit') {
    if (!isHex(o.c)) return null;
    return { t: 'commit', seat: o.seat, hand: o.hand, c: o.c };
  }
  if (o.t === 'reveal') {
    if (!isHex(o.r)) return null;
    return { t: 'reveal', seat: o.seat, hand: o.hand, r: o.r };
  }
  // action
  if (typeof o.kind !== 'string' || o.kind.length === 0) return null;
  if (o.amount !== undefined && (typeof o.amount !== 'number' || !Number.isFinite(o.amount))) return null;
  const env: WireEnvelope = { t: 'action', seat: o.seat, hand: o.hand, kind: o.kind };
  return o.amount !== undefined ? { ...env, amount: o.amount } : env;
}

/** Parse a JSON wire frame and validate it; null on bad JSON or a rejected envelope. */
export function parseAndValidate(frame: string): WireEnvelope | null {
  try {
    return validateEnvelope(JSON.parse(frame));
  } catch {
    return null;
  }
}
