/**
 * Real BSV transaction WIRE serialization + the BIP-143 (FORKID) sighash (core §6.8). This is
 * the production-faithful encoding the embedded node validates, replacing the simplified
 * self-contained preimage used by the interpreter tests (ADR-0003).
 *
 * Sighash trick that keeps using Node's standard ECDSA API: Bitcoin signs ECDSA over
 * double-SHA256(preimage). We hand signers/`OP_CHECKSIG` the value `sha256(preimage)` and the
 * interpreter verifies ECDSA over `sha256(that)` — so the effective digest is
 * double-SHA256(preimage) = the real sighash. `sighashMessage()` returns exactly that value.
 */

import { ByteWriter, bytesToHex, hexToBytes, sha256, hash256 } from '@bsv-poker/protocol-types';
import { type Script, serializeScript } from '@bsv-poker/script-templates-ts';
import type { Tx, TxInput, TxOutput } from './txbuilder.ts';

/** SIGHASH_ALL | SIGHASH_FORKID (BSV/BCH replay-protected). */
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
/** prevTxid is a display (big-endian) hex; on the wire it is little-endian (reversed). */
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

/** Serialize a tx to wire bytes (scriptSigs supplied per input, default empty). */
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

/** Real txid: double-SHA256 of the wire tx, displayed big-endian (reversed). */
export function txidWire(tx: Tx, scriptSigs: readonly Script[] = []): string {
  const h = hash256(serializeTxWire(tx, scriptSigs));
  return bytesToHex(Uint8Array.from([...h].reverse()));
}

/** The BIP-143 preimage for input `index`, spending a `scriptCode` output worth `value` sats. */
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
 * The value to sign / verify at OP_CHECKSIG for input `index` = sha256(bip143Preimage). Because
 * the interpreter (and the custody signer) apply ECDSA-over-SHA256 to this, the effective signed
 * digest is double-SHA256(preimage) — the real BSV BIP-143 sighash.
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
