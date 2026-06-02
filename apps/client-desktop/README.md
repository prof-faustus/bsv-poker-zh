# client-desktop — Windows desktop shell (Tauri)

The Windows desktop program (core §11.1, app §A3, AD2): a Tauri v2 app — a **Rust supervisor**
(Tauri main) that spawns and supervises the local services and hosts the WebView2 running the same
`ui-core` the web client uses, so a non-technical user double-clicks and plays.

## Status — source complete, build pending native toolchain

The supervisor (`src-tauri/src/main.rs`) implements the §A3.2 service lifecycle, ordered
startup / reverse-order shutdown (REQ-APP-021), the bounded restart policy (REQ-APP-022), the
`services.*` / `config.*` IPC commands (Appendix I), and the guarded mainnet switch
(REQ-APP-030). It wraps the **built web bundle** (`apps/client-web/dist`) as its frontend.

**It is not compiled in this environment**, which lacks the native toolchain. To build it you need:

1. **Rust** (`rustup` — install the stable toolchain).
2. **A C linker** — on Windows, the **MSVC Build Tools** (the default `x86_64-pc-windows-msvc`
   target). WebView2 runtime is already present on Windows 11.
3. The **Tauri CLI**: `pnpm --filter @bsv-poker/client-desktop add -D @tauri-apps/cli` (already
   declared), then from this directory:

```
pnpm --filter @bsv-poker/client-web build      # produce the frontend bundle first
pnpm --filter @bsv-poker/client-desktop tauri build
```

This yields a signed-installer-ready MSI/NSIS (signing is wired in CI per REQ-VM-004/§A14). In dev,
`tauri dev` runs the Vite dev server and the supervisor together.

The desktop shell shares 100% of the UI with the web client (`ui-core`); only the
service-supervision and custody-process boundary differ (§A1.2). Custody-trusted operations move
to the Rust side / an isolated worker in a later pass (§A8.2, AD-OPEN-3).
