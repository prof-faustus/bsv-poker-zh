# 自包含运行时（"虚拟机"）— core §10 / D5

一个可复现的技术栈，无需任何外部服务即可启动 **node(regtest) + relay + indexer + client**
（REQ-VM-001/002/003）。默认 regtest；主网仅在一个显式的
研究标志背后启用（REQ-VM-007）。

## 一条命令引导 + 自检（无需 Docker）

```
node tools/selftest.ts      # 或：pnpm selftest
```

它会构建 Go 服务，启动中继（`:8091`）和索引器（`:8092`），等待
`/healthz`，通过引擎（客户端角色）运行一手完整的一对一德州扑克手牌，打印
记录 + 最终状态哈希 + 派彩，然后关闭这些服务。这是阶段 0 的门禁
检查："VM 端到端启动，自检通过"（core §17）。

## 容器打包（REQ-VM-003）

```
docker compose -f vm/docker-compose.yml up --build
```

- `node-regtest`（:18332）— 阶段 0 占位符；真正的**有保证金的 subsat 通道**嵌入式
  节点将在下一步接入（D6，§10.2）。
- `relay`（:8091）— 仅负责传输 + 索引，绝不是真相来源（core §8.1）。
- `indexer`（:8092）— 按牌桌划分的交易投影。
- `client`（:5173）— 阶段 0 占位符；`apps/client-web`（Vite）将在阶段 1 落地。

构建是可复现的（固定版本的工具链、`-trimpath`、distroless 静态镜像；
REQ-VM-006）。一个真正的 hypervisor 镜像（OVA/qcow2）是来自同一构成的可选额外
产物（D5，REQ-VM-005）——默认不构建。
