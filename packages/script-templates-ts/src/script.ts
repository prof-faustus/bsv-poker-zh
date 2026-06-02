/**
 * 极简的 BSV Script 模型 + 线路协议序列化（core §6.6）。一段 Script 是一系列项的序列：
 * 要么是操作码（number），要么是数据推送（Uint8Array）。序列化产生精确的线路协议
 * 字节，以便构建过程能将模板大小作为可复现向量来 MEASURE（REQ-TX-011、§19.C）。
 *
 * 承诺以 pushdata 形式承载于一段活动脚本中（`<data> OP_DROP`），绝不使用 OP_RETURN
 * （core P11/§6.5、REQ-TX-010）。
 */

import { ByteWriter, bytesToHex } from '@bsv-poker/protocol-types';
import { OP, BANNED_OPCODES } from './opcodes.ts';

export type ScriptItem = number | Uint8Array;
export type Script = ScriptItem[];

/** 用最小化的 pushdata 操作码编码单次数据推送。 */
export function pushData(w: ByteWriter, data: Uint8Array): void {
  const n = data.length;
  if (n < OP.OP_PUSHDATA1) {
    w.u8(n);
  } else if (n <= 0xff) {
    w.u8(OP.OP_PUSHDATA1).u8(n);
  } else if (n <= 0xffff) {
    w.u8(OP.OP_PUSHDATA2).u16(n);
  } else {
    throw new RangeError('push too large for this builder');
  }
  for (const b of data) w.u8(b);
}

/** 将一段 Script 序列化为线路协议字节。若出现被禁的操作码（OP_RETURN）则抛出异常。 */
export function serializeScript(script: Script): Uint8Array {
  const w = new ByteWriter();
  for (const item of script) {
    if (typeof item === 'number') {
      if (BANNED_OPCODES.includes(item)) {
        throw new Error(`banned opcode in script: 0x${item.toString(16)} (OP_RETURN, core P11)`);
      }
      w.u8(item);
    } else {
      pushData(w, item);
    }
  }
  return w.toBytes();
}

export function scriptSizeBytes(script: Script): number {
  return serializeScript(script).length;
}

export function scriptHex(script: Script): string {
  return bytesToHex(serializeScript(script));
}

/** 序列化后的脚本是否包含 OP_RETURN 字节（0x6a）？由 lint 使用（规则 2）。 */
export function containsOpReturn(script: Script): boolean {
  // 注意：数据推送 INSIDE 的 0x6a 字节是数据，而非操作码——但该禁令是绝对的，
  // 且我们的构建器从不将 0x6a 作为操作码推送；我们只检查操作码流。
  return script.some((item) => typeof item === 'number' && item === OP.OP_RETURN);
}
