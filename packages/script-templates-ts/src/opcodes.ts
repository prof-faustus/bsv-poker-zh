/**
 * Genesis 之后的 BSV 操作码集合（core §6.2、REQ-TX-004）。仅限于在 Genesis 之后
 * 仍有意义的原语：签名检查、哈希/相等比较、条件语句，以及用于公平博弈 EC 例程
 * 的数值/栈操作（core §6.6/§19.C）。
 *
 * CRITICAL（REQ-TX-001）：OP_CHECKLOCKTIMEVERIFY / OP_CHECKSEQUENCEVERIFY 在
 * Genesis 之后的 BSV 上为 NO-OP，绝不可用于强制时序——时序在交易层面处理
 * （nLockTime + nSequence，REQ-TX-002）。
 *
 * BANNED（core P11/§6.5、REQ-TX-010）：OP_RETURN（0x6a）绝不可出现在任何锁定脚本或
 * 解锁脚本中。这里列出它仅仅是为了让解释器和 lint 能够 REJECT 它。
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
  OP_OVER: 0x78,
  OP_ADD: 0x93,
  OP_SUB: 0x94,
  OP_MUL: 0x95,
  OP_MOD: 0x97,
  OP_NUMEQUAL: 0x9c,
  OP_NUMEQUALVERIFY: 0x9d,
  // Genesis 之后的 No-op——列出仅为断言它们不强制任何约束（REQ-TX-001）。
  OP_CHECKLOCKTIMEVERIFY: 0xb1,
  OP_CHECKSEQUENCEVERIFY: 0xb2,
  // BANNED——被解释器和 lint 拒绝（core P11/§6.5）。
  OP_RETURN: 0x6a,
} as const;

export const BANNED_OPCODES: readonly number[] = [OP.OP_RETURN];

export const OP_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(OP).map(([k, v]) => [v, k]),
);
