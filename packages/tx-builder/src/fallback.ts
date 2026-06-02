/**
 * Pre-signed fallback graph (core §6.4 / §15.5, REQ-TX-008, P4 — no table is ever frozen by an
 * absent player). BEFORE play, the N contributors to a funded pot co-sign a **timeout-default**
 * recovery spend that returns each stake. It carries a LOW (non-final) nSequence so a later
 * **cooperative** settlement (higher sequence, up to 0xffffffff final) supersedes it under the
 * original-replacement rule (REQ-TX-002) — demonstrated on-chain in tools/onchain-recovery-e2e.ts.
 * The refund branch uses NO in-script CLTV/CSV (REQ-TX-001); maturity is transaction-level.
 */

import type { BranchBinding } from '@bsv-poker/protocol-types';
import { type Script, fundingUnlocking } from '@bsv-poker/script-templates-ts';
import { type Tx, type TxOutput, buildSettlement } from './txbuilder.ts';
import { sighashMessage } from './wire.ts';

/** The funded outpoint being recovered (its value + funding locking script for the sighash). */
export interface FundingRef {
  readonly txid: string;
  readonly vout: number;
  readonly value: number;
  readonly scriptCode: Script;
}

/** A contributor to the pot and the stake to return to them on timeout. */
export interface Contributor {
  readonly pub: Uint8Array;
  readonly amount: number;
}

/** Produces a script-ready signature for contributor `index` over the sighash message. */
export type Signer = (index: number, sighashMessage: Uint8Array) => Uint8Array;

export interface PresignedSpend {
  readonly kind: 'timeout-refund';
  readonly tx: Tx;
  readonly scriptSig: Script;
  readonly sighash: Uint8Array;
}

/** Refund outputs returning each contributor's stake, after subtracting a flat `fee` from the pot. */
export function refundOutputs(b: BranchBinding, contributors: readonly Contributor[], fee: number): TxOutput[] {
  const total = contributors.reduce((s, c) => s + c.amount, 0);
  if (total <= fee) throw new Error('fee exceeds pot');
  const payable = total - fee;
  // Proportional shares for contributors 1..n; the first contributor absorbs the rounding
  // remainder so the outputs sum to exactly `payable` (value-conserving).
  const tail = contributors.slice(1).map((c) => Math.floor((c.amount / total) * payable));
  const first = payable - tail.reduce((s, v) => s + v, 0);
  return contributors.map((c, i) => buildSettlement(b, c.pub, i === 0 ? first : tail[i - 1]!));
}

/** Build the timeout-default refund transaction (low, non-final sequence). */
export function buildTimeoutRefund(
  b: BranchBinding,
  funding: FundingRef,
  contributors: readonly Contributor[],
  opts: { fee?: number; sequence?: number; nLockTime?: number } = {},
): Tx {
  const fee = opts.fee ?? 0;
  const sequence = opts.sequence ?? 1; // replaceable: a cooperative spend with higher seq supersedes
  return {
    version: 1,
    inputs: [{ prevTxid: funding.txid, vout: funding.vout, sequence }],
    outputs: refundOutputs(b, contributors, fee),
    nLockTime: opts.nLockTime ?? 0,
  };
}

/**
 * Pre-sign the fallback graph: every contributor signs the timeout-default refund over the funding
 * (N-of-N CHECKMULTISIG) sighash, yielding a fully-assembled spend ready to broadcast if the table
 * stalls. The signatures are in contributor order (the order CHECKMULTISIG verifies).
 */
export function presignFallbackGraph(
  b: BranchBinding,
  funding: FundingRef,
  contributors: readonly Contributor[],
  signers: readonly Signer[],
  opts: { fee?: number; sequence?: number; nLockTime?: number } = {},
): PresignedSpend {
  if (signers.length !== contributors.length) throw new Error('one signer per contributor required');
  const tx = buildTimeoutRefund(b, funding, contributors, opts);
  const sighash = sighashMessage(tx, 0, funding.scriptCode, funding.value);
  const sigs = signers.map((sign, i) => sign(i, sighash));
  return { kind: 'timeout-refund', tx, scriptSig: fundingUnlocking(sigs), sighash };
}
