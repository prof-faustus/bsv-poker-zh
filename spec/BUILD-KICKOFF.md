# BUILD-KICKOFF — BSV Poker 平台（面向 Claude Code 的指令）

你是 **Claude Code**。请依据本仓库中的规范构建 BSV Poker 平台。这些规范**具有权威性**；
由你来实现它们。**你负责构建并运行
一切**——代码、测试、向量、真实的 Script 解释器、VM 镜像、
安装程序——并**提交**你的工作成果。规范的作者不运行任何东西；那是
你的工作。

## 权威输入——在编写任何代码之前请完整阅读
- `bsv-poker-spec.md` — 协议/密码学/交易核心：引擎、心智扑克 (mental-poker) 密码学、BSV
  交易/Script 模型、SDK (§15)、钱包/托管、网络/发现、
  自包含 VM (§10)、依赖契约 (§2)、需求登记册 (§19.F)。
- `bsv-poker-app-architecture.md` — 应用层：Windows 桌面端 + web 客户端，
  **多游戏**平台（Hold'em、Omaha、Stud、Draw、Razz，以及计划中的 Blackjack）、各屏幕、
  发现、NFT/微支付接缝、NFR、安全、错误/故障处理、可观测性、
  打包、**测试规范** (§A16)、文档标准 (§A15)、
  需求登记册 + 可追溯性 + 验收门槛 (§A18)，以及**作者与构建者
  分工** (§A19 — 每一项"运行"任务都归你）。
- `bsv-poker-spec-redteam-01.md` — 红队评审 01（已应用；切勿重新引入
  B1 的 `w_j` 重构不一致问题或 B2 的"发牌 vs 选牌"错误）。
- `HANDOVER.md`、`bsv-poker-spec-HANDOVER.md` — 背景与委托人的规则。
- `handeval_oracle.py` — 手牌评估 oracle；你需**运行**它以生成 §19.D
  向量。

凡规范标注 `DECISION REQUIRED` 处，遵循其陈述的默认值并记录一份 ADR。
不要自行发明协议。若你发现规范确有歧义，记录下来并选择规范的
默认值——不要停下来询问。

## 不可商量的规则——违反即为构建缺陷，而非风格选择
1. **仅限 BSV，post-Genesis。** 无 BTC 代码，无 BTC 假设。
   `OP_CHECKLOCKTIMEVERIFY`/`OP_CHECKSEQUENCEVERIFY` 为 **NO-OPS**——所有计时一律在
   **交易层级**强制执行（在原始替换规则下使用 `nLockTime` + `nSequence`），
   绝不在脚本内执行。
2. **OP_RETURN 处处禁用。** 每个承诺/锚点都是位于**活跃**脚本中的 push-data
   （`<data> OP_DROP` 前缀，或解锁脚本中的一次 push）。任何 `OP_RETURN` 输出
   即遭拒绝。增设一项 CI/lint 检查：若 `OP_RETURN` 操作码 (0x6a) 出现在
   任何锁定或解锁脚本中，则构建失败。
3. **零捏造。** 每个数字、向量和字节大小都**由运行代码生成**
   并作为可复现向量提交——绝不凭记忆写出。`reproduce` 命令
   会重新生成它们全部，并在任何不匹配时以非零状态退出。
4. **真实解释器测试。** 脚本花费需通过真实的 BSV Script 解释器在
   **Genesis 规则**下运行；负向测试必须在解释器**内部**失败，绝不在外层
   守卫中失败；签名抽查不是可接受的替代方案。
5. **不过度声称；枚举信任面。无隐藏假设**——将决策记录为
   ADR。**不致歉。**
6. **可追溯性完整。** 每条需求（核心 `REQ-*` 和应用 `REQ-APP-*`）都映射到
   代码和一项通过的测试；任何未经测试的需求或未追溯的共识/安全
   源文件都会使 CI 失败。
7. **工程标准：** NASA NPR 7150.2 保障实践 + 一份**有文档记录的** Power-of-Ten
   适配（规则 3 和裸指针规则在 GC 的 TS/Go 运行时中不适用——明确说明）+
   Microsoft SDL。

## 依赖——已存在于工作区中；切勿重新验证其存在
通过适配器/SDK 契约 **CT/BS/VA/OB** 针对 prof-faustus 各仓库进行构建
（核心 §2）：`cardtable`（心智扑克底层——使用其**原语**，而非其游戏）、
`bonded-subsat-channel`（亚聪通道 + **嵌入式 BSV 节点** = regtest 后端，
D6）、`verifiable-accounting` ×3、`overlay-broadcast`。绑定到契约，绝不绑定内部实现。
唯一的契约一致性套件必须同时针对 fakes **和** **真实**
适配器通过；安全关键路径（洗牌、揭示一次性、公平博弈、签名）需针对
**真实**实现测试，绝不针对 fakes。

## 构建顺序——在每个门槛处提交
按照分阶段路线图（核心 §17，应用 §A21.9）：
- **Phase 0 — 基础。** 搭建单体仓库脚手架（核心 §16 / 应用 §A2.4）：`/spec`、
  `/packages/*`（protocol-types、engine、hand-eval、game-*、crypto-mentalpoker、
  script-templates-ts、tx-builder、wallet-custody、adapters、sdk、ui-core、app-services）、
  `/apps/{client-web,client-desktop,relay-go,indexer-go}`、`/vm`、`/tests`。为 CT/BS/VA/OB 提供适配器 +
  受一致性约束的 fakes。VM 拉起 node(regtest)+relay+空客户端；
  `reproduce` 绿；可追溯性骨架就位。**门槛：** VM 端到端启动、自检
  通过、CI 全绿。**提交并打标签。**
- **Phase 1 — 首个可玩版本：regtest 上的单挑无限注德州扑克 (NL Texas Hold'em)，Windows + web，带
  发现。** 熵承诺/揭示；分布式洗牌；加密牌发牌；完整的
  preflop→river 下注 FSM；最小揭示摊牌；结算；决策 + 恢复
  超时；**无揭示弃牌**；relay + LAN 发现；基于一套共享 UI 核心的 Tauri Windows 外壳与
  web 外壳；交易记录 (transcript) + 确定性重放。**通过运行 `handeval_oracle.py` 生成 §19.D
  向量。** 运行解释器级脚本测试（Genesis）、
  对抗性子集、VM 内 E2E 以及 `reproduce`。**门槛：** 核心 §14.7 / 应用
  §A18.3，在桌面和 web 两种构建上**均**满足。**提交并打标签。**
- **Phase 2+ 及其他游戏**（Omaha、Stud、Draw、Razz；然后在其 §A21.7
  独特的无荷官模型确定后再做 Blackjack）按应用 §A21.9——每个为一个 `GameModule`，各带其
  变体牌桌视图配置、**生成的**手牌评估向量、下注结构（PL/FL），以及
  各自的验收门槛。**每个游戏分别提交。**

## 运行与构建义务——由你执行
- 生成向量：`python3 handeval_oracle.py` → 嵌入已验证的输出；`reproduce` 会
  检查它。为新向量扩展该 oracle；绝不手写向量。
- 通过真实解释器构建并**测量** Script 模板（核心 §19.C）；将
  字节排布作为可复现向量提交。
- 构建自包含的 VM 镜像（容器；可选 VM 镜像），具备一条命令即可
  引导启动（核心 §10，应用 §A14）。
- 从同一次提交构建**签名的 Windows 安装程序 (Tauri)** 和 **web 包**；
  记录工件哈希（应用 §A14）。
- CI 各阶段（应用 §A14.2）：typecheck → lint（含 OP_RETURN 缺席检查）→ unit+property
  → 解释器级（Genesis）→ 集成 → 构建镜像 → 镜像内 E2E → `reproduce` →
  无障碍 + 安全 → 可追溯性。任一红色阶段都会阻断合并。

## 提交 / 加载纪律——这就是"提交"步骤
- 若仓库尚未初始化，则 `git init`。以小而可评审的单元提交，并附
  描述性消息。**绝不提交红色 CI。**
- 在每个阶段/门槛处以及每个一致性/测试里程碑处提交。为 Phase 0 和
  Phase 1 的验收提交打标签。
- 保持 ADR、需求登记册和可追溯性矩阵已提交且为最新。

## 汇报
每个阶段结束后汇报**诚实**的指标——文件、测试、需求覆盖率、生成的
向量哈希、VM/安装程序哈希——以及尚余工作。绝不声称你并不
具备的完整性。

**从 Phase 0 开始。先完整阅读 `bsv-poker-spec.md` 和 `bsv-poker-app-architecture.md`。**
