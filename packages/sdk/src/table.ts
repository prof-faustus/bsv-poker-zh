/**
 * 牌桌对局 —— Phase 1 集成，将熵承诺/揭示 + 分布式
 * 洗牌 + 加密发牌 + 下注 FSM + 摊牌 + 结算串联成一手牌，并附带
 * 一份记录与确定性重放（core §17 Phase 1；REQ-DATA-002/003）。
 *
 * 此过程在进程内运行（一个客户端模拟 N 方）—— 确定性核心集成。
 * 经由中继的多客户端以及真实的 bonded-subsat-channel 节点属于 app/adapter 层。
 */

import {
  type Action,
  type Card,
  type GameState,
  type Ruleset,
  bytesToHex,
  sha256,
  ByteWriter,
} from '@bsv-poker/protocol-types';
import {
  makeRealCT,
  canonicalPartyOrder,
  shuffledDeck,
} from '@bsv-poker/crypto-mentalpoker';
import { type Custody } from '@bsv-poker/wallet-custody';
import { type CTContract, type BSContract, makeFakeBS } from '@bsv-poker/adapters';
import {
  type Tx,
  buildFunding,
  buildSettlement,
  sighashPreimage,
} from '@bsv-poker/tx-builder';
import {
  evaluate,
  fundingUnlocking,
  type Script,
} from '@bsv-poker/script-templates-ts';
import { getGame } from './registry.ts';
import { hashRuleset } from './ruleset.ts';

export interface Player {
  readonly seat: number;
  readonly stack: number;
  readonly custody: Custody;
  /** 本方为洗牌记录的熵 r_p（core §4.1）。 */
  readonly entropy: Uint8Array;
}

export interface EntropyRecord {
  readonly pub: string; // 身份 pubkey（hex，压缩格式）
  readonly seat: number;
  readonly commitment: string; // c_p = H(r_p)
  readonly reveal: string; // r_p hex（揭示材料；REQ-DATA-002）
}

export interface HandTranscript {
  readonly ruleset: Ruleset;
  readonly gid: string;
  readonly rulesetHash: string;
  readonly buttonSeat: number;
  readonly seats: ReadonlyArray<{ seat: number; stack: number }>;
  readonly partyOrder: readonly string[]; // 规范化的身份 pubkey
  readonly entropy: readonly EntropyRecord[]; // 按规范化方序排列
  readonly actions: readonly Action[];
}

export interface HandResult {
  readonly state: GameState;
  readonly transcript: HandTranscript;
  /** 通过真实解释器验证的结算花费（收尾，core §6.6）。 */
  readonly settlementVerified: boolean;
}

const IDENTITY_ROLE = 'identity';

function gidFor(pubs: readonly string[]): string {
  const w = new ByteWriter();
  for (const p of pubs) w.hex(p);
  return bytesToHex(sha256(w.toBytes())).slice(0, 16);
}

export interface Sdk {
  readonly ct: CTContract;
  readonly bs: BSContract;
  runHand(players: readonly Player[], ruleset: Ruleset, actions: readonly Action[]): HandResult;
  deriveState(transcript: HandTranscript): GameState;
}

export function createSdk(deps?: { ct?: CTContract; bs?: BSContract }): Sdk {
  const ct = deps?.ct ?? makeRealCT();
  const bs = deps?.bs ?? makeFakeBS();

  function setupShuffle(
    players: readonly Player[],
    gid: string,
  ): { order: string[]; entropy: EntropyRecord[]; deck: Card[] } {
    // 每一方的身份 pubkey + 熵承诺/揭示（core §4.1）。
    const records = players.map((p) => {
      const pub = p.custody.derive(gid, 0, IDENTITY_ROLE);
      // 先承诺后揭示（进程内同步执行；真实流程会先关闭所有承诺）
      const commitment = bytesToHex(sha256(p.entropy));
      return { pub, seat: p.seat, commitment, reveal: bytesToHex(p.entropy), entropy: p.entropy };
    });
    // 规范化方序 = 按身份 pubkey 字典序排列（REQ-CRYPTO-003）。
    const order = canonicalPartyOrder(records.map((r) => r.pub));
    const ordered = order.map((pub) => records.find((r) => r.pub === pub)!);
    const deck = shuffledDeck(ordered.map((r) => r.entropy), 52);
    const entropy: EntropyRecord[] = ordered.map((r) => ({
      pub: r.pub,
      seat: r.seat,
      commitment: r.commitment,
      reveal: r.reveal,
    }));
    return { order, entropy, deck };
  }

  function runHand(
    players: readonly Player[],
    ruleset: Ruleset,
    actions: readonly Action[],
  ): HandResult {
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const identityPubs = ordered.map((p) => p.custody.derive('pre', 0, IDENTITY_ROLE));
    const gid = gidFor(identityPubs);
    const rh = hashRuleset(ruleset);
    const { order, entropy, deck } = setupShuffle(ordered, gid);

    // 注资：对买入额做 N-of-N 多签，绑定到 gid + rulesetHash（core §6.6）。
    const potSats = ordered.reduce((s, p) => s + Math.min(p.stack, ruleset.maxBuyIn), 0);
    const fundingPubs = order.map((pub) => Uint8Array.from(Buffer.from(pub, 'hex')));
    const fundingBind = {
      gid,
      rulesetHash: rh,
      round: 0,
      stateHash: '00'.repeat(32),
      actingSeat: -1,
      successorCommitment: '00'.repeat(32),
    };
    const fundingOut = buildFunding(fundingBind, fundingPubs, potSats);
    void bs.nodeBroadcast('funding:' + gid); // 规范路径（进程内 fake）

    // 通过引擎打完这手牌。
    const module = getGame(ruleset.variant)({ deck });
    let state = module.init(ruleset, ordered.map((p) => ({ seat: p.seat, stack: p.stack })));
    for (const a of actions) state = module.apply(state, a);

    const transcript: HandTranscript = {
      ruleset,
      gid,
      rulesetHash: rh,
      buttonSeat: state.buttonSeat,
      seats: ordered.map((p) => ({ seat: p.seat, stack: p.stack })),
      partyOrder: order,
      entropy,
      actions: [...actions],
    };

    // 结算：花费注资多签（协作式收尾，core §6.6）。构造一笔
    // 结算交易，对其做 sighash，并通过真实解释器验证 N-of-N 花费。
    const settlementVerified = verifySettlement(ordered, fundingOut.locking, potSats, gid, rh);

    return { state, transcript, settlementVerified };
  }

  function verifySettlement(
    ordered: readonly Player[],
    fundingLocking: Script,
    potSats: number,
    gid: string,
    rh: string,
  ): boolean {
    const winnerPub = ordered[0]!.custody.derive(gid, 0, IDENTITY_ROLE);
    const settleBind = {
      gid,
      rulesetHash: rh,
      round: 99,
      stateHash: 'aa'.repeat(32),
      actingSeat: ordered[0]!.seat,
      successorCommitment: 'bb'.repeat(32),
    };
    const settleOut = buildSettlement(
      settleBind,
      Uint8Array.from(Buffer.from(winnerPub, 'hex')),
      potSats,
    );
    const tx: Tx = {
      version: 1,
      inputs: [{ prevTxid: gid.padEnd(64, '0'), vout: 0, sequence: 0xffffffff }],
      outputs: [settleOut],
      nLockTime: 0,
    };
    const preimage = sighashPreimage(tx, 0);
    // 每一方都签署协作式收尾（N-of-N 注资多签）。
    const sigs = ordered.map((p) =>
      p.custody.sign(gid, 0, IDENTITY_ROLE, {
        sighashPreimage: preimage,
        describe: { action: 'settle', amounts: `${potSats}`, potOrState: 'pot close-out' },
      }),
    );
    return evaluate(fundingUnlocking(sigs), fundingLocking, { sighashPreimage: preimage }).ok;
  }

  /** 从一份记录重建最终状态（确定性重放；REQ-DATA-003）。 */
  function deriveState(transcript: HandTranscript): GameState {
    const entropies = transcript.entropy.map((e) => Uint8Array.from(Buffer.from(e.reveal, 'hex')));
    const deck = shuffledDeck(entropies, 52);
    const module = getGame(transcript.ruleset.variant)({ deck });
    let state = module.init(transcript.ruleset, [...transcript.seats]);
    for (const a of transcript.actions) state = module.apply(state, a);
    return state;
  }

  return { ct, bs, runHand, deriveState };
}
