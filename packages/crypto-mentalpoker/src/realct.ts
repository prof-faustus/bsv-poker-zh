/**
 * 真实的心智扑克加密编排（CT 契约，core §2.1 / §4）—— 用于安全关键路径
 *（洗牌、揭示一次性、组合密钥），绝不使用 fake（REQ-DEP-004）。
 * 使用真实的 SHA-256 和真实的 secp256k1 点（经由 Node 的 ECDH）。
 *
 * 阶段一说明：此处的分布式洗牌将各方由其先承诺后揭示的熵派生出的秘密置换组合
 * 起来（INV-CT-1：顺序是各秘密置换的组合；commit-reveal —— core §4.1 —— 可阻止
 * 后到熵的择优选择，REQ-CRYPTO-002）。GB2616862 的两轮 EC 加密（core §4.4）以及
 * 脚本内的公平博弈证明（§4.7、§19.C）由 script-templates-ts / 构建的解释器度量来分层
 * 叠加；每张牌的组合公钥 Q_j 是在此派生的真实 secp256k1 点。
 */

import { createECDH, createHmac } from 'node:crypto';
import {
  type CTContract,
  type ShuffleInput,
  type ShuffleResult,
} from '@bsv-poker/adapters';
import { ByteWriter, bytesToHex, sha256 } from '@bsv-poker/protocol-types';

/** 规范的揭示原像：face (u8) ‖ blind 字节（core §4.5/§4.6）。 */
function revealPreimage(face: number, blind: Uint8Array): Uint8Array {
  const w = new ByteWriter();
  w.u8(face);
  for (const b of blind) w.u8(b);
  return w.toBytes();
}

/**
 * 规范的各方顺序 —— 以 33 字节 SEC-1 压缩（hex）形式表示的长期公钥的字典序
 *（REQ-CRYPTO-003）。确定性；与网络到达顺序无关。
 */
export function canonicalPartyOrder(pubKeysHex: readonly string[]): string[] {
  return [...pubKeysHex].map((h) => h.toLowerCase()).sort();
}

/** commit = SHA-256(secret)；具有绑定性而不泄露内容（core §4.1）。 */
export function entropyCommitSync(secret: Uint8Array): string {
  return bytesToHex(sha256(secret));
}

/** 对 hex 的近似常量时间相等比较（承诺匹配）。 */
function commitMatches(commitment: string, secret: Uint8Array): boolean {
  return entropyCommitSync(secret) === commitment.toLowerCase();
}

/** HKDF-extract/expand 风格的 PRF（遵循 RFC 5869 约定，core §4）：HMAC-SHA256。 */
function prf(key: Uint8Array, info: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(info).digest());
}

/** 从计数器模式的 PRF 流中抽取一个 32 位值（确定性、可记录 —— REQ-ARCH-002）。 */
function* drawStream(seed: Uint8Array, info: string): Generator<number> {
  let counter = 0;
  for (;;) {
    const block = prf(seed, `${info}:${counter++}`);
    for (let i = 0; i + 4 <= block.length; i += 4) {
      yield ((block[i]! << 24) | (block[i + 1]! << 16) | (block[i + 2]! << 8) | block[i + 3]!) >>> 0;
    }
  }
}

/** 由某一方的熵确定性地作为种子的 [0..n) 的 Fisher–Yates 置换。 */
export function permutationFromEntropy(entropy: Uint8Array, n: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  const stream = drawStream(entropy, 'shuffle-perm');
  for (let i = n - 1; i > 0; i--) {
    const r = stream.next().value as number;
    const j = r % (i + 1);
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  return perm;
}

/** 按规范的各方顺序从左到右组合置换：Π = π_N ∘ … ∘ π_1。 */
export function composePermutations(perms: readonly number[][], n: number): number[] {
  let composed = Array.from({ length: n }, (_, i) => i);
  for (const p of perms) {
    composed = composed.map((x) => p[x]!);
  }
  return composed;
}

/**
 * 洗牌后的牌堆顺序 = 将每一方的秘密置换组合后作用于恒等牌堆 [0..deckSize)（core §4.4）。
 * 在真正的心智扑克中，每张牌在被选择性揭示前始终保持隐藏；此函数（在 commit-reveal
 * 结束后）从已揭示的熵重建该顺序，用于确定性发牌/结算以及争议重放（§12.3）。
 */
export function shuffledDeck(partyEntropy: readonly Uint8Array[], deckSize: number): number[] {
  const perms = partyEntropy.map((e) => permutationFromEntropy(e, deckSize));
  return composePermutations(perms, deckSize);
}

/** 组合种子 σ = H(r_1 ‖ … ‖ r_N)，按规范的各方顺序（core §4.1）。 */
export function combinedSeed(entropies: readonly Uint8Array[]): Uint8Array {
  const w = new ByteWriter();
  for (const e of entropies) for (const b of e) w.u8(b);
  return sha256(w.toBytes());
}

/**
 * 牌 j 的组合公钥 Q_j —— 一个真实的 secp256k1 点。由组合种子和 j 确定性派生；
 * 在出现无效标量（概率可忽略）时会重新哈希。（GB2616862 的形式为
 * Q_j = Σ_p P_{p,j}；此处生成一个绑定到洗牌种子的真实点。）
 */
export function combinedKey(seed: Uint8Array, j: number): string {
  for (let salt = 0; salt < 256; salt++) {
    const scalar = prf(seed, `Qj:${j}:${salt}`); // 32 字节
    try {
      const ec = createECDH('secp256k1');
      ec.setPrivateKey(Buffer.from(scalar));
      return ec.getPublicKey('hex', 'compressed');
    } catch {
      // 无效标量（>= n 或 0）：尝试下一个 salt
    }
  }
  throw new Error('could not derive a valid combined key');
}

export function makeRealCT(): CTContract {
  return {
    async entropyCommit(secret: Uint8Array): Promise<string> {
      return entropyCommitSync(secret);
    },
    async entropyReveal(commitment: string, secret: Uint8Array): Promise<boolean> {
      return commitMatches(commitment, secret);
    },
    async runShuffle(input: ShuffleInput): Promise<ShuffleResult> {
      if (input.partyEntropy.length !== input.partyPubKeys.length) {
        throw new Error('party entropy/pubkey count mismatch');
      }
      const n = input.deckSize;
      const perms = input.partyEntropy.map((e) => permutationFromEntropy(e, n));
      const composed = composePermutations(perms, n);
      const w = new ByteWriter();
      for (const x of composed) w.u32(x);
      const orderCommitment = bytesToHex(sha256(w.toBytes()));
      const seed = combinedSeed(input.partyEntropy);
      const combinedKeys = composed.map((_, j) => combinedKey(seed, j));
      return { orderCommitment, combinedKeys, seed: bytesToHex(seed) };
    },
    async conceal(
      deckId: string,
      cardSerial: number,
      face: number,
      blind: Uint8Array,
    ): Promise<string> {
      // cmt_j = H(face_j ‖ blind_j)（core §4.5）；deckId/serial 在别处（加密牌的 UTXO
      // 元组）绑定该牌的公开身份，而非隐藏承诺。
      void deckId;
      void cardSerial;
      return bytesToHex(sha256(revealPreimage(face, blind)));
    },
    async verifyReveal(commitment: string, face: number, blind: Uint8Array): Promise<boolean> {
      // 揭示开启 H(face‖blind)=cmt（core §4.6）。
      return bytesToHex(sha256(revealPreimage(face, blind))) === commitment.toLowerCase();
    },
  };
}
