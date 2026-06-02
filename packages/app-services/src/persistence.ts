/**
 * 持久化记录契约 + 读取时校验（REQ-APP-131/132）。存储保存牌桌、玩家、交易（转录）
 * 以及牌的来源谱系。每条持久化记录都会在读取时被校验；损坏的记录会被**隔离**
 * （暴露出来，绝不静默丢弃或信任），因此存储故障永远无法把错误的承载性状态喂给引擎/UI。
 */

export type RecordKind = 'table' | 'player' | 'transaction' | 'card-lineage';

export interface PersistedRecord {
  readonly kind: RecordKind;
  readonly id: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ReadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly quarantined: unknown; readonly reason: string };

/** 用 `isValid` 校验从存储中读取的原始值；隔离任何未通过校验的内容。 */
export function validateOnRead<T>(raw: unknown, isValid: (r: unknown) => r is T): ReadResult<T> {
  try {
    if (isValid(raw)) return { ok: true, value: raw };
    return { ok: false, quarantined: raw, reason: 'failed schema validation' };
  } catch (e) {
    return { ok: false, quarantined: raw, reason: `validation threw: ${(e as Error).message}` };
  }
}

/** 针对 PersistedRecord 的结构性守卫（REQ-APP-132 读取时校验）。 */
export function isPersistedRecord(r: unknown): r is PersistedRecord {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    (o.kind === 'table' || o.kind === 'player' || o.kind === 'transaction' || o.kind === 'card-lineage') &&
    typeof o.id === 'string' && o.id.length > 0 &&
    !!o.payload && typeof o.payload === 'object'
  );
}

/**
 * 转录保留策略（REQ-APP-133，一项被跟踪的假设）：保留最近的 N 手牌。
 * 默认值是一项有文档记载的假设，可通过配置覆盖；更早的牌局按顺序被裁剪。
 */
export const DEFAULT_RETAINED_HANDS = 100;

export function applyRetention<T>(hands: readonly T[], keepN: number = DEFAULT_RETAINED_HANDS): T[] {
  if (keepN < 0) throw new Error('retention keepN must be >= 0');
  return keepN >= hands.length ? [...hands] : hands.slice(hands.length - keepN);
}

/** 读取一批记录，将有效记录与被隔离的记录区分开（不会静默丢失）。 */
export function readBatch(raws: readonly unknown[]): { records: PersistedRecord[]; quarantined: ReadResult<PersistedRecord>[] } {
  const records: PersistedRecord[] = [];
  const quarantined: ReadResult<PersistedRecord>[] = [];
  for (const raw of raws) {
    const r = validateOnRead(raw, isPersistedRecord);
    if (r.ok) records.push(r.value);
    else quarantined.push(r);
  }
  return { records, quarantined };
}
