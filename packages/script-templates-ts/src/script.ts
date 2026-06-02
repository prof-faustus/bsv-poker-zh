/**
 * Minimal BSV Script model + wire serialization (core §6.6). A Script is a sequence of items:
 * either an opcode (number) or a data push (Uint8Array). Serialization yields the exact wire
 * bytes so the build can MEASURE template sizes as reproducible vectors (REQ-TX-011, §19.C).
 *
 * Commitments are carried as pushdata in a live script (`<data> OP_DROP`), NEVER OP_RETURN
 * (core P11/§6.5, REQ-TX-010).
 */

import { ByteWriter, bytesToHex } from '@bsv-poker/protocol-types';
import { OP, BANNED_OPCODES } from './opcodes.ts';

export type ScriptItem = number | Uint8Array;
export type Script = ScriptItem[];

/** Encode a single data push with minimal pushdata opcodes. */
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

/** Serialize a Script to wire bytes. Throws if a banned opcode (OP_RETURN) appears. */
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

/** Does the serialized script contain the OP_RETURN byte (0x6a)? Used by the lint (rule 2). */
export function containsOpReturn(script: Script): boolean {
  // Note: a 0x6a byte INSIDE a data push is data, not an opcode — but the ban is absolute and
  // our builders never push 0x6a as an opcode; we check the opcode stream only.
  return script.some((item) => typeof item === 'number' && item === OP.OP_RETURN);
}
