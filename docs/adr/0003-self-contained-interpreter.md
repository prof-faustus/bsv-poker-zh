# ADR 0003 — 用于 Phase 0/1 的自包含 Genesis Script 解释器

**状态：** 已接受

**背景。** P9（核心 §14.3）要求脚本花费必须通过一个**真实的** BSV Script 解释器以 Genesis 规则运行，且否定性测试必须在解释器**内部**失败。嵌入式 `bonded-subsat-channel` 节点的生产解释器是最终目标，但它尚未绑定，而当下的构建必须证明 P9 已满足。

**决策。** 实现一个真实的栈式解释器（`script-templates-ts/src/interpreter.ts`），覆盖模板所使用的操作码子集，配备**真实的 secp256k1 ECDSA** `OP_CHECKSIG`/`OP_CHECKMULTISIG`（Node crypto）、真实的哈希/条件/栈操作、作为**空操作**的 CLTV/CSV（REQ-TX-001），并拒绝 `OP_RETURN`（核心 P11）。否定性花费在其内部失败。

**后果。** P9 在今日就由一个真正的解释器满足（而非签名抽查）。

**更新（v3）：sighash 偏差已闭合。** `tx-builder/wire.ts` 现在产出真实的 BSV**线格式序列化**（txid = 双重 SHA256）和真实的 **BIP-143（FORKID）sighash 原像**。`OP_CHECKSIG` 在 `sha256(sighashMessage)` 之上验证 ECDSA，其中 `sighashMessage = sha256(preimage)`——因此实际签名的摘要是 `double-SHA256(preimage)`，即生产环境的 sighash。在 BIP-143 sighash 之上签名的花费在解释器内部通过验证（且篡改交易会使其失效），已在 `tx-builder/test/wire.test.ts` 中验证。剩余的跟踪项：仅实现了模板的操作码子集，且广播这些交易需要嵌入式节点的 tx-submit RPC（节点守护进程当前仅暴露 mine/height）——它们将被提交时所用的线格式与 sighash 现已是真实的。
