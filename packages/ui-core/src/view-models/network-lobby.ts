/**
 * 联网大厅 view-models（§A6.3/§A7）—— 用于基于 relay 的多人对局流程的纯辅助函数：
 * 每个对局的身份（随机 player id + 用于确定性座位排序的身份 pubkey hex）、把建桌表单
 * 校验为 relay TableMeta 形状，以及纯粹的等待室状态投影。不依赖 React、无 I/O——
 * 适合 `node --test` 的类型剥离环境。
 *
 * NOTE: 此处的 "pub" 是每个对局随机生成的 hex，仅用于等待室中的座位排序
 *（LobbyClient 按 pub 对加入的玩家排序）。它不是真正的 secp256k1 身份密钥——
 * 链上托管/身份路径走的是 Node SDK 路径（§A2.3），而非这个浏览器 bundle。
 */

/** Variant id（protocol-types 的 Variant 的结构性镜像——ui-core 保持轻量导入）。 */
export type VariantId = 'holdem' | 'omaha' | 'stud' | 'draw' | 'razz';

/** 每个变体的座位范围元数据（app-services VARIANT_INFO 的结构性镜像，使该
 * view-model 无需导入 app-services 即可校验座位数）。应用会把真正的
 * VARIANT_INFO 标签传入 UI；这些边界让纯校验保持自包含。 */
export const VARIANT_SEAT_RANGE: Record<VariantId, { readonly minSeats: number; readonly maxSeats: number }> = {
  holdem: { minSeats: 2, maxSeats: 9 },
  omaha: { minSeats: 2, maxSeats: 9 },
  stud: { minSeats: 2, maxSeats: 8 },
  draw: { minSeats: 2, maxSeats: 6 },
  razz: { minSeats: 2, maxSeats: 8 },
};

/** app-services LobbyClient 所消费的 TableMeta 形状（保持结构性以避免把
 * app-services 导入 ui-core —— ui-core 必须不依赖 app-services）。 */
export interface NetworkTableMeta {
  readonly name: string;
  readonly variant: VariantId;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly startingStack: number;
  readonly maxSeats: number;
  /** Omaha hi-lo 分池开关（仅对 omaha 有意义）。携带在 meta 中用于显示。 */
  readonly hiLo?: boolean;
}

export interface SessionIdentity {
  /** 面向用户的 player id（例如 "player-3f9a"）。 */
  readonly id: string;
  /** 用于确定性座位排序的随机 hex（不是真正的密钥——见文件头部）。 */
  readonly pub: string;
}

export interface NetworkTableForm {
  readonly name: string;
  readonly variant: VariantId;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly startingStack: number;
  readonly maxSeats: number;
  /** Omaha hi-lo 分池（其他变体忽略）。 */
  readonly hiLo?: boolean;
}

export interface NetworkTableValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/** 随机字节源——默认使用平台 crypto（浏览器与 Node 24）。可注入以便测试。 */
export type RandomBytes = (n: number) => Uint8Array;

/** Web Crypto getRandomValues 的最小结构性视图（浏览器与 Node 24 中均存在），
 * 在本地定义类型，使本模块既不需要 DOM `lib` 也不需要具名的 `Crypto` 全局类型。 */
interface RandomSource {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

const defaultRandomBytes: RandomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  (globalThis as { crypto: RandomSource }).crypto.getRandomValues(out);
  return out;
};

export function bytesToHexLower(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** 生成一份新的每对局身份：一个简短可读的 id + 一个 33 字节的 "pub" hex。 */
export function generateIdentity(randomBytes: RandomBytes = defaultRandomBytes): SessionIdentity {
  const idTag = bytesToHexLower(randomBytes(2));
  // 33 字节对应压缩 pubkey 的宽度；首字节被强制设为 02/03，仅作外观处理。
  const pubBytes = randomBytes(33);
  pubBytes[0] = (pubBytes[0]! & 1) === 0 ? 0x02 : 0x03;
  return { id: `player-${idTag}`, pub: bytesToHexLower(pubBytes) };
}

export function validateNetworkTable(form: NetworkTableForm): NetworkTableValidation {
  const errors: string[] = [];
  if (form.name.trim().length === 0) errors.push('Table name is required.');
  if (!(form.smallBlind > 0)) errors.push('Small blind must be positive.');
  if (!(form.bigBlind > form.smallBlind)) errors.push('Big blind must exceed the small blind.');
  if (!(form.startingStack >= form.bigBlind * 2)) {
    errors.push('Starting stack must be at least two big blinds.');
  }
  const range = VARIANT_SEAT_RANGE[form.variant];
  if (!range) {
    errors.push('Unknown variant.');
  } else if (
    !(Number.isInteger(form.maxSeats) && form.maxSeats >= range.minSeats && form.maxSeats <= range.maxSeats)
  ) {
    errors.push(`Seats must be a whole number between ${range.minSeats} and ${range.maxSeats} for this variant.`);
  }
  return { ok: errors.length === 0, errors };
}

/** 从已校验的表单组装 relay TableMeta（五种变体中的任意一种）。 */
export function metaFromNetworkForm(form: NetworkTableForm): NetworkTableMeta {
  const hiLo = form.variant === 'omaha' ? Boolean(form.hiLo) : false;
  return {
    name: form.name.trim(),
    variant: form.variant,
    smallBlind: form.smallBlind,
    bigBlind: form.bigBlind,
    startingStack: form.startingStack,
    maxSeats: form.maxSeats,
    hiLo,
  };
}

export interface WaitingRoomVM {
  /** 到目前为止在等待室中看到的玩家。 */
  readonly players: readonly { id: string; pub: string }[];
  readonly joined: number;
  readonly capacity: number;
  readonly full: boolean;
  /** "Waiting for players (n/maxSeats)…" 或 "Table full — seating…"。 */
  readonly statusText: string;
}

export function waitingRoomVM(
  players: readonly { id: string; pub: string }[],
  capacity: number,
): WaitingRoomVM {
  const joined = players.length;
  const full = joined >= capacity;
  return {
    players,
    joined,
    capacity,
    full,
    statusText: full
      ? 'Table full — agreeing seats and starting…'
      : `Waiting for players (${joined}/${capacity})…`,
  };
}

/** 联网对局中座位的标签：对手的 player id（hero 显示为 "(you)"）。 */
export function networkSeatLabel(
  players: readonly { id: string; pub: string }[],
): (seat: { seat: number; isHero: boolean }) => string {
  return (seat) => {
    if (seat.isHero) return '(you)';
    const p = players[seat.seat];
    return p ? `(${p.id})` : '(opponent)';
  };
}
