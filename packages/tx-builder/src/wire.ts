/**
 * 真实的 BSV 交易 WIRE 序列化 + BIP-143（FORKID）sighash（core §6.8）。这是
 * 嵌入式节点所验证的、忠于生产环境的编码，取代了解释器测试所使用的简化版
 * 自包含 preimage（ADR-0003）。
 *
 * 一个仍可继续使用 Node 标准 ECDSA API 的 sighash 技巧：Bitcoin 对
 * double-SHA256(preimage) 进行 ECDSA 签名。我们把值 `sha256(preimage)` 交给签名方/`OP_CHECKSIG`，
 * 而解释器对 `sha256(that)` 验证 ECDSA——因此有效摘要为
 * double-SHA256(preimage) = 真实的 sighash。`sighashMessage()` 恰好返回该值。
 */

import { ByteWriter, bytesToHex, hexToBytes, sha256, hash256 } from '@bsv-poker/protocol-types';
import { type Script, serializeScript } from '@bsv-poker/script-templates-ts';
import type { Tx, TxInput, TxOutput } from './txbuilder.ts';

/** SIGHASH_ALL | SIGHASH_FORKID（BSV/BCH 防重放）。 */
export const SIGHASH_ALL_FORKID = 0x41;

function varInt(w: ByteWriter, n: number): void {
  if (n < 0xfd) w.u8(n);
  else if (n <= 0xffff) w.u8(0xfd).u16(n);
  else w.u8(0xfe).u32(n);
}
function pushVarBytes(w: ByteWriter, b: Uint8Array): void {
  varInt(w, b.length);
  for (const x of b) w.u8(x);
}
/** prevTxid 是用于显示的（大端）十六进制；在线路协议上它是小端（反转）。 */
function outpoint(w: ByteWriter, i: TxInput): void {
  const le = [...hexToBytes(i.prevTxid)].reverse();
  for (const x of le) w.u8(x);
  w.u32(i.vout);
}
function outputBytes(o: TxOutput): Uint8Array {
  const w = new ByteWriter();
  w.u64(o.satoshis);
  pushVarBytes(w, serializeScript(o.locking));
  return w.toBytes();
}

/** 将一笔交易序列化为线路协议字节（scriptSigs 按输入逐个提供，默认为空）。 */
export function serializeTxWire(tx: Tx, scriptSigs: readonly Script[] = []): Uint8Array {
  const w = new ByteWriter();
  w.u32(tx.version);
  varInt(w, tx.inputs.length);
  tx.inputs.forEach((i, idx) => {
    outpoint(w, i);
    pushVarBytes(w, scriptSigs[idx] ? serializeScript(scriptSigs[idx]!) : new Uint8Array(0));
    w.u32(i.sequence);
  });
  varInt(w, tx.outputs.length);
  for (const o of tx.outputs) for (const b of outputBytes(o)) w.u8(b);
  w.u32(tx.nLockTime);
  return w.toBytes();
}

/** 真实的 txid：线路协议交易的 double-SHA256，以大端（反转）显示。 */
export function txidWire(tx: Tx, scriptSigs: readonly Script[] = []): string {
  const h = hash256(serializeTxWire(tx, scriptSigs));
  return bytesToHex(Uint8Array.from([...h].reverse()));
}

/** 输入 `index` 的 BIP-143 preimage，花费价值 `value` 聪、锁定脚本为 `scriptCode` 的输出。 */
export function bip143Preimage(
  tx: Tx,
  index: number,
  scriptCode: Script,
  value: number,
  sighashType: number = SIGHASH_ALL_FORKID,
): Uint8Array {
  const prevouts = new ByteWriter();
  for (const i of tx.inputs) outpoint(prevouts, i);
  const hashPrevouts = hash256(prevouts.toBytes());

  const seqs = new ByteWriter();
  for (const i of tx.inputs) seqs.u32(i.sequence);
  const hashSequence = hash256(seqs.toBytes());

  const outs = new ByteWriter();
  for (const o of tx.outputs) for (const b of outputBytes(o)) outs.u8(b);
  const hashOutputs = hash256(outs.toBytes());

  const w = new ByteWriter();
  w.u32(tx.version);
  for (const b of hashPrevouts) w.u8(b);
  for (const b of hashSequence) w.u8(b);
  outpoint(w, tx.inputs[index]!);
  pushVarBytes(w, serializeScript(scriptCode));
  w.u64(value);
  w.u32(tx.inputs[index]!.sequence);
  for (const b of hashOutputs) w.u8(b);
  w.u32(tx.nLockTime);
  w.u32(sighashType);
  return w.toBytes();
}

/**
 * 输入 `index` 在 OP_CHECKSIG 处用于签名/验证的值 = sha256(bip143Preimage)。因为
 * 解释器（以及托管签名方）对其应用 ECDSA-over-SHA256，有效的被签名
 * 摘要为 double-SHA256(preimage)——即真实的 BSV BIP-143 sighash。
 */
export function sighashMessage(
  tx: Tx,
  index: number,
  scriptCode: Script,
  value: number,
  sighashType: number = SIGHASH_ALL_FORKID,
): Uint8Array {
  return sha256(bip143Preimage(tx, index, scriptCode, value, sighashType));
}
