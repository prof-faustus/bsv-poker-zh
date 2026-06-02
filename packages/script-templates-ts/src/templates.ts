/**
 * 脚本模板族（core §6.6），由 GB2616862 的双方实例放大而来。
 * 每个承诺/锚点都以 PUSHDATA 形式承载于一段活动脚本中（`<data> OP_DROP`），绝不使用
 * OP_RETURN（core P11/§6.5、REQ-TX-010）。时序在交易层面处理（nLockTime/nSequence，
 * REQ-TX-002）——任何锁定脚本中都没有 CLTV/CSV（REQ-TX-001）。
 *
 * 每个模板都配有一个正向花费和一组在解释器内部失败的负向测试集
 * （REQ-TX-011、P9——见 test/templates.test.ts），外加一个可度量的线路协议字节大小
 * （scriptSizeBytes），作为可复现向量记录下来（§19.C）。
 */

import { createHash } from 'node:crypto';
import { sha256, hexToBytes, type BranchBinding, ByteWriter } from '@bsv-poker/protocol-types';
import { OP } from './opcodes.ts';
import type { Script } from './script.ts';

function ripemd160(b: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('ripemd160').update(Buffer.from(b)).digest());
}

/**
 * 规范的 branch-binding 字节（core §6.3、REQ-TX-005）。所有字段均为定宽，因此
 * 以 RAW 形式写入（无长度前缀）：gid(8) ‖ rulesetHash(32) ‖ round(u32) ‖ stateHash(32)
 * ‖ actingSeat(u8) ‖ successorCommitment(32) = 109 字节。
 */
export function bindingBytes(b: BranchBinding): Uint8Array {
  const w = new ByteWriter();
  const raw = (hex: string): void => {
    for (const x of hexToBytes(hex)) w.u8(x);
  };
  raw(b.gid);
  raw(b.rulesetHash);
  w.u32(b.round);
  raw(b.stateHash);
  w.u8(b.actingSeat < 0 ? 0xff : b.actingSeat);
  raw(b.successorCommitment);
  return w.toBytes();
}

/** `<binding> OP_DROP`——防重放绑定，以 pushdata 形式置于活动脚本中（绝不使用 OP_RETURN）。 */
export function branchBindingPrefix(b: BranchBinding): Script {
  return [bindingBytes(b), OP.OP_DROP];
}

/** Funding：对玩家买入的 N-of-N 多签；绑定 gid+rulesetHash（core §6.6）。 */
export function fundingLocking(b: BranchBinding, pubKeys: readonly Uint8Array[]): Script {
  const n = pubKeys.length;
  if (n < 1 || n > 3) throw new Error('Phase-1 funding supports 1..3 of N via small ints');
  const nOp = [OP.OP_1, OP.OP_2, OP.OP_3][n - 1]!;
  return [...branchBindingPrefix(b), nOp, ...pubKeys, nOp, OP.OP_CHECKMULTISIG];
}
/** N-of-N funding 多签的解锁脚本：OP_0（legacy dummy）随后是 N 个签名。 */
export function fundingUnlocking(sigs: readonly Uint8Array[]): Script {
  return [OP.OP_0, ...sigs];
}

/**
 * Reveal-or-timeout（core §6.6）：IF 分支在到期前接受有效的揭示开启
 * （SHA-256(preimage)=cmt）；ELSE 分支是退款路径，只有在到期后才变为
 * 可花费——到期在 TRANSACTION 层面（nLockTime）强制，
 * 而非在脚本内（REQ-TX-001/002）。
 */
export function revealOrTimeoutLocking(
  b: BranchBinding,
  commitment: Uint8Array,
  revealPub: Uint8Array,
  refundPub: Uint8Array,
): Script {
  return [
    ...branchBindingPrefix(b),
    OP.OP_IF,
    OP.OP_SHA256,
    commitment,
    OP.OP_EQUALVERIFY,
    revealPub,
    OP.OP_CHECKSIG,
    OP.OP_ELSE,
    refundPub,
    OP.OP_CHECKSIG,
    OP.OP_ENDIF,
  ];
}
export function revealUnlocking(sig: Uint8Array, preimage: Uint8Array): Script {
  return [sig, preimage, OP.OP_1];
}
export function timeoutRefundUnlocking(sig: Uint8Array): Script {
  return [sig, OP.OP_0];
}

/**
 * Fold（core §6.6、P5）：证明玩家控制其隐藏的输出，并在 WITHOUT 披露牌面值的情况下
 * 将它们让渡至弃牌状态——它仅仅是一个控制权证明 + 绑定。
 */
export function foldLocking(b: BranchBinding, playerPub: Uint8Array): Script {
  return [...branchBindingPrefix(b), playerPub, OP.OP_CHECKSIG];
}
export function foldUnlocking(sig: Uint8Array): Script {
  return [sig];
}

/** Settlement（core §6.6）：在有效签名 + 绑定的条件下向赢家付款。 */
export function settlementLocking(b: BranchBinding, winnerPub: Uint8Array): Script {
  return [...branchBindingPrefix(b), winnerPub, OP.OP_CHECKSIG];
}
export function settlementUnlocking(sig: Uint8Array): Script {
  return [sig];
}

/**
 * Fair-play（core §4.7、§6.6、REQ-CRYPTO-006/009）：一个脚本内证明，证明某方 USED 的密钥
 * 派生自它 COMMITTED 的内容——不匹配则没收抵押资金（在没有裁判的情况下，诚实博弈是
 * 理性的结果）。认领分支揭示公钥，要求
 * HASH160(pub) == 已承诺的密钥承诺，然后是该密钥下的签名；使用了不同密钥的一方
 * 无法满足哈希检查，因而无法赎回。
 *
 * REQ-CRYPTO-009 / §19.C：这是按牌/按批次的公平博弈结构（作为对单个 52 张牌的 N 方
 * EC 派生脚本的、已度量大小的回退方案）。完整的 GB2616862 脚本内
 * EC 点派生证明（第 55–60 页）是 §19.C 的升级方案，待嵌入式节点的
 * 解释器提供 EC 数值操作码后即可启用——在此之前字节大小为 TRACKED ASSUMPTION。
 */
export function fairPlayCommitment(pub: Uint8Array): Uint8Array {
  // HASH160(pub) = RIPEMD160(SHA256(pub))。
  const inner = sha256(pub);
  // 通过本地的 ripemd 路径复用解释器的哈希
  return ripemd160(inner);
}

export function fairPlayLocking(
  b: BranchBinding,
  keyCommitment: Uint8Array,
  refundPub: Uint8Array,
): Script {
  return [
    ...branchBindingPrefix(b),
    OP.OP_IF,
    OP.OP_DUP,
    OP.OP_HASH160,
    keyCommitment,
    OP.OP_EQUALVERIFY,
    OP.OP_CHECKSIG,
    OP.OP_ELSE,
    refundPub,
    OP.OP_CHECKSIG,
    OP.OP_ENDIF,
  ];
}
/** 通过揭示已承诺的密钥 + 该密钥下的签名来认领公平博弈资金。 */
export function fairPlayClaimUnlocking(sig: Uint8Array, pub: Uint8Array): Script {
  return [sig, pub, OP.OP_1];
}
/** 没收/退款分支（到期后；交易层面，绝不在脚本内）。 */
export function fairPlayForfeitUnlocking(sig: Uint8Array): Script {
  return [sig, OP.OP_0];
}

// ---- 脚本内 EC 公平博弈（GB2616862 §19.C，Genesis 之后的操作码） ---------
// secp256k1 域素数 p（y² = x³ + 7 mod p）。p ≡ 3 (mod 4)，故 √a = a^((p+1)/4) mod p。
export const SECP256K1_P = BigInt(
  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f',
);

function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/**
 * 标量 `s` 对应的洗牌密钥点 P' = (s, √(s³+7))（GB2616862 §4.2）：私钥即
 * x 坐标 `s`。若 s³+7 是二次剩余（即合法的曲线 x）则返回该点，否则返回
 * null（调用方另选一个 s——真正的洗牌密钥被选取得使此条件成立）。
 */
export function shuffleKeyPoint(s: bigint): { x: bigint; y: bigint } | null {
  const a = (((s * s % SECP256K1_P) * s) % SECP256K1_P + 7n) % SECP256K1_P;
  const y = modpow(a, (SECP256K1_P + 1n) / 4n, SECP256K1_P);
  if ((y * y) % SECP256K1_P !== a) return null; // a 不是 QR → s 不是合法的洗牌密钥 x
  return { x: s, y };
}

/** Script 数值编码（小端、符号-数值表示），与解释器的 `num` 相匹配。 */
export function encodeScriptNum(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  const neg = n < 0n;
  let x = neg ? -n : n;
  const out: number[] = [];
  while (x > 0n) {
    out.push(Number(x & 0xffn));
    x >>= 8n;
  }
  if ((out[out.length - 1]! & 0x80) !== 0) out.push(neg ? 0x80 : 0x00);
  else if (neg) out[out.length - 1]! |= 0x80;
  return Uint8Array.from(out);
}

/** 对洗牌密钥标量 x 的承诺：SHA-256(encodeScriptNum(x))——在揭示前隐藏 x。 */
export function shuffleKeyCommitment(x: bigint): Uint8Array {
  return sha256(encodeScriptNum(x));
}

/**
 * Fair-play（真实的脚本内 EC——GB2616862 §4.7/§19.C）。证明该方使用了它所承诺的
 * 洗牌密钥：解锁脚本揭示标量 `x`（= 该密钥的 x 坐标）和 `y`；
 * 脚本验证 (a) SHA-256(x) 等于承诺（该方未掉换密钥），以及 (b) 该
 * 点确实在 secp256k1 上：y² ≡ x³ + 7 (mod p)。不匹配的密钥会在
 * 解释器内部失败，资金被没收（在没有裁判的情况下，诚实博弈是理性的结果）。
 * 使用 Genesis 之后的大整数操作码（OP_MUL/OP_MOD/OP_ADD/OP_NUMEQUALVERIFY）——现已
 * 可用，取代了早先仅使用 HASH160 的回退方案。
 */
export function fairPlayEcLocking(b: BranchBinding, xCommitment: Uint8Array): Script {
  const p = encodeScriptNum(SECP256K1_P);
  const seven = encodeScriptNum(7n);
  return [
    ...branchBindingPrefix(b),
    // 来自解锁脚本的栈：[x, y]
    OP.OP_OVER, // [x, y, x]
    OP.OP_SHA256, // [x, y, H(x)]
    xCommitment,
    OP.OP_EQUALVERIFY, // 验证 H(x)==commitment → [x, y]
    OP.OP_SWAP, // [y, x]
    OP.OP_DUP,
    OP.OP_DUP,
    OP.OP_MUL,
    OP.OP_MUL, // [y, x^3]
    seven,
    OP.OP_ADD, // [y, x^3+7]
    p,
    OP.OP_MOD, // [y, (x^3+7) mod p] = rhs
    OP.OP_SWAP, // [rhs, y]
    OP.OP_DUP,
    OP.OP_MUL, // [rhs, y^2]
    p,
    OP.OP_MOD, // [rhs, y^2 mod p]
    OP.OP_NUMEQUALVERIFY, // 验证 y^2 mod p == rhs → []
    OP.OP_1, // 成功
  ];
}
export function fairPlayEcUnlocking(x: bigint, y: bigint): Script {
  return [encodeScriptNum(x), encodeScriptNum(y)];
}

/** 用于 reveal-or-timeout 的隐藏承诺 preimage SHA-256(face‖blind)（core §4.5/§4.6）。 */
export function revealPreimage(face: number, blind: Uint8Array): Uint8Array {
  const w = new ByteWriter();
  w.u8(face);
  for (const x of blind) w.u8(x);
  return w.toBytes();
}
export function revealCommitment(face: number, blind: Uint8Array): Uint8Array {
  return sha256(revealPreimage(face, blind));
}
