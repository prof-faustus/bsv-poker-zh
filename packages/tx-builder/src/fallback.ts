/**
 * 预签名回退图（core §6.4 / §15.5、REQ-TX-008、P4——绝不允许因某玩家缺席而冻结牌桌）。
 * 在开局 BEFORE，某个已注资底池的 N 个出资人共同签署一笔 **timeout-default**
 * 恢复花费，将各自的本金退回。它携带一个 LOW（非最终）的 nSequence，以便后续的
 * **cooperative** 结算（更高的 sequence，最高可至 0xffffffff final）依据
 * original-replacement 规则取代它（REQ-TX-002）——在 tools/onchain-recovery-e2e.ts 中链上演示。
 * 退款分支不使用 NO 脚本内 CLTV/CSV（REQ-TX-001）；到期在交易层面处理。
 */

import type { BranchBinding } from '@bsv-poker/protocol-types';
import { type Script, fundingUnlocking } from '@bsv-poker/script-templates-ts';
import { type Tx, type TxOutput, buildSettlement } from './txbuilder.ts';
import { sighashMessage } from './wire.ts';

/** 正在被恢复的已注资 outpoint（其 value + 用于 sighash 的 funding 锁定脚本）。 */
export interface FundingRef {
  readonly txid: string;
  readonly vout: number;
  readonly value: number;
  readonly scriptCode: Script;
}

/** 底池的一个出资人，以及超时时退还给他们的本金。 */
export interface Contributor {
  readonly pub: Uint8Array;
  readonly amount: number;
}

/** 为出资人 `index` 生成一个对 sighash message 的、可用于脚本的签名。 */
export type Signer = (index: number, sighashMessage: Uint8Array) => Uint8Array;

export interface PresignedSpend {
  readonly kind: 'timeout-refund';
  readonly tx: Tx;
  readonly scriptSig: Script;
  readonly sighash: Uint8Array;
}

/** 在从底池中扣除统一的 `fee` 之后，退还每位出资人本金的退款输出。 */
export function refundOutputs(b: BranchBinding, contributors: readonly Contributor[], fee: number): TxOutput[] {
  const total = contributors.reduce((s, c) => s + c.amount, 0);
  if (total <= fee) throw new Error('fee exceeds pot');
  const payable = total - fee;
  // 出资人 1..n 按比例分配；第一位出资人吸收取整产生的
  // 余数，使各输出之和恰好等于 `payable`（价值守恒）。
  const tail = contributors.slice(1).map((c) => Math.floor((c.amount / total) * payable));
  const first = payable - tail.reduce((s, v) => s + v, 0);
  return contributors.map((c, i) => buildSettlement(b, c.pub, i === 0 ? first : tail[i - 1]!));
}

/** 构建 timeout-default 退款交易（低的、非最终的 sequence）。 */
export function buildTimeoutRefund(
  b: BranchBinding,
  funding: FundingRef,
  contributors: readonly Contributor[],
  opts: { fee?: number; sequence?: number; nLockTime?: number } = {},
): Tx {
  const fee = opts.fee ?? 0;
  const sequence = opts.sequence ?? 1; // 可替换：具有更高 seq 的 cooperative 花费会取代它
  return {
    version: 1,
    inputs: [{ prevTxid: funding.txid, vout: funding.vout, sequence }],
    outputs: refundOutputs(b, contributors, fee),
    nLockTime: opts.nLockTime ?? 0,
  };
}

/**
 * 预签名回退图：每位出资人都对基于 funding（N-of-N CHECKMULTISIG）sighash 的 timeout-default
 * 退款进行签名，从而得到一笔完全组装好的花费，一旦牌桌停滞即可广播。
 * 签名按出资人顺序排列（即 CHECKMULTISIG 验证的顺序）。
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
