# BUILD STATUS — honest metrics (core §17, app §A20.2)

> Completeness is never claimed beyond what is written and tested. Every number here is
> produced by running the build (`pnpm ci`), not asserted. Last full run: CI **GREEN**.

## Pipeline (`pnpm ci`)

| Stage | Result |
|---|---|
| `tsc --strict` (all strict flags, whole workspace) | green |
| OP_RETURN lint (0x6a absence, rule 2) | green |
| TS tests (`node --test`) | **110 pass / 0 fail** |
| Go tests (relay + indexer) | **16 pass / 0 fail** |
| `reproduce` (every vector regenerates bit-for-bit) | green |
| traceability | **72 / 223 requirements traced; all Phase-0/1 gate reqs → passing tests** |
| web client `vite build` | green → `apps/client-web/dist` (62 modules, 56.8 kB gzip) |
| `node tools/selftest.ts` (stack up + full hand E2E) | PASS |

## Phases

- **Phase 0 — Foundations — GATE MET** ✅ (tag `v0.0.0-phase0`): monorepo, adapters+conformance
  fakes, protocol-types + §19.A serialization, reproduce + traceability, VM self-test, CI green.
- **Phase 1 — First playable (heads-up NL Hold'em) — core MET; shells partial** :
  - ✅ entropy commit/reveal, distributed shuffle, encrypted-card deal, full preflop→river
    betting FSM, showdown, **settlement spend verified through the real interpreter**, fold
    without reveal, decision/recovery timeout defaults, transcript + **deterministic replay**
    (SDK `runHand`/`deriveState`); interpreter tests green for every template used.
  - ✅ **running web client** (`vite build` → playable hot-seat-vs-bot Hold'em on the real engine;
    lobby, table, legality-driven bet sizer, signing modal, consequence text, regtest banner).
  - ⏳ **desktop shell**: source complete (Tauri supervisor, §A3.2 lifecycle, IPC) — **build
    pending the native toolchain** (no Rust/MSVC linker on this host; see apps/client-desktop).
  - ⏳ relay/LAN **discovery wired into the client** (relay+indexer run + self-test; the web
    client is single-client local — multi-client sync is the next pass).
  - ⏳ on-chain crypto/tx **end-to-end on the real bonded-subsat-channel node** (modeled in-process
    + interpreter-verified; the real node adapter binds next).
- **Phase 2 — Robustness — partially delivered**: fair-play template (mismatch forfeits inside
  the interpreter) + §19.C measured byte schedule + per-card/per-batch decision; multi-way N-seat
  Hold'em with side-pot settlement + button rotation; **9-case adversarial suite** (§14.6).
- **Phase 3 — Variants — MET (modules)**: Omaha, Seven-Card Stud, Five-Card Draw, Razz game
  modules, each tested; hand-eval reproduces the §19.D vectors. (TODO: Omaha-8 hi-lo split path
  exists in hand-eval, gated off in the module; authentic FL bring-in completion sizing.)
- **Phase 4 — seams**: VA audit (boundary surfaced, no truth-at-origin) + OB revocation
  (unspent-expiring-output) integration-tested against the fakes.

## Packages (TS) + apps (Go/Rust)

protocol-types · hand-eval · engine · game-holdem · game-omaha · game-stud · game-draw ·
game-razz · crypto-mentalpoker · adapters · script-templates-ts · tx-builder · wallet-custody ·
sdk · ui-core · app-services · tools · relay-go · indexer-go · client-web (Vite) ·
client-desktop (Tauri, source).

## Non-negotiable rules — enforced, not aspirational

BSV-only/post-Genesis (CLTV/CSV no-ops, tested) · **OP_RETURN banned** (serialize throws + lint +
interpreter reject) · zero fabrication (`reproduce`) · real-interpreter negative tests (fail
inside) · complete traceability for every claimed requirement · RT-01 B1/B2 not reintroduced.

## What remains (honest)

1. **Desktop build**: install Rust + MSVC Build Tools, then `cargo tauri build` (source is ready).
2. **Multi-client + discovery**: wire the web client to relay/indexer for real multiplayer.
3. **On-chain E2E**: bind the real `bonded-subsat-channel` node (D6) and run a crypto/tx hand on
   regtest through the VM; bind the real CT/BS/VA/OB repos and re-run conformance against them.
4. **Mode B** threshold signing (`OB.custody`); full pre-signed fallback graph; minimum-reveal
   showdown crypto; Omaha-8 hi-lo.
5. **Traceability**: 151 / 223 requirements remain `planned (later phase)` — see
   `spec/traceability.txt`.
