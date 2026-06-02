/**
 * Transaction builder (core §6, §15.5). Phase-1 surface: assemble the locking scripts for the
 * template families with their branch binding, set transaction-level timing (nLockTime +
 * nSequence under the original replacement rule — REQ-TX-002; NEVER in-script CLTV/CSV), and
 * compute the sighash preimage the custody backend signs (core §6.7).
 *
 * Every transaction binds gid + rulesetHash + round + state hash + acting seat + successor
 * commitment (core §6.3, REQ-TX-005), carried as pushdata in a live script (never OP_RETURN).
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

/** A minimal transaction output. */
export interface TxOutput {
  readonly satoshis: number;
  readonly locking: Script;
}

/** A minimal transaction input referencing a previous outpoint. */
export interface TxInput {
  readonly prevTxid: string; // hex
  readonly vout: number;
  /** nSequence under the original replacement rule (core §6.2). 0xffffffff = final. */
  readonly sequence: number;
}

export interface Tx {
  readonly version: number;
  readonly inputs: readonly TxInput[];
  readonly outputs: readonly TxOutput[];
  /** Transaction-level maturity (core §6.2/§6.4). 0 = immediate. */
  readonly nLockTime: number;
}

/**
 * The sighash preimage for input `index` (a self-contained, deterministic commitment to the
 * spend: version ‖ each input outpoint+sequence ‖ each output value+lockingScript ‖ nLockTime ‖
 * the index being signed). The interpreter verifies ECDSA over SHA-256(preimage); production
 * swaps the embedded node's BIP-143-style double-SHA-256 sighash — same template tests apply.
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

/** Provisional txid (double-SHA-256 of the serialized tx; BSV convention). */
export function txid(tx: Tx): string {
  const w = new ByteWriter();
  w.u32(tx.version);
  w.arr(tx.inputs, (ww, i) => ww.hex(i.prevTxid).u32(i.vout).u32(i.sequence));
  w.arr(tx.outputs, (ww, o) => ww.u64(o.satoshis).bytes(serializeScript(o.locking)));
  w.u32(tx.nLockTime);
  return bytesToHex(hash256(w.toBytes()));
}

// ---- §15.5 builders (locking-script assembly bound to the branch binding) ----
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
 * A timeout/recovery spend uses transaction-level maturity: it sets nLockTime to the maturity
 * height/time and nSequence non-final (REQ-TX-002/006/008). The refund branch's script carries
 * NO CLTV/CSV (REQ-TX-001).
 */
export function withMaturity(tx: Tx, nLockTime: number): Tx {
  return {
    ...tx,
    nLockTime,
    inputs: tx.inputs.map((i) => ({ ...i, sequence: Math.min(i.sequence, 0xfffffffe) })),
  };
}
