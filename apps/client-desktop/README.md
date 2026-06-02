# client-desktop — Windows 桌面端外壳（Tauri）

Windows 桌面程序（core §11.1，app §A3，AD2）：一个 Tauri v2 应用——一个 **Rust 监管进程**
（Tauri 主进程），它生成并监管本地服务，并托管运行着与 Web 客户端相同的
`ui-core` 的 WebView2，因此非技术用户只需双击即可游玩。

## 状态 — 源码完成，构建有待原生工具链

监管进程（`src-tauri/src/main.rs`）实现了 §A3.2 的服务生命周期、有序
启动 / 逆序关闭（REQ-APP-021）、有界的重启策略（REQ-APP-022）、
`services.*` / `config.*` IPC 命令（附录 I），以及受保护的主网切换
（REQ-APP-030）。它将**已构建的 Web 包**（`apps/client-web/dist`）包装为其前端。

**它在本环境中未被编译**，因为本环境缺少原生工具链。要构建它，你需要：

1. **Rust**（`rustup` — 安装 stable 工具链）。
2. **一个 C 链接器** — 在 Windows 上即 **MSVC Build Tools**（默认的 `x86_64-pc-windows-msvc`
   目标）。Windows 11 上已自带 WebView2 运行时。
3. **Tauri CLI**：`pnpm --filter @bsv-poker/client-desktop add -D @tauri-apps/cli`（已
   声明），然后从本目录执行：

```
pnpm --filter @bsv-poker/client-web build      # 先生成前端包
pnpm --filter @bsv-poker/client-desktop tauri build
```

这会产出一个可直接用于签名安装程序的 MSI/NSIS（签名按 REQ-VM-004/§A14 在 CI 中接入）。在开发模式下，
`tauri dev` 会同时运行 Vite 开发服务器和监管进程。

桌面端外壳与 Web 客户端共享 100% 的 UI（`ui-core`）；仅在
服务监管和托管进程边界上有所不同（§A1.2）。受托管信任的操作将在后续过程中
移至 Rust 侧 / 一个隔离的 worker（§A8.2，AD-OPEN-3）。
