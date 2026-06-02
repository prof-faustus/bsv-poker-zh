# BUILD STATUS — 诚实指标（核心 §17，应用 §A20.2）

> 完整性的声称绝不超出已写明且已测试的范围。此处每个数字都是
> 通过运行构建（`pnpm ci`）产生的，而非断言。上一次完整运行：CI **绿**。

## v3（标签 `v0.3.0`）— 一个真实的游戏
- **任选变体，真实房间，2–9 名玩家。** 变体通用的网络客户端（Hold'em /
  Omaha 含 Hi-Lo / Stud / Draw / Razz），基于浏览器安全的注册表运行；大厅 + 等候室可就座
  N 名真实玩家。`pnpm multi-e2e`：3 人 Hold'em + 2 人 Omaha 逐字节收敛。
- **钱包——既能存入也能取出资金。** `WalletService`：余额、存入资金、提现、买入 /
  兑现、历史记录、持久化（整数聪）。`pnpm wallet-e2e`：一次存款会在节点上挖出一个真实的
  regtest 区块；主网存款/提现是同一服务，置于研究标志之后。
- **牌桌 UI**：绿色台呢椭圆桌、沿椭圆排布的座位、真实扑克牌 + 牌背、
  筹码/底池/庄家按钮、待行动高亮、下注滑块（来自引擎的 Min/½-pot/Pot/All-in）、一个
  变体选择器，以及一个始终可见的钱包面板。（CI 141 TS + 16 Go。）

## v2（标签 `v0.2.0`）— 新增内容
- **真实多人等候室**（玩家加入，**而非**机器人）：`LobbyClient`（host/create/list/join、
  在线玩家、座位达成一致）+ relay 之上的 `InteractiveNetworkedTableClient`；web UI
  Connect → Lobby → 等候室 → 联网牌桌（+ 离线对机器人练习）。`pnpm lobby-e2e`：
  两名玩家加入并逐字节收敛。
- **真实的脚本内 EC 公平博弈**（GB2616862 §19.C）取代 HASH160 回退方案：解释器
  获得了 post-Genesis 的 BigInt 脚本数字 + `OP_MUL/OP_SUB/OP_MOD/OP_NUMEQUALVERIFY`；
  `fairPlayEcLocking` 在脚本内验证 `SHA-256(x)==commit` 且 `y²≡x³+7 (mod p)`（231 B/张牌）——
  作弊在解释器内部失败。
- **浏览器多人游戏**：relay CORS；web 容器 `ghcr.io/prof-faustus/bsv-poker-web`。
- **CI：124 TS + 16 Go 测试绿。** 发布物：web 镜像 + 由 CI 在打标签时构建的 Windows MSI/NSIS。

## 流水线（`pnpm ci`）

| 阶段 | 结果 |
|---|---|
| `tsc --strict`（全部 strict 标志，整个工作区） | 绿 |
| OP_RETURN lint（0x6a 缺席，规则 2） | 绿 |
| TS 测试（`node --test`） | **110 通过 / 0 失败** |
| Go 测试（relay + indexer） | **16 通过 / 0 失败** |
| `reproduce`（每个向量逐位重新生成） | 绿 |
| 可追溯性 | **223 条需求中已追溯 72 条；所有 Phase-0/1 门槛需求 → 通过的测试** |
| web 客户端 `vite build` | 绿 → `apps/client-web/dist`（62 个模块，56.8 kB gzip） |
| `node tools/selftest.ts`（栈拉起 + 完整手牌 E2E） | PASS |

## 各阶段

- **Phase 0 — 基础 — 门槛已达成** ✅（标签 `v0.0.0-phase0`）：单体仓库、适配器 + 一致性
  fakes、protocol-types + §19.A 序列化、reproduce + 可追溯性、VM 自检、CI 绿。
- **Phase 1 — 首个可玩版本（单挑 NL Hold'em）— 核心已达成；外壳部分完成**：
  - ✅ 熵承诺/揭示、分布式洗牌、加密牌发牌、完整的 preflop→river
    下注 FSM、摊牌、**通过真实解释器验证的结算花费**、无揭示
    弃牌、决策/恢复超时默认值、交易记录 + **确定性重放**
    （SDK `runHand`/`deriveState`）；所用每个模板的解释器测试皆绿。
  - ✅ **可运行的 web 客户端**（`vite build` → 在真实引擎上可玩的同座对机器人 Hold'em；
    大厅、牌桌、合法性驱动的下注调整器、签名模态框、后果提示文本、regtest 横幅）。
  - ✅ **已构建的 Windows 桌面应用**（Tauri）：`bsv-poker-desktop.exe` + 安装程序
    `bsv-poker_0.1.0_x64_en-US.msi` 与 `bsv-poker_0.1.0_x64-setup.exe`；Rust 监督进程
    实现了 §A3.2 生命周期 + IPC。
  - ✅ relay/indexer **多客户端网络**（RelayClient/IndexerClient；自检
    在在线的 Go 服务之上演练发现 + 双路径 + 确定性投影）。
  - ✅ **已绑定真实嵌入式 BSV 节点**（D6）：`pnpm node-e2e` 启动真实的
    bonded-subsat-channel regtest 节点，并通过平台适配器挖出区块（高度 0→2）。
- **Phase 2 — 健壮性 — 部分交付**：公平博弈模板（不匹配则在解释器内部
  没收）+ §19.C 测量得出的字节排布 + 每张牌/每批次决策；多路 N 座
  Hold'em，含边池结算 + 庄家按钮轮转；**9 案例对抗性套件**（§14.6）。
- **Phase 3 — 变体 — 已达成**：Omaha（含 **Omaha-8 hi-lo 高低分池**，REQ-FSM-007）、Seven-Card
  Stud、Five-Card Draw、Razz 各游戏模块，均已测试；手牌评估可复现 §19.D 向量。
  （TODO：地道的 FL stud bring-in completion 加注金额。）
- **Phase 4 — 微下注 + 审计/NFT 接缝**：**`pnpm microbet-e2e` 驱动真实的
  bonded-subsat-channel**——open → 亚聪转账 → 整数聪 Q* 关闭 `[7,5]` →
  受质疑时 1 聪保证金没收（INV-BS-1/2、REQ-WALLET-005、REQ-DEP-004）。VA 审计（边界
  已浮现）+ OB 撤销针对符合一致性的 fakes 进行了集成测试。
- **真实多人游戏**：`pnpm multiplayer-e2e`——两个联网客户端在在线 relay 之上
  逐字节收敛（REQ-TEST-002）。

## 包（TS）+ 应用（Go/Rust）

protocol-types · hand-eval · engine · game-holdem · game-omaha · game-stud · game-draw ·
game-razz · crypto-mentalpoker · adapters · script-templates-ts · tx-builder · wallet-custody ·
sdk · ui-core · app-services · tools · relay-go · indexer-go · client-web（Vite，可构建）·
client-desktop（Tauri，**可构建为 MSI + NSIS 安装程序**）。

## 不可商量的规则——已强制执行，而非纸上愿景

仅限 BSV/post-Genesis（CLTV/CSV no-ops，已测试）· **OP_RETURN 禁用**（序列化抛错 + lint +
解释器拒绝）· 零捏造（`reproduce`）· 真实解释器负向测试（在内部
失败）· 对每条声称的需求完整可追溯 · RT-01 B1/B2 未被重新引入。

## 尚余工作（诚实）

1. **每笔扑克交易向节点广播**：节点守护进程暴露 mine/height（已绑定），但未暴露
   通用的 tx-submit RPC；将每笔扑克 出资/发牌/揭示/结算 交易广播给它需要
   在外部节点上添加该 RPC（超出"绑定契约，而非内部实现"的范围）。当前结算
   通过平台自身的 Genesis 解释器验证。
2. **cardtable (CT)**：真实仓库不在本磁盘上，因此 CT 契约运行在真实的
   crypto-mentalpoker 实现 + 符合一致性的 fake 之上；绑定 cardtable 仓库待其到位。
   （BS 节点 + BS 通道这两个承重外部依赖**已**绑定到真实的 bonded-subsat-channel。）
3. **Mode B** 门限签名（`OB.custody` FROST/GG20）；完整的预签名回退图；
   最小揭示摊牌密码学的链上接线；绑定真实的 VA/OB 仓库（后续轨道）。
4. **可追溯性**：223 条需求中约 146 条仍为 `planned (later phase)`——参见
   `spec/traceability.txt`。
