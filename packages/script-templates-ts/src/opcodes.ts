/**
 * Post-Genesis BSV opcode palette (core §6.2, REQ-TX-004). Limited to primitives that mean
 * something post-Genesis: signature checks, hash/equality, conditionals, and the numeric/stack
 * ops for the fair-play EC routines (core §6.6/§19.C).
 *
 * CRITICAL (REQ-TX-001): OP_CHECKLOCKTIMEVERIFY / OP_CHECKSEQUENCEVERIFY are NO-OPS on
 * post-Genesis BSV and MUST NOT be used to enforce timing — timing is transaction-level
 * (nLockTime + nSequence, REQ-TX-002).
 *
 * BANNED (core P11/§6.5, REQ-TX-010): OP_RETURN (0x6a) MUST NOT appear in any locking or
 * unlocking script. It is listed here only so the interpreter and lint can REJECT it.
 */

export const OP = {
  OP_0: 0x00,
  OP_PUSHDATA1: 0x4c,
  OP_PUSHDATA2: 0x4d,
  OP_1: 0x51,
  OP_2: 0x52,
  OP_3: 0x53,
  OP_DUP: 0x76,
  OP_DROP: 0x75,
  OP_EQUAL: 0x87,
  OP_EQUALVERIFY: 0x88,
  OP_SHA256: 0xa8,
  OP_HASH160: 0xa9,
  OP_HASH256: 0xaa,
  OP_VERIFY: 0x69,
  OP_IF: 0x63,
  OP_ELSE: 0x67,
  OP_ENDIF: 0x68,
  OP_CHECKSIG: 0xac,
  OP_CHECKSIGVERIFY: 0xad,
  OP_CHECKMULTISIG: 0xae,
  OP_SWAP: 0x7c,
  OP_ADD: 0x93,
  // No-ops post-Genesis — present only to assert they enforce nothing (REQ-TX-001).
  OP_CHECKLOCKTIMEVERIFY: 0xb1,
  OP_CHECKSEQUENCEVERIFY: 0xb2,
  // BANNED — rejected by the interpreter and the lint (core P11/§6.5).
  OP_RETURN: 0x6a,
} as const;

export const BANNED_OPCODES: readonly number[] = [OP.OP_RETURN];

export const OP_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(OP).map(([k, v]) => [v, k]),
);
