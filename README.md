# bsv-poker

[![CI](https://github.com/prof-faustus/bsv-poker/actions/workflows/ci.yml/badge.svg)](https://github.com/prof-faustus/bsv-poker/actions/workflows/ci.yml)

一个构建于 **Bitcoin SV** 之上（Genesis 升级后，默认 regtest）的无荷官、非托管多人 **poker** 平台。依据 [`/spec`](./spec) 中的规范构建：

- `spec/bsv-poker-spec.md` — 协议 / 密码学 / 交易核心（权威规范）。
- `spec/bsv-poker-app-architecture.md` — 应用层（桌面端 + Web，多种游戏）。
- `spec/bsv-poker-spec-redteam-01.md` — 红队评审 01（已应用）。
- `spec/BUILD-KICKOFF.md` — 本仓库所执行的构建指令。

## 不可妥协的规则（强制执行，而非空想）

1. **仅限 BSV，Genesis 升级后。** 不支持 BTC。`OP_CHECKLOCKTIMEVERIFY`/`OP_CHECKSEQUENCEVERIFY`
   均为空操作；所有计时均在**交易级别**进行（`nLockTime` + `nSequence`）。
2. **`OP_RETURN` 在任何地方都被禁用。** 每一个承诺都是活动脚本中的 pushdata
   （`<data> OP_DROP`）。如果操作码 `0x6a` 出现在任何锁定/解锁脚本中，`pnpm lint:opreturn` 会使构建失败。（core P11 / §6.5；HANDOVER §3。）
3. **零捏造。** 每一个向量/字节大小都由运行代码生成；`pnpm reproduce`
   会重新生成所有这些数据，并在任何不匹配时以非零状态退出。
4. **真实解释器测试。** 脚本花费通过启用 Genesis 规则的真实 BSV Script 解释器运行；
   负面测试在解释器*内部*失败。
5. **可追溯性是完整的。** 每一个 `REQ-*` 都映射到代码和一个通过的测试
   （`pnpm trace`）。
6. **工程标准：** NASA NPR 7150.2 保障 + 有文档记录的 Power-of-Ten 改编 +
   Microsoft SDL。

## 下载与运行

### Windows 桌面端（下载安装程序）
从 **[Releases](https://github.com/prof-faustus/bsv-poker/releases/latest)** 获取最新安装程序：
- **`bsv-poker_0.1.0_x64-setup.exe`**（NSIS）— 双击、安装，从开始菜单启动 **bsv-poker**。
  （`…_x64_en-US.msi` 是 MSI 替代方案。）
- 需要 Microsoft **WebView2** 运行时（Windows 11 上已自带）。应用打开时会显示一个
  **REGTEST — play money** 横幅，并与机器人进行一对一无限注德州扑克对局。目前未签名，因此
  SmartScreen 可能会提示"未知发布者" → **更多信息 → 仍要运行**。

### Web（容器）
Web 客户端由 [`publish-web.yml`](.github/workflows/publish-web.yml) 发布到 GHCR：
```
docker run --rm -p 8080:80 ghcr.io/prof-faustus/bsv-poker-web:latest
# 打开 http://localhost:8080
```
> 仅首次需要：GHCR 默认将新软件包设为**私有**。要允许匿名 `docker pull`，
> 请打开 **github.com/users/prof-faustus/packages/container/bsv-poker-web/settings → Change visibility
> → Public**（一键完成）。或者自行构建/运行：
> ```
> docker build -f apps/client-web/Dockerfile -t bsv-poker-web . && docker run --rm -p 8080:80 bsv-poker-web
> ```

## 工具链

- Node ≥ 24（TypeScript 通过原生类型剥离直接运行；测试使用 `node --test`）。
- pnpm 9（工作区）。`relay-go` / `indexer-go` 需要 Go ≥ 1.24。桌面端外壳使用 Rust/Tauri
  （后续阶段）。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm typecheck` | 在整个工作区执行 `tsc --strict --noEmit` |
| `pnpm test` | 运行所有 `node --test` 测试套件 |
| `pnpm reproduce` | 重新生成每一个已提交的向量；不匹配时返回非零（core §14.5） |
| `pnpm lint:opreturn` | 如果任何脚本中出现 `OP_RETURN`（0x6a）则失败（规则 2） |
| `pnpm trace` | 需求 → 代码 → 测试 的可追溯性检查（core §13.3） |
| `pnpm ci` | 完整的 CI 流水线（core §16，app §A14.2） |

## 状态

参见 [`spec/BUILD-STATUS.md`](./spec/BUILD-STATUS.md) 了解诚实的各阶段构建状态
和指标。按阶段构建（core §17）：阶段 0 基础 → 阶段 1 一对一无限注德州扑克。
