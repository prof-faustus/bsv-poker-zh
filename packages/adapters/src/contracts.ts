/**
 * 依赖适配器契约 CT / BS / VA / OB —— core §2、§15.8。平台核心仅依赖这些契约
 * （REQ-DEP-001）；某个仓库的具体 API 被吸收进它自己的适配器中（REQ-DEP-002）。每个契约都有一个
 * fake（./fakes.ts），并通过同一套一致性测试套件同时针对 fake 与真实适配器运行，从而与现实绑定
 * （REQ-DEP-003，./conformance.ts）。安全关键行为只针对真实实现测试，绝不针对 fake
 * （REQ-DEP-004）。
 */

// ---- CT：牌桌心智扑克底层（core §2.1） ----------------------
export interface CTContract {
  /** 为洗牌随机性进行承诺-揭示的熵（core §4.1）。 */
  entropyCommit(secret: Uint8Array): Promise<string>; // 承诺 hex
  entropyReveal(commitment: string, secret: Uint8Array): Promise<boolean>;
  /**
   * 在 N 方集合上的可验证分布式洗牌（core §4.2–§4.4）。返回公开的洗牌产物：每张牌的合并公钥，以及
   * 对组合后顺序的承诺。任何单一玩家都无法得知顺序（INV-CT-1）。
   */
  runShuffle(input: ShuffleInput): Promise<ShuffleResult>;
  /** 将一张牌隐藏为 (deck_id, card_serial, ciphertext_commitment)（core §4.5）。 */
  conceal(deckId: string, cardSerial: number, face: number, blind: Uint8Array): Promise<string>; // 承诺 hex
  /** 验证揭示开启 H(face‖blind)=cmt（core §4.6）。 */
  verifyReveal(commitment: string, face: number, blind: Uint8Array): Promise<boolean>;
}

export interface ShuffleInput {
  readonly deckId: string;
  /** 规范的玩家顺序：按字典序排列的 33 字节 SEC-1 压缩公钥（REQ-CRYPTO-003）。 */
  readonly partyPubKeys: readonly string[]; // hex，已按规范排序
  /** 每个玩家已揭示的熵 r_p（在承诺-揭示关闭之后）。 */
  readonly partyEntropy: readonly Uint8Array[];
  readonly deckSize: number;
}

export interface ShuffleResult {
  /** 对组合后置换的承诺（争议重放锚点，core §12.3）。 */
  readonly orderCommitment: string; // hex
  /** 每个牌索引对应的合并公钥（core §4.3 Q_j）。 */
  readonly combinedKeys: readonly string[]; // 每张牌的 hex
  /** 合并种子 σ = H(r_1‖…‖r_N)（core §4.1）。 */
  readonly seed: string; // hex
}

// ---- BS：bonded-subsat-channel + 内嵌节点（core §2.2） -----------------
export interface BSContract {
  /** 本地 regtest 节点的生命周期 / 查询（core §8.4、§10.2）。 */
  nodeBroadcast(rawTxHex: string): Promise<{ txid: string; status: BroadcastStatus }>;
  nodeOutpointStatus(txid: string, vout: number): Promise<'unspent' | 'spent' | 'unknown'>;
  /** 亚聪通道的生命周期（core §5.7）；早期受开关控制。 */
  channelOpen(params: ChannelParams): Promise<string>; // 通道 id
  channelTransfer(channelId: string, microAmount: number): Promise<void>;
  /** 整聪最大余额法对账 Q*（core §2.2）。确定性（P2）。 */
  reconcileQstar(microBalances: readonly number[], k: number): number[];
}

export type BroadcastStatus = 'accepted' | 'seen' | 'double-spend-attempted' | 'rejected';

export interface ChannelParams {
  readonly participants: readonly string[]; // 公钥 hex
  readonly granularityK: number;
  /** 每个参与者固定的 1 聪反作弊保证金（INV-BS-2）。 */
  readonly bondSats: 1;
}

// ---- VA：verifiable-accounting（core §2.3） ---------------------------------
export interface VAContract {
  /** 针对区块头 merkleroot 的 Merkle 包含证明（Layer A）。 */
  merkleProve(records: readonly string[], index: number): Promise<MerkleBundle>;
  merkleVerify(bundle: MerkleBundle): Promise<boolean>;
  /**
   * 声明的边界（INV-VA-2），必须在任何展示审计输出的地方明示：仅确立
   * 包含性/完整性/选择性披露/算术正确性 —— 绝不确立源头真实性
   * （truth-at-origin）。
   */
  readonly boundary: string;
}

export interface MerkleBundle {
  readonly root: string; // hex
  readonly leaf: string; // hex
  readonly path: readonly { hashHex: string; right: boolean }[];
}

// ---- OB：overlay-broadcast（core §2.4） -------------------------------------
export interface OBContract {
  /** 为密钥图谱成员进行的带认证密钥封装（绝不使用裸 XOR）（core §2.4）。 */
  wrap(keyHex: string, memberPubKey: string): Promise<string>;
  unwrap(wrappedHex: string, memberPrivKey: string): Promise<string>;
  /** 撤销 = 未花费的过期输出（INV-OB-2）：当且仅当在 `height` 处已撤销时为 true。 */
  isRevoked(sessionId: string, height: number): Promise<boolean>;
  /** 门限托管：拆分为多份；仅在达到门限时才能重构（core §2.4）。 */
  thresholdSplit(secretHex: string, t: number, n: number): Promise<string[]>;
}
