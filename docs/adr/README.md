# 架构决策记录（ADR）

依据应用规范 §A15（REQ-APP-150）以及"无隐藏假设"规则（核心 P7）：构建过程中所做的每一项重要决策都连同其背景、决策、状态和后果记录于此。这些记录补充了规范中已声明决策的表格（核心 §0.5 D1–D9、应用 §A0.3 AD1–AD10、§A20.1 AD-OPEN-*）。

| ADR | 标题 | 状态 |
|---|---|---|
| [0001](0001-node-native-typescript.md) | 采用 Node 原生 TypeScript（类型剥离）而非打包器/ts-node | 已接受 |
| [0002](0002-portable-sha256.md) | protocol-types 中的可移植纯 TS SHA-256 | 已接受 |
| [0003](0003-self-contained-interpreter.md) | 用于 Phase 0/1 的自包含 Genesis Script 解释器 | 已接受 |
| [0004](0004-mode-a-signing.md) | 用于 Phase 1 的模式 A（揭示时重构）签名 | 已接受（核心 D9） |
| [0005](0005-engine-auto-advance.md) | 引擎自动推进协作式揭示/发牌阶段 | 已接受 |
