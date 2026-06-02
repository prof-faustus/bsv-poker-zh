# HANDOVER — BSV Poker 平台规范（在新的对话中继续）

## 0. 这是什么
一个建立在 **Bitcoin SV** 之上的**全新**无荷官多人**扑克**平台，已规范化以便
在 Claude Code 中构建。你（助手）**只编写规范——不构建任何东西**。实际的
应用稍后在 Claude Code 中构建，那里**已经拥有依赖仓库**（接受这一点；
不要重新验证，不要质疑）。

## 1. 文件（除非另有说明，均位于 /mnt/user-data/outputs）
- `bsv-poker-spec.md` — 主规范。**约 1,700 行，约 19k 词，115 条需求，17 个威胁。** 这是活跃文档；就地扩展它。
- `bsv-poker-spec-redteam-01.md` — 正式红队评审（B1/B2 阻断项 + 6 个 MAJOR + minors），均已应用于规范（§20 变更日志）。
- 生成 §19.D 向量的参考评估器：`/home/claude/eval.py`（重新运行即可重新生成；它是手牌评估 oracle）。**注意：容器文件系统会在各会话之间重置——规范中已嵌入已验证的输出，因此若你想扩展向量，可能需要重新创建 eval.py。**

## 2. 硬性规则——切勿违反（用户的评审框架）
- **仅限 BSV。** post-Genesis BSV。无 BTC 代码，无 BTC 假设。BTC = 自动判负。
- **OP_RETURN 禁用。** 绝对的。任何 OP_RETURN = 自动拒绝（见 §3，第 1 号修复项）。
- **零捏造。** 每个数字都可追溯到一个来源或一个声明的 `TRACKED ASSUMPTION`。通过运行代码生成数值（如 §19.D 所做），绝不凭记忆写出。
- **无假设 / 无隐藏假设。** 声明每一项设计选择；未确定处标注 `DECISION REQUIRED`。隐藏假设是最严重的缺陷类别。
- **不过度声称。** 只陈述该构造所保证的内容；枚举信任面。
- **致歉禁止。** 直接、简洁。坦然承认错误、修复它、继续前进。
- **工程标准：** NPR 7150.2 + 一份*有文档记录的 Power-of-Ten 适配*（非字面合规——规则 3/指针在 GC 中不适用）、需求可追溯性矩阵、通过**真实 Script 解释器**的测试（负向测试在其*内部*失败；无签名抽查）、可复现的已提交向量。
- **不灌水。** 一份密实的 1 万行规范胜过灌水的 5 万行。目标是 1 万至 5 万行*真实*内容，分多轮达成。

## 3. ⚠️ 下一会话的第 1 号修复项（BLOCKER）—— OP_RETURN 禁令违规
规范当前**允许 OP_RETURN** 用于死路一条的阶段承诺。这**违反了
项目对 OP_RETURN 的绝对禁令。** 需修复的位置：
- §0.6 词汇表中的"post-Genesis"行；§4.4 **REQ-CRYPTO-004**；§6.5 **REQ-TX-009**；任何其他"OP_RETURN"命中项（`grep -n OP_RETURN bsv-poker-spec.md`）。
**所需修复：** 将每处 OP_RETURN 替换为 **pushdata-in-script** 构造
（`OP_PUSHDATA <data> OP_DROP` 承载于活跃、可花费的脚本中——这与
verifiable-accounting 所用的选择相同，也是 GB2616862 自身列出的替代方案）。更新
§6.5，使规则变为"**绝不 OP_RETURN；所有承诺均为 pushdata-in-script**"，
删除 REQ-TX-009 对 OP_RETURN 的许可，并重新扫描。增设一条原则（例如 P11）"OP_RETURN
禁用"，使其无法卷土重来。这是一个正确性阻断项，而非风格说明。

## 4. 需保留的已验证技术事实（不要错误地重新推导）
- **CLTV/CSV（`OP_CHECKLOCKTIMEVERIFY`/`OP_CHECKSEQUENCEVERIFY`）在 post-Genesis BSV 上为 NO-OPS。** 所有计时均在**交易层级**（在原始替换规则下使用 nLockTime + nSequence）。绝不在脚本内。（§6.2，REQ-TX-001/002。）
- **GB2616862A**（"Set shuffling"，Burns & Wright；申请人 nChain Licensing AG；引作 **A** 而非 B——授权未确认）是洗牌/结算原语：洗牌密钥 `P'=(s,±√(s³+7))`，私钥 = x 坐标，公钥 `P=s·G`；每张牌的组合密钥 `Q_j=Σ P` 通过点加法得出；两轮加密（先共享标量，再每元素各异标量）+ 重排 = 洗牌，揭示时用逆标量逆转；结算通过 2-of-2 出资多签 + nLockTime 退款 + 分级下注交易 + 公平博弈脚本 + 可选的 2-of-3 TTP。所给示例为 2 方/3 张牌最高牌获胜——但**扑克是发牌到各位置**（规范的 `minted→drawn→revealed|folded→discarded` 生命周期；§4.3），且组合密钥花费是**收尾，而非发牌**。
- **签名模式（D9，§4.3）：** Mode A（专利字面，揭示时重构 `w_j`；单局密钥；有界手牌窗口；**Phase-1 默认**） vs Mode B（门限/无重构；升级项）。绝不在交付 Mode A 的同时声称 Mode B 的"无完整密钥"属性。
- **依赖栈（接受为已存在，Claude Code 拥有它们）：** `cardtable`（心智扑克底层；In-Between 部分完成；协议已完整规范化，可离线/仿真运行——**不**包含那五种扑克变体，那是一个 Grok 文档的过度声称）、`bonded-subsat-channel`（亚聪微支付 + 一个**自包含的嵌入式 BSV 节点**，复用为本地 regtest 后端）、`verifiable-accounting` ×3（Merkle 锚定的选择性披露审计；pushdata 而非 OP_RETURN）、`overlay-broadcast`（密钥图广播加密，撤销 = 未花费的会过期输出，FROST/GG20 门限托管）。`revocable-nft-tee` / `triple-entry-bsv-sql` 出现在 Grok 文档中，但**不**在作者已发布的清单中——将 NFT/撤销视为构建于 `overlay-broadcast` 之上，属于后续轨道。
- TEE 为**可选**（托管后端可插拔；没有任何阶段需要它）。

## 5. 当前状态（已完成）
- Part 1：完整架构、原则（P1–P10）、依赖契约 + 一致性、心智扑克协议、扑克领域模型（手牌评估，含 Omaha-2+3 与 ace-to-five 低牌、下注、边池、奇数筹码确定性）、BSV 交易/脚本模型、NASA 级标准、测试策略、SDK、VM/打包、Windows+Web 外壳、分阶段路线图（Phase 1 = regtest 上带发现的单挑 NL Hold'em）。
- 红队 01 已应用：B1（w_j 重构不一致 → 签名模式）、B2（发牌 vs 选牌 → 生命周期）、M1–M5、m1、m3 均已就地修复。
- 第 02 轮：**§7.3** 全部五种变体 FSM（Hold'em、Omaha、Stud、Draw、Razz）+ REQ-FSM-003…011；**§19.B** 边池算法，附经守恒校验的示例；**§19.D** 已验证的手牌评估向量（由 eval.py 生成；所有一致性检查通过）；**§19.E** Hold'em 转移表；**§19.F** 115 行需求登记册。

## 6. 待定决策
- D1 首个游戏 = 单挑 NL Hold'em（默认）。D2 座位 2–9。D3 先做 NL。D4 发现 = relay + LAN（Phase 1），互联网 P2P（Phase 5）。D5 "VM" = 自包含的容器/VM 镜像，捆绑 node+relay+客户端。D6 复用 bonded-subsat-channel 节点。D7 Blackjack 延后。D8 游戏币/regtest。D9 签名默认 Mode A。
- **读取 cardtable 的 API 后所需的决策（不阻断 Phase 0/1）：** 确切的揭示令牌构造（§4.6）和 Mode-B 签名构造（§6.7）。在修定这些之前先读 cardtable。

## 7. 尚余工作（已排序）——从这里继续
1. **OP_RETURN 禁令修复（上文 §3）——首先做。**
2. **§19.C** — 重构 GB2616862 公平博弈脚本结构，并在 52 张牌 × N 下**测量**其字节大小（用一个真实数字而非"它能扩展"来了结 M3 扩展风险，REQ-CRYPTO-009）；添加**每手牌交易计数 + 字节成本封套**（了结 m2）。若单脚本不切实际，则提供每张牌/每批次的回退方案。
3. **§19.A** — 字节精确的规范序列化（牌、规则集、动作、状态、交易）。一切都绑定于此；确定性（P2）依赖它。
4. **§19.D 边界情形** — 平局/奇数筹码分配、同时 all-in 级别、边池中已弃牌但有出资的玩家、Omaha-8 合格低牌边界（经 eval.py 重新生成）。
5. 完整的**多路（3–9 座）**转移表（推广 §19.E 与 stud/razz 表）。
6. 了结 **m4**（阶段承诺的承载——OP_RETURN 移除后即无意义；确认 pushdata + 花费链接）和 **m5**（对照 §18.6 对全部"trustless/non-custodial"措辞进行清理扫描）。
7. 读取 cardtable 后：修定两处 DECISION REQUIRED 构造；然后针对已修定的密码学核心运行**红队评审 02**。

## 8. 如何继续（流程）
- 每一轮：先添加真实内容，然后**对你自己的新增内容做红队评审**（评定严重度：BLOCKER/MAJOR/MINOR + 所需修复 + 结论），就地修复，记入 §20.x。
- 任何数字/向量都通过**运行代码**生成，嵌入已验证的输出。
- 保持需求登记册和可追溯性完整（每个 REQ-* 得到一行；否则 CI 失败）。
- **诚实**地用真实指标（行数/词数/REQ 计数）汇报进度；绝不声称你并不具备的完整性。
- 保持仅限 BSV；无 OP_RETURN；不致歉；简洁。

**新对话中的第一项行动：** 打开 `bsv-poker-spec.md`，做 §7 第 1 步（清除 OP_RETURN），然后做 §19.C 测量。
