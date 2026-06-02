# §19.C — 脚本模板字节排布 + 公平博弈测量 + 每手牌封套

**溯源 (P6/P10)：** 下方每个字节大小都是**通过运行代码测量得出**（`pnpm reproduce`
→ `spec/vectors/reproduce.json` → `templateWireBytes`），而非断言。用
`pnpm reproduce` 重新生成并验证。

## 测量得出的模板线缆字节大小（锁定脚本，Phase-1 构建器）

| 模板 | 锁定脚本字节数 | 说明 |
|---|---|---|
| 分支绑定前缀 (`<bind> OP_DROP`) | **112** | 109 字节绑定 (gid8+rh32+round4+sh32+seat1+succ32) + pushdata + OP_DROP；采用 pushdata 而非 OP_RETURN (REQ-TX-010) |
| fold | **147** | 绑定 + `<pub> OP_CHECKSIG` |
| 出资 2-of-2 | **183** | 绑定 + `OP_2 <pub><pub> OP_2 OP_CHECKMULTISIG` |
| reveal-or-timeout | **220** | 绑定 + `OP_IF OP_SHA256 <cmt> OP_EQUALVERIFY <pub> OP_CHECKSIG OP_ELSE <pub> OP_CHECKSIG OP_ENDIF` |
| 结算 | **147** | 绑定 + `<winnerPub> OP_CHECKSIG` |
| **公平博弈（每张牌）** | **175** | 绑定 + `OP_IF OP_DUP OP_HASH160 <cmt> OP_EQUALVERIFY OP_CHECKSIG OP_ELSE <pub> OP_CHECKSIG OP_ENDIF` |

## 脚本内 EC 公平博弈 — 已实现（v2，post-Genesis 操作码现已可用）

早先仅基于 HASH160 的公平博弈只是一个回退方案。**真正的脚本内 EC 推导**现已
实现（`fairPlayEcLocking`，**测量得 231 字节**/张牌）：解锁脚本揭示
洗牌密钥标量 `x` 与 `y`；脚本验证 **(a)** `SHA-256(x)` 等于该承诺
（该方未调换密钥），以及 **(b)** 该点确实位于 secp256k1 上——
`y² ≡ x³ + 7 (mod p)`——使用 post-Genesis 大整数操作码
`OP_MUL`/`OP_MOD`/`OP_ADD`/`OP_NUMEQUALVERIFY` 在 256 位域素数上于脚本内计算。不匹配的密钥或
伪造的离曲线 `y` 会在解释器**内部**失败 (REQ-CRYPTO-006/009, P9)。这就是
在链上强制执行的 GB2616862 洗牌密钥/曲线关系 (§4.2)；完整的脚本内标量乘法
(`P = s·G`) 仍是进一步的升级项。

## 公平博弈扩展决策 (REQ-CRYPTO-009 / RT-01 M3)

GB2616862 给出的公平博弈脚本示例是针对 **3 个元素 / 2 个参与方**的一长串嵌套 `OP_IF/OP_ELSE`。
单个 52 张牌、N 方的脚本内 EC 点推导证明可能非常庞大；post-Genesis BSV
没有脚本大小上限，因此并非不可能，但其字节大小/费用/可构造性
尚未验证。**决策：交付按每张牌 / 每批次的公平博弈交易结构**（上方
测量得 175 字节的每张牌脚本即为已实现的回退方案，REQ-CRYPTO-009）。完整的
脚本内 EC 推导证明属于升级项，待嵌入式节点的解释器暴露 EC
数值操作码后再实现——在那之前其字节大小仍为 **TRACKED ASSUMPTION**。

## 每手牌交易计数封套（单挑 Hold'em；结构化推导自 §19.E）

`reproduce.json → perHandTxEnvelope`：1 笔出资 + 2 笔熵承诺 + 2 笔洗牌阶段承诺 +
1 笔发牌 + 3 笔公共牌揭示 + 每次行动的下注 + 弃牌/结算 + **52 笔每张牌公平博弈**。该
交易**计数**现已可推导；**字节总量在嵌入式节点的完整解释器于 CI 中测量之前仍为 TRACKED ASSUMPTION**
（此处平台的解释器使用 ECDSA-over-SHA-256 的 sighash；生产环境换用节点的 double-SHA-256 sighash）。
