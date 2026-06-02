# ADR 0002 — protocol-types 中的可移植纯 TypeScript SHA-256

**状态：** 已接受

**背景。** `protocol-types`（规范化序列化、`rulesetHash`、状态哈希）被引擎、hand-eval 以及游戏模块所导入，而这些模块都必须**在浏览器中**运行（核心 §3.2/§11.1，一个核心两个外壳）。`node:crypto` 在浏览器打包产物中不可用，而 Web Crypto 的 SHA-256 是异步的——但序列化器的哈希是同步且确定性的。

**决策。** 在 `protocol-types/src/sha256.ts` 中以纯 TypeScript 实现 SHA-256，并将其用于 `sha256`/`hash256`。它产出与 `node:crypto` 逐字节相同的输出（已验证：`reproduce` 向量未发生变化）。`node:crypto` 仍保留给仅限 Node 的代码：Script 解释器（ECDSA）和托管后端。

**后果。** 确定性核心与运行环境无关，Web 客户端可直接导入它。纯 TS 哈希比原生实现慢，但它并不处于紧凑的热路径上（状态哈希是按状态转移计算的，而非按牌计算）；如果性能分析证明有必要，可以日后在同一函数背后加入 Web Crypto 快速路径（Power-of-Ten：先正确，后快速）。
