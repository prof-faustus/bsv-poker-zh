# 红队评审 02 ——*实现*（`bsv-poker`）

**范围。** 红队评审 01（`spec/bsv-poker-spec-redteam-01.md`）审计了*规范*。本轮审计 `master` 上的**已构建系统**：实现是否真正闭合了 RT-01 的发现，运行中的代码又引入了哪些新风险？下文每一条主张都引用了满足它的源码 + 一个**通过的测试**（经由 `node tools/ci.ts` 运行：151 个 TS + 16 个 Go）或一个主机本地的端到端测试。

**方法。** 对抗性行为在 `packages/sdk/test/adversarial.test.ts` 以及链上/依赖端到端测试（`tools/onchain-*-e2e.ts`、`tools/va-bind-e2e.ts`、`tools/ob-bind-e2e.ts`）中被实施。否定性用例必须在**真实的 Script 解释器内部**失败，而非在某个包装层中。

---

## RT-01 发现的处置

### B1 ——"组合私钥从不在单一位置被重构" vs GB2616862 机制
**状态：已缓解（模式 A）；模式 B 密钥建立为真实，在线签名尚未完成。**
- 模式 A（`reconstruct-at-reveal`）确实会瞬态地重构每手牌的标量：`packages/wallet-custody/src/custody.ts` 的 `reconstructAndSign`——由 `packages/wallet-custody/test/custody.test.ts`（"Mode A reconstructAndSign sums scalars and produces a valid signature"）覆盖。该构建对此**诚实以告**：软件托管**拒绝** `combineSignShare`，因此它无法虚假地声称具备模式 B（同一测试文件）。
- 模式 B 的缓解措施（任何一方都从不持有完整密钥）现在有了一个**真实的**密钥来源：`overlay-broadcast` 门限托管生成 t-of-n 群密钥（`packages/adapters/src/real-ob.ts`、`tools/ob-bind-e2e.ts`——2/3、3/5、6/9 曲线上群密钥；无完整密钥重构）。
- **残余风险：** 在群密钥下发出单一签名的*在线* t-of-n 签名协议尚未接入（OB 未通过其 CLI 暴露签名功能）。在此之前，必须避免任何重构的结算依赖于 **N-of-N CHECKMULTISIG** 资金路径（每个玩家用自己的密钥签名，从不共享）——已在 `tools/onchain-poker-e2e.ts` 中链上证明。这对底池而言是一种安全等价的、避免重构的方式，但不是单签名的模式 B。

### B2 ——"选择 = 花费 UTXO" vs 向座位发牌
**状态：已解决。** 发牌是一个显式的 位置→牌 映射，而非"花费 = 发牌"：`packages/app-services/src/mp-shuffle.ts`（`deckFromEntropies` 组合每个玩家的秘密置换）馈入游戏模块中按变体的位置发牌；`packages/sdk/test/table.test.ts`（"runHand wires entropy/shuffle/deal/betting/settlement into one hand"）实施了完整映射，且揭示时的换牌**在解释器内部失败**（`packages/sdk/test/adversarial.test.ts`，"card-substitution at reveal fails INSIDE the interpreter"）。

### M1 —— 确认前确定性被夸大
**状态：已解决，且诚实。** 确认后确定性：转录回放至**逐字节相同**的状态（`table.test.ts` "deriveState replays the transcript to byte-identical state"）。确认前的非确定性由 **nSequence 原始替换规则**处理，并已链上演示（`tools/onchain-recovery-e2e.ts`：一个更高序列号的协作式花费取代已广播的超时默认值）。未做出任何关于确认前终局性的主张。

### M2 —— 公共牌揭示是带活性失效模式的 N-of-N 协作操作
**状态：已解决。** 活性由**预签名回退图**（`packages/tx-builder/src/fallback.ts`、`presignFallbackGraph`）+ 决策/恢复超时层来保证；`packages/tx-builder/test/fallback.test.ts` 验证预签名退款在解释器内部通过验证且价值守恒，`adversarial.test.ts`（"timeout-default applied keeps the hand progressing (no freeze, P4)"）确认无冻结。该双出口机制在链上是真实的（M1 证据）。

### M3 —— 公平博弈扩展至 52 张牌为假设，未经度量
**状态：已缓解。** 脚本内的 EC 公平博弈证明已实现并**逐字节度量**（`packages/script-templates-ts/src/templates.ts` 的 `fairPlayEcLocking`，连同 `packages/script-templates-ts/test/templates.test.ts` 中的线格式字节向量；约 231 B/牌）。热路径成本现已度量（`tools/perf-suite.ts`）。**残余：** 完整 52 张牌牌组端到端的公平博弈时延/成本剖面尚未作为单一向量发布。

### M4 —— 伪造件可能掩盖协议安全缺陷；将伪造件绑定至真实实现
**状态：基本已解决。** 安全关键行为现在针对**真实**实现运行：真实 CT 加密（`packages/crypto-mentalpoker`）、真实 BSV 节点（`@bsv-poker/adapters/real-node`、`tools/onchain-*-e2e.ts`）、真实 VA Merkle（`@bsv-poker/adapters/real-va`、`tools/va-bind-e2e.ts`）、真实 OB 门限托管（`@bsv-poker/adapters/real-ob`、`tools/ob-bind-e2e.ts`）。*单一*一致性套件现在针对伪造件**和真实 VA 适配器**运行结果一致（`tools/conformance-real-e2e.ts` 运行 `runVAConformance(realVAContract())`——同一套件，真实的 `@vaa/merkle`）。**残余（REQ-DEP-003）：** OB 的合约方法（`isRevoked(height)`、对所提供秘密的 `thresholdSplit`）未由其 CLI 暴露，因此 OB 的一致性对真实尚未接入；CT（`cardtable`）在磁盘上缺失。

### M5 —— 在带 GC 的运行时中无法实现 Power-of-Ten 字面合规
**状态：已解决，且诚实。** `docs/adr/0003-*` 记录了非字面的适配；其中**可度量**的部分（热路径中有界的工作内存）现已被实际度量：`tools/perf-suite.ts` 在 `--expose-gc` 下运行 20 万次热路径求值并断言约 0 保留堆（REQ-APP-092）。未做出任何关于字面 NPR-7150.2 合规的虚假主张。

### M6 —— 揭示令牌 + 签名两者均为 `DECISION REQUIRED`（两个缺口）
**状态：一个已闭合，一个部分完成。** 揭示：承诺-揭示绑定其值（`adversarial.test.ts` "withheld/incorrect entropy reveal is detected by the commitment"）。签名：模式 A 已实现并测试；模式 B 在线签名是剩余的缺口（见 B1 残余）。

### m1–m5（次要）
- **m1（每手牌的参与者集合）：** 已解决——大厅 + 等候室定义该集合（`packages/ui-core/src/view-models/network-lobby.ts`，`table-room-vm.test.ts` 中的座位范围测试）。
- **m2（链上成本模型）：** 部分完成——每笔交易的线格式字节可度量（`packages/tx-builder/src/wire.ts` 中的真实序列化）；已发布的手续费/成本模型尚未完成。
- **m3（奇数筹码规则）：** 在引擎底池逻辑中已解决（`packages/engine/src/pots.ts`、`pots.test.ts`）。
- **m4（OP_RETURN vs pushdata / 洗牌阶段承诺）：** 已解决——OP_RETURN 在活动脚本中被禁止并被解释器拒绝；`tools/lint-opreturn.ts` 强制执行此规则（REQ-TX-010）。终结性的洗牌阶段承诺仍可使用它（REQ-TX-009）。
- **m5（术语表"trustless"卫生）：** 仅文档层面；已反映于 `docs/user-guide.md`。

---

## 新发现（来自审计运行中的系统）

### F1 —— 模式 B 在线门限签名。**已闭合。**
模式 B 现在针对真实的 overlay-broadcast GG20 引擎端到端实现：`overlay-broadcast custody sign --threshold t --shares n` 运行受信任发牌方密钥生成 + 一次 t-of-n 门限签名，在群密钥下产出一个标准 DER ECDSA 签名，且群私钥**从不重构**（加性份额；`crates/custody/gg20`）。`tools/mode-b-e2e.ts` 证明一个 2-of-3 和 3-of-5 门限签名**在群密钥下被平台真实的 Script 解释器 `OP_CHECKSIG` 接受**（且被篡改的消息被拒绝）——即一个模式 B 结算输出可由法定人数花费，与单密钥花费完全一致，从而闭合 B1/M6 残余。（一个绑定 BIP-143 的完整链上提交连同持久化的群组是剩余的接入工作；密码学能力 + 共识接受已被证明。）

### F2 —— 一致性对真实仅部分完成（REQ-DEP-003）。**MAJOR → 降为 MINOR。**
相同的一致性套件现在针对**真实 VA** 适配器通过（`tools/conformance-real-e2e.ts`）。剩余：**OB**（其 CLI 不暴露合约的 `isRevoked(height)` / `thresholdSplit(secret)`——需要 OB 库/守护进程，而非 CLI）和 **CT**（`cardtable` 在磁盘上缺失）。*行动：* 绑定 OB 的库以提供 `thresholdSplit`/撤销，并在仓库存在时启用 CT 门禁。

### F3 —— mainnet 安全依赖 regtest 默认值，而非硬门禁。**MAJOR（mainnet 前）。**
节点默认 regtest 且该构建仅供研究，但不存在已签名二进制的信任链（安装包未签名），也没有显式的、经测试的、带确认门禁的 mainnet 启用标志（REQ-PROD-012 已为横幅追溯；*标志*路径需要一个测试）。*行动：* 对 MSI/NSIS 进行代码签名，在任何 mainnet 使用之前于显式确认背后加入一个经测试的 `--network=main` 门禁。

### F4 —— 替换规则的依赖假设了矿工策略。**MINOR。**
链上恢复（M1/M2）依赖于节点遵守原始 nSequence 替换规则。嵌入式节点遵守它；某个 mainnet 矿工的策略可能不同。*行动：* 记录该假设，并加入一条不依赖替换规则的预签名图回退（已部分由 F-graph 覆盖）。

---

## 结论
RT-01 的两个 BLOCKER 已**解决（B2）并以诚实的残余加以缓解（B1）**；各 MAJOR 已解决或在指明残余的情况下缓解。系统不会交付任何无法以通过的测试支撑的安全主张。**剩余的安全相关工作是 F1（模式 B 在线签名）、F2（VA/OB + CT 的一致性对真实）和 F3（mainnet 加固 + 代码签名）**——其中没有一项会阻碍 research/regtest 对局，但全部都是 mainnet 部署的门禁。
