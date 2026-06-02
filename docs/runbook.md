# 运行手册（运维）

依据应用规范 §A15。如何构建、测试、运行和验证该平台。

## 前置条件
- Node ≥ 24（原生 TypeScript 类型剥离；`node --test`）。
- pnpm 9。Go ≥ 1.24。（桌面外壳所需的 Rust/Tauri——后续阶段。）
- 在 TLS 检查主机上安装：前缀加上 `NODE_OPTIONS="--use-system-ca"`。

## 安装
```
NODE_OPTIONS="--use-system-ca" pnpm install
```

## 命令（根 package.json）
| 命令 | 用途 |
|---|---|
| `pnpm typecheck` | 在整个工作区执行 `tsc --strict --noEmit` |
| `pnpm test` | 所有 `node --test` 套件 |
| `pnpm reproduce` | 重新生成每个向量；不匹配则非零退出（核心 §14.5） |
| `pnpm lint:opreturn` | 若任何脚本中出现 OP_RETURN（0x6a）则失败 |
| `pnpm trace` | 需求 → 代码 → 测试 的可追溯性 |
| `pnpm requirements` | 从规范重新生成 `spec/requirements.yaml` |
| `pnpm selftest` | 拉起整个栈 + 运行一手完整的端到端对局（Phase-0 门禁检查） |
| `pnpm ci` | 完整流水线（typecheck → lint → tests → reproduce → trace → go test） |

## 运行整个栈（自检，无需 Docker）
```
node tools/selftest.ts
```
构建各 Go 服务，启动 relay（:8091）+ indexer（:8092），等待 `/healthz`，运行一手完整的单挑手牌，打印转录 + 状态哈希 + 派彩，然后拆除。

## 运行容器栈
```
docker compose -f vm/docker-compose.yml up --build
```
node-regtest（:18332，占位，等待 bonded-subsat-channel 绑定）· relay（:8091）· indexer（:8092）· client（:5173）。

## 运行 Web 客户端（开发）
```
NODE_OPTIONS="--use-system-ca" pnpm --filter @bsv-poker/client-web dev      # 开发服务器
NODE_OPTIONS="--use-system-ca" pnpm --filter @bsv-poker/client-web build    # 静态打包产物 → dist
```

## 数据目录与网络
- 默认 regtest（REQ-VM-007）；mainnet 仅位于显式的研究标志之后，并伴有一个无法忽视的 UI 横幅。数据目录按网络划分命名空间，因此 regtest/mainnet 从不共享状态。
- 桌面监管进程默认将本地服务绑定到环回（§A10.7）。

## 恢复
- 一个红色的 CI 阶段会阻止合并——修复失败的阶段（运行器在第一个失败处停止）。
- `reproduce` 不匹配 ⇒ 某个向量发生了漂移；调查变更，然后仅在变更是有意为之时运行 `node tools/reproduce.ts --write`，并连同理由提交新向量。
