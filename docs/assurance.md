# 软件保障与安全实践

本构建采用了一套有文档记录的保障实践（REQ-ENG-001、REQ-APP-170）和一套安全实践（REQ-APP-172）。两者都不是合规性声明；二者都是仓库在 CI 中运行的、具体且强制执行的工程纪律。

## 保障实践（NPR 7150.2，经适配）

- **需求登记册。** 每一个 `REQ-*` 都是一条机器可读的条目（`spec/requirements.yaml`，由 `tools/extract-requirements.ts` 生成；REQ-ENG-002）。
- **可追溯性门禁。** `tools/trace-map.ts` + `tools/traceability.ts` 将每个已满足的需求映射为 需求 → 源码 → 通过的测试；CI 在出现未追溯的共识文件时失败（REQ-ENG-003）。当前：144/223。
- **可复现性。** `tools/reproduce.ts` 重新生成每一个已提交的向量，并在出现任何不匹配时以非零状态退出（REQ-TEST-005）。
- **测试分类法**（REQ-APP-160）：单元 → 属性 → **解释器级脚本**（否定性测试在真实解释器*内部*失败）→ 端到端 → 对抗性（`packages/sdk/test/adversarial.test.ts`）→ 链上（`tools/onchain-*-e2e.ts`）。181 个 TS + 16 个 Go 测试在 `node tools/ci.ts` 中运行。
- **Power-of-Ten 适配（非字面；REQ-ENG-001）。** 记录于 `docs/adr/0003-self-contained-interpreter.md`：要求静态分配 / 无递归 / 指针限制的规则在带 GC 的 TS/Go 运行时中不字面适用。其中*可度量*的规则——热路径中有界的工作内存——由 `tools/perf-suite.ts` 断言（20 万次热路径求值保持约 0 堆增长）。每一项陈述的边界/限制都在源码中被断言，并汇集于 `tests/boundaries.test.ts`（REQ-ENG-004）。

## 安全实践（威胁导向；REQ-APP-172）

- **威胁导向设计。** 两次红队评审：`spec/bsv-poker-spec-redteam-01.md`（规范）和 `docs/redteam-02.md`（实现——每条发现都以代码+测试证据重新裁定）。
- **安全默认值。** 默认 Research/regtest；mainnet 位于一个显式令牌和无法忽视的横幅之后（`network-gate.ts`，REQ-PROD-012/REQ-VM-007）；本地服务仅绑定环回（REQ-APP-106）；relay 不受信任，且从不解释负载（REQ-APP-070）。
- **密钥卫生。** 密钥仅存在于托管边界内部（REQ-APP-101）；日志/指标/追踪/诊断包从不携带密钥材料（`observability.ts` 脱敏，REQ-APP-124）。
- **信任边界校验。** 每一个入站的 relay/peer 信封在使用前都经过校验；任何无法识别的内容都被拒绝（`message-validation.ts`，REQ-APP-103）。持久化记录在读取时被校验，若损坏则被隔离（`persistence.ts`，REQ-APP-132）。
- **无伪造不变量。** `OP_RETURN` 在活动脚本中被禁止（lint + 解释器拒绝）；否定性测试在真实的 Script 解释器内部失败；B1/B2 红队回归受到守护。
