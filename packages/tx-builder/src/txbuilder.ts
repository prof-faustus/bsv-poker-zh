/**
 * 交易构建器（core §6、§15.5）。Phase-1 接口：为各模板族
 * 连同其 branch binding 组装锁定脚本，设置交易层面的时序（依据 original replacement 规则的
 * nLockTime + nSequence——REQ-TX-002；绝不使用脚本内 CLTV/CSV），并
 * 计算托管后端所签名的 sighash preimage（core §6.7）。
 *
 * 每笔交易都绑定 gid + rulesetHash + round + state hash + acting seat + successor
 * commitment（core §6.3、REQ-TX-005），以 pushdata 形式承载于活动脚本中（绝不使用 OP_RETURN）。
 */

import { ByteWriter, bytesToHex, hash256, type BranchBinding } from '@bsv-poker/protocol-types';
import {
  type Script,
  serializeScript,
  fundingLocking,
  foldLocking,
  revealOrTimeoutLocking,
  settlementLocking,
} from '@bsv-poker/script-templates-ts';

/** 极简的交易输出。 */
export interface TxOutput {
  readonly satoshis: number;
  readonly locking: Script;
}

/** 引用某个先前 outpoint 的极简交易输入。 */
export interface TxInput {
  readonly prevTxid: string; // 十六进制
  readonly vout: number;
  /** 依据 original replacement 规则的 nSequence（core §6.2）。0xffffffff = final。 */
  readonly sequence: number;
}

export interface Tx {
  readonly version: number;
  readonly inputs: readonly TxInput[];
  readonly outputs: readonly TxOutput[];
  /** 交易层面的到期（core §6.2/§6.4）。0 = 立即。 */
  readonly nLockTime: number;
}

/**
 * 输入 `index` 的 sighash preimage（对该花费的自包含、确定性承诺：
 * version ‖ 各输入 outpoint+sequence ‖ 各输出 value+lockingScript ‖ nLockTime ‖
 * 被签名的 index）。解释器对 SHA-256(preimage) 验证 ECDSA；生产环境
 * 替换为嵌入式节点的 BIP-143 风格 double-SHA-256 sighash——同样的模板测试依然适用。
 */
export function sighashPreimage(tx: Tx, index: number): Uint8Array {
  const w = new ByteWriter();
  w.u32(tx.version);
  w.arr(tx.inputs, (ww, i) => ww.hex(i.prevTxid).u32(i.vout).u32(i.sequence));
  w.arr(tx.outputs, (ww, o) => ww.u64(o.satoshis).bytes(serializeScript(o.locking)));
  w.u32(tx.nLockTime);
  w.u32(index);
  return w.toBytes();
}

/** 临时 txid（序列化后交易的 double-SHA-256；BSV 约定）。 */
export function txid(tx: Tx): string {
  const w = new ByteWriter();
  w.u32(tx.version);
  w.arr(tx.inputs, (ww, i) => ww.hex(i.prevTxid).u32(i.vout).u32(i.sequence));
  w.arr(tx.outputs, (ww, o) => ww.u64(o.satoshis).bytes(serializeScript(o.locking)));
  w.u32(tx.nLockTime);
  return bytesToHex(hash256(w.toBytes()));
}

// ---- §15.5 构建器（绑定到 branch binding 的锁定脚本组装） ----
export function buildFunding(
  b: BranchBinding,
  pubKeys: readonly Uint8Array[],
  satoshis: number,
): TxOutput {
  return { satoshis, locking: fundingLocking(b, pubKeys) };
}

export function buildFold(b: BranchBinding, playerPub: Uint8Array): TxOutput {
  return { satoshis: 0, locking: foldLocking(b, playerPub) };
}

export function buildReveal(
  b: BranchBinding,
  commitment: Uint8Array,
  revealPub: Uint8Array,
  refundPub: Uint8Array,
  satoshis: number,
): TxOutput {
  return { satoshis, locking: revealOrTimeoutLocking(b, commitment, revealPub, refundPub) };
}

export function buildSettlement(b: BranchBinding, winnerPub: Uint8Array, satoshis: number): TxOutput {
  return { satoshis, locking: settlementLocking(b, winnerPub) };
}

/**
 * 超时/恢复花费使用交易层面的到期：它将 nLockTime 设为到期
 * 高度/时间，并将 nSequence 设为非最终（REQ-TX-002/006/008）。退款分支的脚本
 * 不携带 NO CLTV/CSV（REQ-TX-001）。
 */
export function withMaturity(tx: Tx, nLockTime: number): Tx {
  return {
    ...tx,
    nLockTime,
    inputs: tx.inputs.map((i) => ({ ...i, sequence: Math.min(i.sequence, 0xfffffffe) })),
  };
}
