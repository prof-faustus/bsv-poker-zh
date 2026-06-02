/**
 * 将真实的 `verifiable-accounting-chain` Merkle 实现绑定到扑克审计记录
 * （REQ-DEP-004，core §17）。无重新实现：真实的 `@vaa/bsv`（`hashLeaf`/`hashNode`，
 * 通过 @bsv/sdk 进行双重 SHA-256）和 `@vaa/merkle`（`buildTree`/`merkleProof`/`verifyProof`）
 * 对每条单手结算记录进行哈希、构建 Merkle 根，并证明/验证其包含性。VA
 * 库从其构建产物 dist 加载（其自身的 node_modules 解析 @bsv/sdk），与真实的
 * BSV 节点由进程绑定的方式完全相同——是真正的依赖，而非一致性的 fake。
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { VAContract } from './contracts.ts';

const VA_DIR = process.env.BSV_VA_DIR ?? 'D:\\claude\\verifiable-accounting-chain';

// 真实库的带品牌标记 Hash 及其 Result/VerifyResult 封装。
type Hash = unknown;
interface Ok<T> { readonly ok: true; readonly value: T }
interface VerifyOk { readonly ok: true }
type Result<T> = Ok<T> | { readonly ok: false };
type VerifyResult = VerifyOk | { readonly ok: false };

interface VaBsv {
  hashLeaf(data: Uint8Array): Hash;
  HashOps: { toDisplayHex(h: Hash): string; fromDisplayHex(hex: string): Result<Hash> };
}
interface VaMerkle {
  buildTree(leaves: Hash[]): Result<{ root: Hash }>;
  merkleProof(leaves: Hash[], index: number): Result<{ index: number; siblings: Hash[] }>;
  verifyProof(leaf: Hash, proof: { index: number; siblings: Hash[] }, root: Hash): VerifyResult;
  reconstructRoot(leaf: Hash, proof: { index: number; siblings: Hash[] }): Hash;
}

let cache: { bsv: VaBsv; merkle: VaMerkle } | null = null;
async function lib(): Promise<{ bsv: VaBsv; merkle: VaMerkle }> {
  if (cache) return cache;
  const bsv = (await import(pathToFileURL(join(VA_DIR, 'packages/bsv/dist/index.js')).href)) as unknown as VaBsv;
  const merkle = (await import(pathToFileURL(join(VA_DIR, 'packages/merkle/dist/index.js')).href)) as unknown as VaMerkle;
  cache = { bsv, merkle };
  return cache;
}

export interface VaInclusionProof {
  readonly leafHex: string;
  readonly index: number;
  readonly siblingsHex: string[];
  readonly rootHex: string;
}

/** 通过真实的 verifiable-accounting Merkle 库锚定的扑克审计记录。 */
export class RealVa {
  /** 使用真实的 VA 叶/节点哈希，对每手审计记录（原始字节）计算 Merkle 根。 */
  async anchor(records: Uint8Array[]): Promise<string> {
    const { bsv, merkle } = await lib();
    const leaves = records.map((r) => bsv.hashLeaf(r));
    const tree = merkle.buildTree(leaves);
    if (!tree.ok) throw new Error('VA buildTree failed');
    return bsv.HashOps.toDisplayHex(tree.value.root);
  }

  /** 针对锚定根，为记录 `index` 生成一个真实的包含性证明。 */
  async prove(records: Uint8Array[], index: number): Promise<VaInclusionProof> {
    const { bsv, merkle } = await lib();
    const leaves = records.map((r) => bsv.hashLeaf(r));
    const proof = merkle.merkleProof(leaves, index);
    const tree = merkle.buildTree(leaves);
    if (!proof.ok || !tree.ok) throw new Error('VA prove failed');
    return {
      leafHex: bsv.HashOps.toDisplayHex(leaves[index]!),
      index: proof.value.index,
      siblingsHex: proof.value.siblings.map((s) => bsv.HashOps.toDisplayHex(s)),
      rootHex: bsv.HashOps.toDisplayHex(tree.value.root),
    };
  }

  /** 通过真实的 VA 验证器，针对某个根验证一个包含性证明。 */
  async verify(p: VaInclusionProof): Promise<boolean> {
    const { bsv, merkle } = await lib();
    const dec = (h: string): Hash => {
      const r = bsv.HashOps.fromDisplayHex(h);
      if (!r.ok) throw new Error(`bad hash hex ${h}`);
      return r.value;
    };
    const leaf = dec(p.leafHex);
    const proof = { index: p.index, siblings: p.siblingsHex.map(dec) };
    return merkle.verifyProof(leaf, proof, dec(p.rootHex)).ok;
  }
}

/**
 * 将 RealVa 暴露为编排测试套件所测试的契约，使得同一个 `runVAConformance`
 * 同时对 fake 和这个真实适配器运行（REQ-DEP-003，RT-02 F2）。merkleVerify
 * 通过真实的 `@vaa/merkle` 验证器路由；path 的 `right` 标志编码了叶索引。
 */
export function realVAContract(): VAContract {
  const va = new RealVa();
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  return {
    boundary: 'verifiable-accounting: audit output is independently checkable, never truth-at-origin',
    async merkleProve(records, index) {
      const p = await va.prove(records.map(enc), index);
      // 在第 L 层，当且仅当索引的第 L 位为 0 时，该叶为左子节点 → 其兄弟节点在右侧。
      const path = p.siblingsHex.map((hashHex, level) => ({ hashHex, right: ((index >> level) & 1) === 0 }));
      return { root: p.rootHex, leaf: p.leafHex, path };
    },
    async merkleVerify(bundle) {
      let index = 0;
      bundle.path.forEach((step, level) => { if (!step.right) index |= 1 << level; });
      return va.verify({ leafHex: bundle.leaf, index, siblingsHex: bundle.path.map((s) => s.hashHex), rootHex: bundle.root });
    },
  };
}
