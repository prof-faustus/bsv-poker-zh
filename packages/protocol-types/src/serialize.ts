/**
 * §19.A 规范序列化（字节精确）。所有必须在客户端之间保持确定性的内容（P2）都绑定到它：
 * rulesetHash、分支绑定、状态哈希、承诺原像。
 *
 * 规则（在此固定，由 core 规范规定）：
 *  - 小端定宽整数（u8/u16/u32/u64）。金额为 u64（筹码/聪；
 *    可能超过 2^53，故通过 BigInt 编码）。任何地方都不使用浮点数。
 *  - 枚举编码为 1 字节序数，对应其在 protocol-types 中声明的顺序。
 *  - 变长字段以 u32 字节长度作为长度前缀。
 *  - 布尔值为 u8 ∈ {0,1}。可选字段前面带有一个 u8 存在标志。
 *  - 规范字段顺序即下方序列化器写入的顺序；它具有规范效力。
 *  - H = 对规范字节做 SHA-256（其他地方的 txid 使用 double-SHA-256，遵循 BSV 惯例）。
 */

import { sha256 as portableSha256 } from './sha256.ts';
import type { Card } from './cards.ts';
import { isCard } from './cards.ts';
import {
  VARIANTS,
  BETTING_STRUCTURES,
  FORCED_BET_MODELS,
  SIGNING_MODES,
  CURRENCY_SEMANTICS,
  type Ruleset,
} from './ruleset.ts';
import { ACTION_KINDS, type Action } from './actions.ts';

export class ByteWriter {
  private chunks: number[] = [];

  u8(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new RangeError(`u8: ${n}`);
    this.chunks.push(n);
    return this;
  }

  u16(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError(`u16: ${n}`);
    this.chunks.push(n & 0xff, (n >>> 8) & 0xff);
    return this;
  }

  u32(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`u32: ${n}`);
    this.chunks.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    return this;
  }

  u64(n: number | bigint): this {
    let v = typeof n === 'bigint' ? n : BigInt(n);
    if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64: ${n}`);
    for (let i = 0; i < 8; i++) {
      this.chunks.push(Number(v & 0xffn));
      v >>= 8n;
    }
    return this;
  }

  bool(b: boolean): this {
    return this.u8(b ? 1 : 0);
  }

  /** 带长度前缀（u32）的原始字节。 */
  bytes(b: Uint8Array): this {
    this.u32(b.length);
    for (const x of b) this.chunks.push(x);
    return this;
  }

  /** 带长度前缀的 UTF-8 字符串。 */
  str(s: string): this {
    return this.bytes(new TextEncoder().encode(s));
  }

  /** 带长度前缀的 hex 字符串（解码为字节）。 */
  hex(h: string): this {
    return this.bytes(hexToBytes(h));
  }

  /** 可选值：存在标志（u8），若存在则写入该值。 */
  opt<T>(v: T | undefined, write: (w: this, v: T) => void): this {
    if (v === undefined) return this.u8(0);
    this.u8(1);
    write(this, v);
    return this;
  }

  /** 带长度前缀（u32 计数）的数组。 */
  arr<T>(items: readonly T[], write: (w: this, v: T) => void): this {
    this.u32(items.length);
    for (const it of items) write(this, it);
    return this;
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export function hexToBytes(h: string): Uint8Array {
  if (h.length % 2 !== 0) throw new SyntaxError(`odd hex length: ${h.length}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new SyntaxError(`bad hex: "${h}"`);
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function ordinal<T extends readonly string[]>(table: T, value: T[number]): number {
  const i = table.indexOf(value);
  if (i < 0) throw new RangeError(`not in enum: ${value}`);
  return i;
}

/** H = SHA-256（单次）。可移植（纯 TS），使确定性 core 也能在浏览器中运行。 */
export function sha256(b: Uint8Array): Uint8Array {
  return portableSha256(b);
}

/** double-SHA-256（BSV txid 惯例）。 */
export function hash256(b: Uint8Array): Uint8Array {
  return sha256(sha256(b));
}

// ---- 牌（core §5.1） -------------------------------------------------------
export function serializeCard(w: ByteWriter, c: Card): void {
  if (!isCard(c)) throw new RangeError(`card: ${c}`);
  w.u8(c);
}

// ---- Ruleset（core §5.2） ----------------------------------------------------
export function serializeRuleset(r: Ruleset): Uint8Array {
  const w = new ByteWriter();
  w.u8(ordinal(VARIANTS, r.variant));
  w.u8(ordinal(BETTING_STRUCTURES, r.bettingStructure));
  w.u8(ordinal(FORCED_BET_MODELS, r.forcedBetModel));
  w.u8(r.seats);
  // 盲注
  w.u64(r.blinds.smallBlind).u64(r.blinds.bigBlind).u64(r.blinds.ante).u64(r.blinds.bringIn);
  w.u64(r.minBuyIn).u64(r.maxBuyIn);
  // FL 注额（可选）
  w.opt(r.flSizing, (ww, fl) => {
    ww.u64(fl.smallBet).u64(fl.bigBet).u32(fl.maxRaisesPerStreet);
  });
  // 超时
  w.u32(r.timeouts.decisionMs).u32(r.timeouts.recoveryMs);
  w.u8(ordinal(SIGNING_MODES, r.signingMode));
  w.u8(ordinal(CURRENCY_SEMANTICS, r.currency));
  w.bool(r.suitTiebreakHouseRule);
  w.bool(r.hiLo);
  return w.toBytes();
}

/** rulesetHash = H(canonicalSerialize(Ruleset)) — core §5.2, REQ-POKER-002。 */
export function rulesetHash(r: Ruleset): string {
  return bytesToHex(sha256(serializeRuleset(r)));
}

// ---- Action（core §5.4） -----------------------------------------------------
export function serializeAction(a: Action): Uint8Array {
  const w = new ByteWriter();
  w.u8(ordinal(ACTION_KINDS, a.kind));
  w.u8(a.seat);
  w.u64(a.amount);
  w.opt(a.discard, (ww, d) => ww.arr(d, (x, v) => x.u32(v)));
  return w.toBytes();
}
