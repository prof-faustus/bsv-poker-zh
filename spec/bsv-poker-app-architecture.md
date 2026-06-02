# BSV Poker — Application-Layer Engineering Specification
## The running Windows desktop program and the web client
### Mission-critical build specification for Claude Code

---

## Document control

| Field | Value |
|---|---|
| Document ID | `BSV-POKER-APP-SPEC` |
| Type | Build specification (design artifact). **No application code. Runs nothing.** |
| Companion | `bsv-poker-spec.md` — the protocol/crypto/transaction core (consumed, not restated) |
| Engineering bar | NASA NPR 7150.2 software-assurance practice + Microsoft SDL security practice + a **documented** JPL "Power-of-Ten" adaptation for a garbage-collected TypeScript/Go runtime (mapping in §A17). Mission-critical: every requirement traces to design, to a test obligation, and to an acceptance gate. |
| Author role | Writes the **how-to**. Specifies what is built, the contracts, the acceptance criteria, the test obligations. |
| Builder role | **Claude Code** builds and **runs** everything — code, vectors, byte measurements, the real Script interpreter, the test suites, the installers, the CI. The author runs nothing (§A19). |
| Status | Living document, built to the ≥10,000-line target across **dense, non-padded passes** (this is Pass A1 of the application spec; §A20 tracks remaining passes). Completeness is never claimed beyond what is written. |
| Hard rules | BSV-only, post-Genesis (no BTC; `OP_CHECKLOCKTIMEVERIFY`/`OP_CHECKSEQUENCEVERIFY` are no-ops — timing is transaction-level per core §6.2). **OP_RETURN banned everywhere** (core P11/§6.5). Zero fabrication (no computed value asserted here; computation is a Claude Code task). No hidden assumptions (every choice declared, overridable). No overclaim. No apologies. No padding. |

### Provenance and the no-fabrication rule for this document
This document asserts **no measured or computed value**. Every quantity that a mission-
critical spec would normally carry — latency budgets, byte sizes, throughput, memory ceilings,
coverage percentages — appears here either as a **design target** explicitly marked
`TRACKED ASSUMPTION` (a target the build must meet and **measure**, not a claim that it is met)
or as a `DECISION REQUIRED`. Where a value must be produced (hand-evaluation vectors, script
byte schedules, performance numbers), this document states the **task, method, and acceptance**
and assigns it to Claude Code (§A19). The author does not run code for any reason.

### Conformance language
The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **MAY** are used as in RFC 2119/8174. A **defect** is any deviation from a
**MUST**/**SHALL**. A **blocker** is a defect that makes a phase un-shippable. Requirement IDs
in this document use the prefix `REQ-APP-*` and are registered in §A18; each maps to an owning
module (§A2–§A8), a verification method (§A16), and an acceptance gate (§A18.3). This register
is kept in lock-step with the core spec's register (core §13.2/§19.F) — the two never
double-define a requirement; an application requirement that refines a core requirement cites it.

---

## Table of contents

- **§A0** Scope, deliverables, declared decisions, and the relationship to the core
- **§A1** Application overview — what "running" means, and the two programs
- **§A2** System architecture — layers, the deterministic boundary, data flow
- **§A3** Desktop runtime & supervision (Tauri + Rust supervisor + embedded services)
- **§A4** Web runtime
- **§A5** Shared UI core (one core, two shells)
- **§A6** Screen specifications (state, actions, consequence text, signing, edge states, a11y)
- **§A7** Discovery, lobby, matchmaking, connection
- **§A8** The seam to the protocol core (SDK consumption + custody boundary)
- **§A9** Non-functional requirements (performance, reliability, resource, capacity)
- **§A10** Security architecture (Microsoft SDL-aligned)
- **§A11** Error handling, failure modes, degraded operation, recovery
- **§A12** Observability (logging, metrics, tracing, audit, redaction)
- **§A13** Client persistence & data model
- **§A14** Packaging, build, CI/CD, reproducibility, release
- **§A15** Documentation standard (what the build must produce and maintain)
- **§A16** Verification & validation — test architecture and full test specification
- **§A17** Engineering-standard mapping (NPR 7150.2 + Power-of-Ten adaptation + Microsoft SDL)
- **§A18** Requirements register, traceability, acceptance gates
- **§A19** Division of labour — author (how-to) vs Claude Code (build/run)
- **§A20** Open decisions and the remaining-passes plan to ≥10,000 lines
- **Appendix I** IPC command/event catalog
- **Appendix II** Screen × action × SDK-call matrix
- **Appendix III** Error-code catalog
- **Appendix IV** Test-case catalog (specifications)
- **Appendix V** Configuration catalog
- **Appendix VI** Glossary (application layer)

---

# §A0 Scope, deliverables, declared decisions, and relationship to the core

## §A0.1 Scope (in / out)

**In scope (this document).** The complete application layer for the two shipped programs and
the runtime that hosts them:
- the **Windows desktop program** (native window, supervised local services, install/update);
- the **web client** (browser-hosted, remote or bundled-local services);
- the **shared UI core** both shells run;
- the **client-side runtime**: process supervision (desktop), connection management, persistence,
  custody-boundary integration, observability;
- **discovery, lobby, matchmaking, and connection** behaviour at the client (consuming the core's
  networking contracts, core §8);
- the **multi-game platform** — all poker variants (Texas Hold'em, Omaha PL/NL, Seven-Card Stud,
  Five-Card Draw, Razz) plus Blackjack — as game modules behind one interface (§A21), and the
  **NFT/revocation** (§A22) and **micro-payment** (§A23) integration seams;
- **non-functional requirements, security, error/failure handling, observability** for the app;
- **packaging, build, CI/CD, reproducibility** for the two programs and the self-contained image;
- the **documentation** the build must produce and the **test specification** the build must run.

**Out of scope (lives in the core spec `bsv-poker-spec.md`, cited not restated).** The
mental-poker cryptography (core §4), the BSV transaction/Script templates and their byte
schedules (core §6, §19.C), the engine's game logic and hand evaluation (core §5, §7, §19.D),
the SDK's internal implementation (core §15), the dependency contracts' internals (`CT/BS/VA/OB`,
core §2), and the protocol-level `DECISION REQUIRED` items (reveal-token core §4.6; Mode-B
signing core §6.7). The application **consumes** these; it does not re-specify them, and it must
not contradict them.

**Explicitly excluded from the product (per core §0.3, D7, D8).** Real-money operation, KYC/AML,
regulated gambling, NFT marketplace, native mobile, Blackjack — all later tracks; the core is
regtest-by-default with play-money semantics, mainnet behind an explicit research flag.

## §A0.2 Deliverables of the application layer
1. `client-desktop` — the Tauri Windows program (signed installer; §A3, §A14).
2. `client-web` — the Vite web bundle + its deployment (§A4, §A14).
3. `ui-core` — the shared UI core package (§A5).
4. The **self-contained image** ("VM", core D5/§10) — container (and optional VM image) bundling
   node + relay + client + bootstrap (§A14).
5. The **documentation set** (§A15) and the **test suites** (§A16) — specified here, built and run
   by Claude Code.

## §A0.3 Declared decisions (each overridable in exactly one place)

| ID | Decision | Default | Override key | Rationale (recorded, not assumed) |
|---|---|---|---|---|
| AD1 | Placement of this spec | Standalone document | — | Keeps the protocol core intact; gives Claude Code a focused app build doc. |
| AD2 | Windows shell | **Tauri** (WebView2 + Rust supervisor) | `desktop.shell` | Small native binary, system webview, clean local-process supervision (core §11.1). Electron only on a recorded Tauri limitation. |
| AD3 | Web shell | React + TypeScript + Vite | `web.stack` | Shared core with desktop; matches the lineage (core §3.2, §11.1). |
| AD4 | Local chain backend | `bonded-subsat-channel` embedded node, regtest | `chain.backend` | Reuse the existing self-contained node (core §10.2, D6). |
| AD5 | "VM" | Reproducible self-contained image (container + optional VM image) | `vm.targets` | No external services to play (core §10.1, D5). |
| AD6 | First runnable | Phase 1: heads-up NL Hold'em, regtest, Windows + web, with discovery | `phase1.game` | Core D1, D4, §17. |
| AD7 | Custody default | Software custody behind the pluggable `Custody` interface; TEE optional | `custody.backend` | No phase requires a TEE (core §9.3, §0.3). |
| AD8 | Languages | UI core + engine consumption in TypeScript; local services (relay, indexer, supervisor glue) in Go/Rust | `lang.*` | Matches core §3.2; Tauri main is Rust. |
| AD9 | State store (desktop) | SQLite | `desktop.store` | Core §11.2, §12.1. |
| AD10 | State store (web) | IndexedDB; **never** `localStorage`/`sessionStorage` for load-bearing state | `web.store` | Core §11.2, REQ-UI-002. |

## §A0.4 Relationship to the core, and the precedence rule
The application is a **viewer/agent** over the core's transaction-defined truth. The engine
derives `tableState = f(orderedValidTxSet, ruleset)` (core §3.3, P2); the shells render it and
emit signed actions. **Precedence:** on any conflict, the protocol core governs the protocol and
this document governs the application. If this document appears to require a protocol change, that
is a defect in this document — raise it against the core, do not silently diverge.

## §A0.5 Required-capability capture & coverage (every requirement → where it is handled)

This table captures **every capability the principal has stated** for this build and maps each to the
section(s) that handle it. It is the checkable answer to "make it so, nothing missed": a capability
with no covering section is a defect. The table is regenerated and re-verified each pass; if the
principal has stated a requirement not listed here, that is a miss to be added immediately.

| # | Required capability (as stated) | Where handled | Status |
|---|---|---|---|
| R1 | Runs as a **Windows graphical program** | §A1, §A3, §A14 | Specified |
| R2 | Runs as a **web client** | §A1, §A4, §A14 | Specified |
| R3 | One shared core, two thin shells | §A2, §A5 | Specified |
| R4 | **Find / connect to other players** | §A6.3, §A7 | Specified |
| R5 | **Multiple games** — Texas Hold'em, Omaha (PL/NL), Seven-Card Stud, Five-Card Draw, Razz | §A21 (consuming core §7.2/§7.3) | Specified |
| R6 | **Blackjack** (distinct dealerless model) | §A21.7 (planned module; core D7) | Specified; protocol model DECISION REQUIRED |
| R7 | **Dealerless / non-custodial** (no server holds the deck or decides outcomes) | §A2.2, §A8; core §3/§4 | Specified |
| R8 | **Fold without revealing cards** | §A6.5; core P5/§4.6 | Specified |
| R9 | **Micro-payments** (sub-satoshi in-game value) | §A23 (consuming core §2.2/§9.4) | Specified (flag-gated early) |
| R10 | **Transferable + revocable NFTs** (Bob owns → Alice loses access) | §A22 (consuming core §2.4/§15.7) | Specified (later track; seam exposed) |
| R11 | **FULL VM** / self-contained launch, no external services | §A14; core §10/D5 | Specified |
| R12 | **Mission-critical robustness** (NASA NPR 7150.2 + Microsoft SDL) | §A10, §A17, §A18 | Specified |
| R13 | **Documentation** deliverable | §A15 | Specified |
| R14 | **Test** deliverable (comprehensive) | §A16; Appendix IV | Specified |
| R15 | **BSV-only, post-Genesis**; no BTC; no CLTV/CSV for timing | throughout; core §6.2 | Enforced |
| R16 | **OP_RETURN banned** everywhere | throughout; core P11/§6.5 | Enforced |
| R17 | **Zero fabrication** — no computed value asserted by the author | §A0 provenance, §A19 | Enforced |
| R18 | **Author designs; Claude Code builds and runs** (author runs no code) | §A19 | Enforced |
| R19 | **TEE optional** (custody pluggable) | §A8.2, AD7 | Specified |
| R20 | **≥10,000-line, no-padding** mission-critical spec | §A20.2 (built across dense passes) | In progress; honest count reported each pass |
| R21 | Timeouts / recovery so no participant can freeze the table | §A11; core P4/§6.4 | Specified |
| R22 | Deterministic, transcript-replayable state | §A2.2, §A16.4; core §12.3 | Specified |

---

# §A1 Application overview

## §A1.1 What "running" means
"Running" is a process that (REQ-APP-001) holds keys behind a custody boundary and derives table
state only through the engine; (REQ-APP-002) sends every player action on **two paths
simultaneously** — to the network as a real BSV transaction (canonical) and directly to table
peers via the relay (speed) — per core §8.3; and (REQ-APP-003) renders the table and obtains
explicit, informed signing consent for every transaction (no silent signing; core §11.6). The two
programs differ only in how the services beneath them run and how they persist.

## §A1.2 The two programs, side by side

| Concern | Windows desktop (Tauri) | Web client |
|---|---|---|
| Services (node, relay, indexer) | Embedded, **supervised by the app** (§A3) | Remote: bundled-local (dev/regtest) or hosted (internet) (§A4) |
| Persistence | SQLite (AD9) | IndexedDB (AD10) |
| Chain access | Local node (`BS.node`) + SPV where needed | SPV-edge verification + relay/indexer projections |
| Custody isolation | Trusted process (Rust side or isolated worker) | Isolated worker; keys never reach the DOM |
| "No external services to play" | Embedded node+relay (D5/D6) | Bundled-local mode, or a hosted relay+node |
| Update | Signed installer; auto-update later (§A14) | Redeploy bundle |

## §A1.3 The product promise this layer must keep (core §1, §17, D1)
A user installs on Windows or opens the web app; creates or imports a wallet; finds other players;
sits at a heads-up NL Hold'em table on regtest; plays a full hand — entropy commit/reveal,
distributed shuffle, encrypted deal, betting streets, **fold without revealing cards**,
minimum-reveal showdown, deterministic settlement — with decision and recovery timeouts
throughout; and can export and deterministically replay the transcript. §A10's definition of done
makes this checkable.

---

# §A2 System architecture

## §A2.1 Layered view (application emphasis)
```
+------------------------------------------------------------------+
| Shells:  client-desktop (Tauri/Rust+WebView2)   client-web (Vite)|
|          thin; no business logic (core §11.1, REQ-UI-001)        |
+------------------------------------------------------------------+
| ui-core (TS/React): state, view-models, components, error bounds |  §A5
+------------------------------------------------------------------+
| app-services (TS): connection mgr, sync, custody client,          |  §A2.3
|                    timeout/observer, persistence gateway          |
+------------------------------------------------------------------+
| SDK (core §15): Session/Lobby · State engine · Ruleset · Crypto/  |
|                 deck · Tx builder · Wallet/Custody · Chain         |
+------------------------------------------------------------------+
| adapters CT/BS/VA/OB (core §2, §15.8)                            |
+------------------------------------------------------------------+
| local services: embedded BSV node (regtest, BS.node) · relay-go · |  §A3
|                 indexer-go    (desktop: supervised; web: remote)  |
+------------------------------------------------------------------+
| persistence: SQLite (desktop) / IndexedDB (web)                  |  §A13
+------------------------------------------------------------------+
```

## §A2.2 The deterministic boundary (REQ-APP-010)
The UI and app-services MUST treat the engine as a pure function (core §3.3, REQ-ARCH-001/002):
no UI code computes legality, outcomes, pot splits, or hand rankings; it calls
`getLegalActions`/`deriveState`/`validateTransition` (core §15.2) and renders the result. "Now"
enters only as an explicit parameter derived from chain/relay-anchored height/time (core §3.3,
§6.4), never from `Date.now()` for any consensus-affecting decision (REQ-APP-011). This boundary is
what makes deterministic replay (§A16.4) and cross-client agreement testable.

## §A2.3 app-services (the client-side service layer, TypeScript)
A thin layer between `ui-core` and the SDK, identical across both shells:
- **Connection manager** (§A7): owns the canonical path (to node/network) and the speed path (to
  table peers via relay); exposes one send API that fans out to both (core §8.3); manages
  presence, table-channel subscription, reconnect.
- **Sync/state deriver** (§A2.2): assembles the ordered valid-tx view from the indexer projection +
  the peer feed + locally held commit/reveal material; invokes the engine; emits state to
  view-models.
- **Custody client** (§A8): the in-process proxy to the `Custody` interface (core §9.3); requests
  `derive`/`sign`/`decryptToViewer`/`combineSignShare`; never holds raw keys in UI memory.
- **Timeout/observer** (§A11): computes timeout eligibility from anchored height/time; surfaces the
  consequence state; never advances a default itself unless it is the acting client's role
  (advancement is a transaction any peer may make, core §6.4).
- **Persistence gateway** (§A13): the single typed door to SQLite/IndexedDB; all reads/writes go
  through it; enforces the schema and redaction rules.

## §A2.4 Module/package layout (matches core §16)
`/packages/ui-core`, `/packages/app-services`, `/packages/protocol-types` (shared with core),
`/packages/sdk` (core), `/apps/client-web`, `/apps/client-desktop`, `/apps/relay-go`,
`/apps/indexer-go`, `/vm`. The application layer adds `ui-core` and `app-services`; it consumes the
rest. (REQ-APP-012: no application package may import a dependency repo directly; it goes through
the SDK/adapters, core §2.6.)

---

# §A3 Desktop runtime & supervision (Tauri)

The desktop program is a Tauri application: a **Rust supervisor** (Tauri main) plus a **WebView2**
running `ui-core`. The supervisor exists so a non-technical user double-clicks and plays.

## §A3.1 Process model
```
Tauri main (Rust supervisor)
  ├─ spawn+supervise embedded BSV node (regtest, BS.node, D6)
  ├─ spawn+supervise relay-go
  ├─ spawn+supervise indexer-go
  ├─ health checks · ordered start/stop · crash-restart
  ├─ port allocation · data-dir management
  ├─ custody-trusted operations (keys never leave this boundary)
  └─ IPC bridge  ⇄  WebView2 (ui-core)
WebView2 (ui-core, TS/React)
  ├─ all UI, engine state derivation, signing prompts
  ├─ local card decryption via the custody boundary (rendered face only)
  └─ relay/peer connections (Tier A discovery, Tier B table channel)
```

## §A3.2 Service lifecycle state machine (REQ-APP-020)
The supervisor MUST implement this lifecycle and expose it to the UI as a status stream:

| State | Entry | Exit (success) | Exit (failure) |
|---|---|---|---|
| `INIT` | app launch | config loaded → `START_NODE` | config invalid → `FATAL` |
| `START_NODE` | from INIT | node health OK → `START_INDEXER` | node fails N retries → `DEGRADED(node)` |
| `START_INDEXER` | node healthy | indexer health OK → `START_RELAY` | indexer fails → `DEGRADED(indexer)` |
| `START_RELAY` | indexer healthy | relay health OK → `READY` | relay fails → `DEGRADED(relay)` |
| `READY` | all healthy | (steady state) | any service dies → `RECOVER(service)` |
| `RECOVER(svc)` | a service died | restart OK → `READY` | restart exceeds policy → `DEGRADED(svc)` |
| `DEGRADED(svc)` | repeated failure | user/manual retry → `RECOVER(svc)` | — |
| `SHUTDOWN` | quit | reverse-order stop → `EXIT` | forced kill after timeout → `EXIT` |
| `FATAL` | unrecoverable | — | surfaces a diagnostic, no play |

REQ-APP-021: ordered startup (node → indexer → relay); reverse-order shutdown. REQ-APP-022:
restart policy is bounded (max attempts, backoff) — both `TRACKED ASSUMPTION` values the build sets
and surfaces; never an unbounded restart loop (Power-of-Ten bounded-loop discipline, §A17).
REQ-APP-023: `READY` is the only state in which the lobby permits creating/joining a table; other
states show the launch/health screen (§A6.1).

## §A3.3 IPC contract (Tauri main ⇄ ui-core) — *seam, not code* (REQ-APP-024)
Command/event families; exact signatures are Claude Code's, typed against core §15 and
`protocol-types`. Full catalog in **Appendix I**.
- `services.*` — `start`, `stop`, `status` (event stream of the §A3.2 lifecycle, per service).
- `chain.*` — pass-through to `Chain` (core §15.9): `broadcast`, `outpointStatus`, `txStatus`,
  `headers`, `conflicts` — so the UI uses one SDK surface whether the node is local or remote.
- `custody.*` — `derive`, `sign`, `decryptToViewer`, `combineSignShare` (core §15.6, §9.3): results
  only; raw key material MUST NOT cross the IPC boundary (REQ-APP-025).
- `config.*` — `runtime` (ports, network, data dir, flags), `setNetwork` (guarded by the mainnet
  flag, §A3.5).
- `diag.*` — `logs`, `metrics`, `bundleDiagnostics` (redacted, §A12.5).

REQ-APP-026: every IPC message is validated on both sides against its schema; an unrecognised or
malformed message is rejected and logged, never partially applied (fail-closed, §A11).

## §A3.4 Ports, data directory, regtest defaults
REQ-APP-027: ports are allocated and written to a runtime config the UI reads; no hard-coded ports.
REQ-APP-028: the SQLite store and the node's block/UTXO store live under a per-user data directory
with documented paths (§A13, §A15 runbook). REQ-APP-029: the embedded node defaults to **regtest**;
the network is part of the data-dir namespacing so regtest and (flagged) mainnet never share state.

## §A3.5 Mainnet flag (REQ-APP-030; core §10.5, REQ-VM-007)
Mainnet is reachable only behind an explicit, named research-code flag. The supervisor MUST refuse
any non-regtest network unless the flag is set; the UI MUST show an unmissable banner whenever the
flag is active; default everywhere is regtest. Real funds are never touched without the flag.

## §A3.6 Desktop failure modes (cross-ref §A11)
- Node won't start (port conflict, corrupt store) → `DEGRADED(node)`, diagnostic, guided recovery
  (re-init regtest store on explicit confirm).
- Relay/indexer crash mid-hand → `RECOVER`; the UI keeps the table view, marks connectivity
  degraded, and relies on the canonical path + reconnect (§A7.6); no table state is invented.
- WebView crash → supervisor restarts the WebView and the UI re-derives state from persistence +
  the transcript gap (§A7.6); no loss of truth (it lives in the tx graph).

---

# §A4 Web runtime

The web client is the same `ui-core` built by Vite and served as a static bundle.

## §A4.1 Connection modes (REQ-APP-040; core §8, D4)
- **Bundled-local** (developer/regtest): a local relay+node companion — the same node the desktop
  embeds — reached over loopback.
- **Hosted** (internet play): a deployed relay+node.
The connection manager (§A7) abstracts which is in use; switching modes MUST change no UI code
(REQ-APP-041). The default per environment is `AD-OPEN-1` (DECISION REQUIRED, §A20).

## §A4.2 Persistence (REQ-APP-042; core §11.2)
IndexedDB for keys (wrapped, §A10), table state, transcripts. `localStorage`/`sessionStorage` MUST
NOT hold load-bearing state. Schema and migration in §A13.

## §A4.3 Chain access (REQ-APP-043; core §8.4, §34)
SPV-edge verification at the wallet: headers + Merkle proofs for finality-relevant checks; relay/
indexer projections for table state; neither is trusted as the source of truth (core P3).

## §A4.4 Browser custody (REQ-APP-044; core §9.3, §11.5)
An isolated worker (Web Worker / WASM module) holds keys and performs sign/derive/decrypt; the
rendered card face exists only in the controlled viewer path; keys never reach the DOM. Backends are
pluggable (software default; threshold via `OB.custody`; TEE later).

## §A4.5 Service worker / offline (AD-OPEN-2, DECISION REQUIRED, §A20)
Whether a service worker caches the bundle for resilient reconnect is a declared open decision; if
adopted it MUST NOT cache key material or table secrets.

## §A4.6 Web failure modes (cross-ref §A11)
- Lost connection to relay/node → reconnect with backoff; the UI shows degraded connectivity and
  re-derives on reconnect (§A7.6).
- IndexedDB quota/eviction → the transcript and keys are re-fetchable/re-derivable; the client warns
  and resyncs; no silent data loss of load-bearing state (REQ-APP-045).
- Tab close/refresh mid-hand → on return, rebuild from persistence + transcript gap (§A7.6).

---

# §A5 Shared UI core (one core, two shells)

One TypeScript/React core (core §11.1, §3.2), package `/packages/ui-core`, consumed by both shells.

## §A5.1 State management (REQ-APP-050)
A single unidirectional store. Inputs: engine-derived `tableState` (§A2.2), connection status,
custody/signing status, persistence. The store holds **no** business logic; reducers only project
SDK/engine outputs into render state. No direct mutation; no derived game truth computed in the UI.

## §A5.2 View-model contracts (REQ-APP-051)
One view-model per screen (§A6), each a pure projection `(engineState, connStatus, custodyStatus,
config) → ScreenProps`. View-models are unit-tested in isolation (§A16.2). Components are
presentational and stateless beyond local UI ephemera.

## §A5.3 Component inventory (REQ-APP-052)
Catalogued, each with props, states (loading/empty/error/ready), and a test obligation (Appendix
IV): Lobby list, Table-create form, Seat ring, Board/up-card row, Pot/side-pot display, Action bar
(check/bet/call/raise/fold/draw/stand), Bet sizer (NL/PL/FL aware via the betting interface, core
§5.4), Timer + consequence banner, Hand viewer (custody-bound), Signing modal, Showdown panel,
Settlement summary, Reconnect/recovery banner, Transcript/replay viewer, Mainnet banner.

## §A5.4 Interaction & rendering rules (REQ-APP-053)
Explicit handlers only (`onClick`/`onChange`); **no** HTML `<form>` submit (core §11.3,
REQ-UI-003). Every screen defines its loading/empty/error states. React error boundaries wrap each
screen so a render fault degrades one screen, not the app (§A11). No business decision is taken in
an event handler; handlers call app-services/SDK and render the result.

## §A5.5 Accessibility & internationalisation (REQ-APP-054; expanded in §A6 per screen)
Keyboard-operable controls, ARIA roles/labels on all interactive elements, visible focus, sufficient
contrast, no information conveyed by colour alone (suits also carry a glyph/letter — and never a
suit-precedence implication, core §5.5.1), screen-reader announcements for turn/timer/consequence
changes, and a string-externalisation layer for i18n (English first). Accessibility is a tested
acceptance item (§A16.8), not a nicety.

---

# §A6 Screen specifications

For each screen: **purpose**; **state read** (from the engine/app-services); **actions emitted**
(each a signed transaction built via the SDK, core §15.5/§6); **consequence text** (core §11.4 — the
UI hides complexity, never consequences); **signing prompt** (core §11.6 — action, amounts, affected
pot/state, exact bytes/intent; no silent signing); **edge states** (loading/empty/error/degraded);
**accessibility**. The Screen × action × SDK matrix is Appendix II.

## §A6.1 Launch / Health
- Purpose: show the stack coming up (desktop: §A3.2 lifecycle per service; web: connection to
  relay+node), gate play until `READY`.
- State read: `services.status` (desktop) / connection status (web).
- Actions: none on-chain; control only (retry, view diagnostics).
- Consequence text: "Starting local node…", "Reconnecting (attempt n)…", "A service is degraded —
  play is paused until it recovers."
- Edge states: degraded/fatal show a guided-recovery affordance and `diag.bundleDiagnostics`.
- A11y: status announced via an ARIA live region.

## §A6.2 Wallet (create / import)
- Purpose: establish identity and custody backend (core §9).
- State read: custody backend + key presence (no raw keys in UI).
- Actions: none on-chain; key operations are custody-trusted (§A8); import/create flow.
- Consequence text: seed-handling warning; "your keys never leave this device's secure boundary"
  (bounded by §A10's stated trust surface — software custody trusts the device; say so).
- Edge states: import validation errors fail closed.
- A11y: secret entry is keyboard-only, never logged, never announced.

## §A6.3 Lobby
- Purpose: find players; list/create/join tables; presence (core §8, §15.1).
- State read: presence + table list from the relay (transport/index only, core P3) — treated as a
  hint, not truth.
- Actions: `createTable`, `joinTable` (core §15.1); join/funding is a signed transaction (core §6.1
  Funding / Table-mgmt). Signing prompt states the stake locked and the refund-on-abort path.
- Consequence text: "Joining locks your stake; if the table aborts before play, it refunds via the
  pre-signed path."
- Edge states: empty lobby; relay unreachable (offer LAN mode / retry); stale presence is reconciled
  on refresh.
- A11y: table list is a navigable list with labelled join controls.

## §A6.4 Table create / config
- Purpose: choose variant, betting structure (NL/PL/FL), seats, blind/ante schedule, timeout profile;
  display the hashed config.
- State read: ruleset validation (core §15.3); the **computed `rulesetHash`** (core §5.2,
  REQ-POKER-002) — produced by the engine/SDK, displayed to all players, never computed by the UI.
- Actions: `TABLE_CREATE` bound to `gid`+`rulesetHash` (core §6.3).
- Consequence text: "This configuration is hashed and bound into every transaction; it cannot change
  mid-hand."
- Edge states: invalid ruleset blocks creation with a specific message.
- A11y: form controls labelled; the displayed hash is selectable text.

## §A6.5 Table view (the core gameplay screen)
- Purpose: play the hand.
- State read: seats, whose turn, community/up cards, pot(s) and side pots, balances, timers, and the
  **default-on-timeout** text for the acting state (core §11.4, §19.E). Multi-way side pots come from
  the engine (core §5.5, §19.B); the UI never computes them.
- Actions (each a signed transaction; core §5.4, §6.1 Action): `check`/`bet`/`call`/`raise`;
  **fold without reveal** (core P5, §4.6, §6.6 Fold); `draw`/`stand` where the variant has it (core
  §7.3). Bet sizing respects the active betting structure via the interface (core §5.4).
- Consequence text (must be exact, core §11.4): e.g. "If you do nothing, you check in 30s"; "If you
  do nothing while facing a bet, you fold in 30s — you are never forced to wager"; "Revealing the
  flop needs every player; if someone withholds, the hand goes to recovery."
- Board reveals: shown as **N-of-N cooperative transitions with a timeout-default** (core §4.6 M2);
  the UI shows the cooperative-release progress and the recovery default — it does not present a
  board reveal as a unilateral "publish."
- Edge states: not-your-turn (controls disabled, clearly); opponent timing out (countdown to
  default); connectivity degraded (banner; canonical path still authoritative).
- Signing: every emitted action raises the signing modal (§A6.7).
- A11y: turn changes, timers, and consequences announced; action controls keyboard-operable with
  clear enabled/disabled semantics.

## §A6.6 Hand inspection (private)
- Purpose: the player sees their own concealed cards.
- State read: local decryption **through the custody boundary** (core §11.5, §A8) — the rendered
  face exists only in the controlled viewer path; keys never reach the UI process beyond it.
- Actions: none.
- Edge states: decryption unavailable (custody backend not ready) → explicit, no fake card.
- A11y: card faces have text equivalents (rank+suit) for screen readers, in the viewer path only.

## §A6.7 Signing prompt (modal, cross-screen) (REQ-APP-060; core §11.6)
- Purpose: explicit, informed consent for every transaction.
- Shows: the action; amounts; the pot/state affected; and the exact intent/bytes being signed.
- No silent signing anywhere; no "remember my choice" that would auto-sign value-moving actions.
- Edge states: user declines → action not emitted, state unchanged; signing fails (custody error) →
  explicit failure, fail-closed.
- A11y: modal is focus-trapped, fully keyboard-operable, content announced.

## §A6.8 Showdown / settlement
- Purpose: minimum-reveal showdown and deterministic settlement.
- State read: who must reveal what (core §5.6); the settlement result and final balances (core §5.7,
  §19.B) — from the engine.
- Actions: Reveal transactions (core §4.6, §6.6), then the close-out/settlement spend (core §6.6).
- Consequence text: "Only contenders reveal, and only what's needed to decide the pot."
- Edge states: a contender withholds reveal → recovery timeout path shown (core §6.4).
- A11y: revealed hands and the award are announced.

## §A6.9 Reconnect / recovery
- Purpose: rejoin a live table; show recovery state.
- State read: transcript gap from a peer/relay; engine rebuild (core §8.6, REQ-NET-007); any
  recovery/timeout in progress (core §6.4).
- Actions: request gap; resume.
- Consequence text: "Rebuilding the table from the transaction record — your view is being restored;
  the table's truth never depended on this device."
- A11y: progress announced.

## §A6.10 Transcript / replay viewer
- Purpose: export and offline deterministic replay (core §12.2/§12.3).
- State read: the transcript (ordered valid tx set + commit/reveal material).
- Actions: export; step/replay.
- Note: replay is the **engine** reconstructing the hand byte-identically (core §12.3,
  REQ-DATA-003); the viewer renders the reconstruction. Verifying byte-identity is a build-run check
  (§A16.4), not a UI computation.
- A11y: replay controls keyboard-operable; each step's state announced.

---

# §A7 Discovery, lobby, matchmaking, connection

Per core §8 and decision D4. The application consumes the networking contracts; it does not redefine
the protocol.

## §A7.1 Roles & trust (REQ-APP-070; core §8.1, P3)
The relay is **transport + indexing only and never the source of truth**. The client derives state
independently and detects a lying/faulty relay by reconstructing from the valid transaction set. The
indexer provides projections for convenience; the client treats them as hints to be confirmed.

## §A7.2 Discovery (Phase 1) (REQ-APP-071; core §8.2, D4)
Two mechanisms: a hosted **relay** (presence, table discovery, direct-message fan-out) and **LAN
auto-discovery** (zero-server same-network play). The lobby (§A6.3) consumes both. The client MUST
function in LAN mode with no internet relay.

## §A7.3 Table-scoped channel (REQ-APP-072; core §8.2 Tier B)
On join, the client subscribes to the table's inventory/object channel (inv/getdata/object,
Bitmessage-style) for fast convergence; it publishes its actions there (speed path) in addition to
broadcasting them (canonical path).

## §A7.4 Dual-path send (REQ-APP-073; core §8.3, REQ-NET-003)
Every action is sent **simultaneously** to the network as a real transaction and to table peers via
the relay/channel. The speed path never overrides the canonical path; conflicts resolve by the
deterministic rules (core §8.5). The connection manager implements both and reconciles.

## §A7.5 Conflict surfacing (REQ-APP-074; core §8.5)
For each actionable phase there is exactly one spendable phase-right; conflicting attempts cannot
both be valid. The client follows the accepted successor (the one referenced by the next accepted
state transition) and surfaces a transient "resolving" state if a conflict is observed before phase
close; a double-spend attempt is made strategically useless by the timeout-default (core §8.5,
§6.4). The UI never guesses a winner; it shows what the engine accepts.

## §A7.6 Reconnect / resume (REQ-APP-075; core §8.6)
On connect/reconnect the client requests the transcript gap from a peer/relay and rebuilds current
state deterministically from the valid tx set; resuming changes nothing about the truth, only this
client's view. Backoff and retry bounds are `TRACKED ASSUMPTION` values the build sets.

## §A7.7 Phase-5 abstraction (REQ-APP-076; core §8.7)
Internet P2P + NAT traversal (version/verack/getaddr/addr peer layer) is a later track; the
connection manager MUST be built so relay-discovery can be replaced by the peer layer **without UI
change**. Declared now so Phase 1 does not bake the relay in as permanent truth.

---

# §A8 The seam to the protocol core (SDK consumption + custody boundary)

The client implements **no** cryptography, transaction construction, or game logic; it consumes the
SDK (core §15.1–§15.9), backed by the core and the adapters `CT/BS/VA/OB` (core §2, §15.8).

## §A8.1 Action → SDK mapping (REQ-APP-080; full matrix Appendix II)
Illustrative; the complete mapping is the build's, against core §15:
- Bet: `getLegalActions` (§15.2) → `buildAction` (§15.5) → `custody.sign` (§15.6) → dual-path send
  (§A7.4).
- Fold: `buildFold` (§15.5) → sign → send.
- Board reveal: an N-of-N cooperative transition (core §4.6); the UI shows cooperative-release +
  recovery default; the SDK/engine handle the crypto.
- Settlement: Reveal txs (§4.6, §6.6) then the close-out spend (§6.6); the engine computes the award.

## §A8.2 Custody boundary (REQ-APP-081; core §9.3, §11.5)
Card decryption and signing happen behind the `Custody` interface (`derive`, `sign`,
`decryptToViewer`, `combineSignShare`). Desktop: trusted custody on the Rust side or an isolated
worker (§A3.1). Web: an isolated worker. The UI receives a rendered face via the viewer path only;
raw keys never cross to the DOM. Backends pluggable (software default AD7; threshold `OB.custody`
FROST/GG20; TEE optional, later).

## §A8.3 Signing-mode surfacing (REQ-APP-082; core §4.3, D9)
The active signing mode (A: reconstruct-at-reveal, Phase-1 default; B: threshold/no-reconstruction)
is recorded in the ruleset; the UI surfaces the **actual** key-handling guarantee wherever it is
shown (core REQ-CRYPTO-008, P8). The UI MUST NOT claim Mode B's "no whole key" property while Mode A
is active.

## §A8.4 Audit-output boundary (REQ-APP-083; core §2.3 INV-VA-2)
Where the client shows `VA`-backed audit/selective-disclosure output, it surfaces the stated
boundary — inclusion/integrity/selective-disclosure/arithmetic only, **not** truth-at-origin — and
must not overstate it (P8).

---

# §A9 Non-functional requirements

All numeric targets here are **design targets** marked `TRACKED ASSUMPTION`: Claude Code MUST meet
**and measure** them (§A16.7); this document asserts no achieved value.

## §A9.1 Performance / latency (REQ-APP-090)
- Local action round-trip (UI action → signed → on speed path to peers): target `TRACKED
  ASSUMPTION` (e.g. ≤150 ms on the reference desktop) — measured by the build.
- UI frame budget for table render: target `TRACKED ASSUMPTION` (e.g. 60 fps / ≤16 ms) under a
  full 9-seat table.
- State derivation from a transcript of N transactions: target `TRACKED ASSUMPTION`, bounded and
  linear in N (no quadratic blow-up) — a property the build profiles.

## §A9.2 Reliability / availability (REQ-APP-091)
- No table can be frozen by one absent/malicious participant (core P4); the timeout-default path
  guarantees progress. The client surfaces this, never blocks on a peer indefinitely.
- Service supervision (desktop) maintains availability with bounded restart (§A3.2); degraded states
  are explicit, not silent.

## §A9.3 Resource limits (REQ-APP-092)
- Bounded working memory in the state-derivation hot path (Power-of-Ten adaptation, §A17): pre-sized
  structures, no unbounded allocation per action. Target ceilings `TRACKED ASSUMPTION`.
- Persistence growth (transcripts) bounded with retention policy (§A13).

## §A9.4 Capacity (REQ-APP-093)
- Seats 2–9 (core D2); Phase 1 fixed at 2; the UI and state model MUST handle the full envelope
  without redesign (multi-way side pots, ordering).
- Concurrent tables per client: `TRACKED ASSUMPTION`; the connection manager multiplexes channels.

## §A9.5 Portability (REQ-APP-094)
- Desktop: Windows (primary; the installer target). The shared core is OS-agnostic; macOS/Linux
  desktop are out of scope for Phase 1 but the Tauri choice does not preclude them.
- Web: current evergreen browsers; no reliance on non-standard storage (AD10).

---

# §A10 Security architecture (Microsoft SDL-aligned)

Security is designed in, not bolted on. The application layer's trust surface is a refinement of the
core's enumerated trust surface (core §18.6); it adds nothing the user must trust beyond it, and
states plainly what it does.

## §A10.1 The application trust surface (REQ-APP-100; refines core §18.6)
A correct user on an uncompromised client trusts, at the application layer, exactly:
1. the device/OS and the local secure storage the custody backend uses (software custody = device
   trust; stated plainly, not hidden);
2. the integrity of the signed installer / served bundle (supply-chain, §A10.6);
3. the isolation of the custody boundary (keys never reach the DOM; §A8.2);
all on top of the core's cryptographic and consensus trust surface (core §18.6). "Trustless" is used
nowhere unconditionally (P8); prose says the specific property meant.

## §A10.2 Key & secret handling (REQ-APP-101)
Keys live only inside the custody boundary (Rust side / isolated worker). At rest they are wrapped
(AEAD; never plaintext on disk; never `localStorage`). They never appear in logs, metrics, IPC
payloads, or the DOM (§A12.5 redaction). Per-game/per-card scalars are single-game in Mode A (core
§9.2, §4.3) and the UI surfaces that.

## §A10.3 The viewer/decryption boundary (REQ-APP-102; core §11.5)
Decryption goes through `decryptToViewer`; the rendered face exists only in the controlled viewer
path. Screen-capture hardening/watermarking is an **optional later track** claimed only as partial
mitigation (core §11.5, P8) — never claimed as protection against a compromised client.

## §A10.4 Input validation & fail-closed (REQ-APP-103)
Every input crossing a trust boundary — IPC messages, relay/peer messages, persisted records,
SDK results — is validated against its schema; invalid input is rejected and logged, never partially
applied. The default on any ambiguity is to **not** act (fail-closed). Negative paths are tested
(§A16.6).

## §A10.5 Threat-informed design (REQ-APP-104; cross-ref core §18)
The application layer inherits the core threat model (core §18) and adds app-specific entries (each
with a bounding mechanism and an honest residual): malicious relay (bounded by P3 + canonical path,
residual = liveness degradation), key extraction from a compromised device (bounded by custody
boundary/threshold/TEE, residual = device-trust in software mode — stated), hand-view leakage on a
compromised client (residual = unpreventable by protocol, partial mitigation only), tampered
installer/bundle (bounded by signing + reproducible build, §A10.6), and malicious input on any
boundary (bounded by §A10.4). These are catalogued in Appendix III/§A18 alongside the core's `THR-*`.

## §A10.6 Supply chain & integrity (REQ-APP-105)
The installer is signed; the build is reproducible with pinned toolchains, locked lockfiles, and
recorded artifact hashes (core §10.4, §16; §A14). Dependencies are pinned; a dependency change is an
explicit, reviewed event. The build runs supply-chain checks (§A16.9) — Claude Code's task.

## §A10.7 Network exposure (REQ-APP-106)
The desktop binds local services to loopback by default; any non-loopback exposure is explicit and
flagged. The relay client authenticates table membership per the core's protocol; presence does not
leak hand information.

---

# §A11 Error handling, failure modes, degraded operation, recovery

## §A11.1 Error taxonomy (REQ-APP-110; codes in Appendix III)
Errors are typed and carry a stable code, a user-facing message, a remediation, and a severity
(`FATAL`/`DEGRADED`/`RECOVERABLE`/`USER`). Categories: configuration, service-lifecycle (desktop),
connectivity, custody/signing, protocol/validation (a rejected/invalid transaction or state),
persistence, and UI/render. No error is swallowed; every error path has a defined UI state.

## §A11.2 Fail-closed principle (REQ-APP-111)
On any ambiguity affecting value or state, the client does **not** act: it does not emit a
transaction, does not advance state, and surfaces the condition. Silent best-effort guessing is a
defect.

## §A11.3 Degraded operation (REQ-APP-112)
The app distinguishes "playable", "degraded" (e.g. relay down but canonical path alive — play
continues with a banner; reconnect runs), and "paused" (e.g. node down on desktop — play gated until
recovery). Each is explicit and announced (§A12, §A5.5).

## §A11.4 Recovery paths (REQ-APP-113; core §6.4)
Every stall has a path: decision timeout (default check-or-fold, never a forced wager), recovery
timeout (withheld reveal / stalled settlement), and reconnect-by-transcript (§A7.6). The client
surfaces the consequence and the countdown; advancement of a timeout-default is a transaction any
peer may submit (core §6.4) — the client does so when it is its role.

## §A11.5 No-stranded-value invariant (REQ-APP-114; core P4)
The UI never presents a state in which value can be stranded outside the legal exits (cooperative
advance, action, fold, reveal, timeout, refund, win-claim, close). If the engine reports such a
state it is a defect surfaced as `FATAL`, not hidden.

---

# §A12 Observability

## §A12.1 Logging (REQ-APP-120)
Structured, levelled logs (debug/info/warn/error), per component, with correlation IDs (table/round/
action). Logs are local by default; export is explicit and redacted (§A12.5).

## §A12.2 Metrics (REQ-APP-121)
Counters/gauges/histograms for: service health and restarts (desktop), connection state and
reconnects, action round-trip latency, derivation time, signing latency, error counts by code. These
feed the NFR measurements (§A9, §A16.7) — Claude Code runs the measurement.

## §A12.3 Tracing (REQ-APP-122)
A trace per player action across app-services → SDK → send (both paths) → acceptance, for diagnosing
convergence and timeout behaviour.

## §A12.4 Audit / transcript (REQ-APP-123; core §12)
The transcript (ordered valid tx set + commit/reveal material) is the authoritative audit record;
the observability above is operational and never a substitute for it.

## §A12.5 Redaction (REQ-APP-124)
Logs, metrics, traces, and diagnostic bundles MUST NOT contain key material, decrypted card faces, or
seed/reveal secrets. A redaction layer enforces this; its correctness is tested (§A16.6). Diagnostic
export is opt-in and redacted.

---

# §A13 Client persistence & data model

## §A13.1 Stores (REQ-APP-130; core §11.2, §12.1)
Desktop: SQLite. Web: IndexedDB. One typed persistence gateway (§A2.3) is the only access path.

## §A13.2 Entities (REQ-APP-131)
Tables, players, transactions (the transcript), card lineage (minted→drawn→revealed|folded→
discarded, core §4.3), timeouts, proofs/commit-reveal material, and local **wrapped** key/custody
state. Schemas are defined byte/field-precisely in the build against `protocol-types` and core §19.A
canonical serialization (the canonical serialization itself is owed in the core spec, core §19.A).

## §A13.3 Integrity & migration (REQ-APP-132)
Persisted records are validated on read (§A10.4); a corrupt record is quarantined, not trusted.
Schema versions are explicit; migrations are forward-only with a recorded version and a test
(§A16.6). Load-bearing state (transcript, keys) is never silently lost; it is re-derivable/re-
fetchable (§A4.6).

## §A13.4 Retention (REQ-APP-133)
Transcript retention policy is a `TRACKED ASSUMPTION` (e.g. keep N hands / configurable); export
before prune is offered. Keys persist until explicitly removed.

---

# §A14 Packaging, build, CI/CD, reproducibility, release

## §A14.1 Targets (REQ-APP-140; core §10.3, §16)
- Desktop: a **signed Windows installer** (Tauri) embedding/supervising node+relay (core
  REQ-VM-004).
- Web: the static Vite bundle + a hosted relay+node deployment (or bundled-local dev).
- The **self-contained image** (D5): a reproducible container bundling node(regtest)+relay+client +
  a one-command bootstrap that brings the stack up, runs self-tests, and prints a transcript
  (core §10.2/§10.3). Optional literal OVA/qcow2 (AD-OPEN-4).

## §A14.2 CI/CD stages (REQ-APP-141; core §16, run by Claude Code)
Typecheck (`tsc --strict`, Go `vet`/`-Werror`-equivalent) → lint (Power-of-Ten ruleset) →
unit+property (§A16.2/§A16.3) → **interpreter-level script tests, Genesis rules** (§A16.5) →
integration (§A16.3) → build the self-contained image → **E2E inside the image** (§A16.4) →
`reproduce` (§A16.7) → accessibility & security checks (§A16.8/§A16.9) → traceability check
(§A18.2). A red stage blocks merge. **Claude Code runs all stages; the author specifies them.**

## §A14.3 Reproducibility (REQ-APP-142; core §10.4)
Pinned toolchains, locked lockfiles, recorded artifact hashes; the image build and `reproduce` run
in CI. Reproducibility is an acceptance item (§A18.3).

## §A14.4 Release & update (REQ-APP-143)
Releases (Windows installer signed, web bundle, image) come from the **same commit** with recorded
hashes. Desktop auto-update is a later track (AD-OPEN-5).

---

# §A15 Documentation standard (what the build must produce and maintain)

Mission-critical means the documentation is a deliverable with its own obligations. Claude Code MUST
produce and keep current (REQ-APP-150):
- **API documentation** for `ui-core`, `app-services`, and the IPC contract (Appendix I), generated
  from typed sources, never hand-drifted.
- **Architecture Decision Records (ADRs)** for each AD/AD-OPEN here and any made during build; an ADR
  states context, decision, status, consequences. (This satisfies the "no hidden assumptions" rule
  in the build, mirroring this spec's declared-decision tables.)
- **Runbooks** for the desktop supervisor (start/stop, data-dir, recovery, log/diagnostic export) and
  the hosted web deployment.
- **User documentation** for install, wallet create/import, finding players, playing a hand, reading
  consequence/timeout text, and transcript export/replay.
- **Test documentation** — the test plan, the test-case catalog (Appendix IV realised), and the
  traceability matrix (§A18) — kept in lock-step with the suites.
- **Security documentation** — the trust surface (§A10.1), the threat entries (§A10.5), and the
  redaction rules (§A12.5).
REQ-APP-151: documentation is versioned with the code, reviewed in the same pass, and CI fails if
generated docs are stale relative to their sources.

---

# §A16 Verification & validation — test architecture and full test specification

This is the **test design**: what must be tested, how, and the acceptance. **Claude Code builds and
runs every test; the author runs none.** Negative tests where a transaction/script is involved MUST
fail **inside the real BSV Script interpreter** with Genesis rules — never in a wrapper guard, never
a signature spot-check (core §14.3, P9).

## §A16.1 Test levels (REQ-APP-160)
Unit → property-based → integration → **interpreter-level script** → end-to-end (E2E) → adversarial/
fault-injection → performance → security → accessibility. Every level maps to CI stages (§A14.2) and
to acceptance gates (§A18.3). Coverage targets are `TRACKED ASSUMPTION` the build measures and
reports; coverage is necessary, not sufficient (a passing suite that doesn't exercise the behaviour
is rejected, P9 spirit).

## §A16.2 Unit tests (REQ-APP-161)
Pure units: view-models (§A5.2) as `(state…) → props` projections; reducers; the persistence
gateway's encode/decode; the redaction layer; consequence-text selection per acting state. Each
component (§A5.3) has loading/empty/error/ready render tests. Specs catalogued in Appendix IV.

## §A16.3 Property-based & integration tests (REQ-APP-162)
- Property: determinism — the same ordered valid-tx set + ruleset yields byte-identical derived state
  across runs and across the two shells (core §14.2, REQ-TEST-002); reconnect-from-gap yields the
  same state as continuous play; the UI never enables an illegal action for a given engine state.
- Integration: `ui-core` + `app-services` + SDK with **conformance-bound** fakes for CT/BS/VA/OB —
  i.e. a single contract-conformance suite both the fake and the **real** adapter pass (core §2.6
  REQ-DEP-003/004), so a green run against the fake cannot certify a wrong engine. Security-critical
  paths (shuffle, reveal single-use, fair-play, signing) are tested against the **real**
  implementations, never fakes (core REQ-DEP-004).

## §A16.4 Determinism & replay tests (REQ-APP-163; core §12.3, §14.2)
A transcript replays to byte-identical state offline; any divergence is a defect. Cross-client
agreement: two engines (desktop and web builds) given the same valid tx set + ruleset agree exactly.
Claude Code runs these; the author specifies the equivalence and the corpus.

## §A16.5 Interpreter-level script tests (REQ-APP-164; core §14.3, P9)
For every script template the app causes to be spent (funding, action, fold, reveal-or-timeout,
settlement, fair-play, optional TTP — core §6.6), positive spends are accepted and a battery of
negative spends fails **inside** the real interpreter with Genesis rules. The app layer's obligation
is to ensure its flows only ever construct spends that the interpreter accepts on the happy path and
that every UI-reachable malformed attempt is caught by the interpreter, not by UI guards. **Claude
Code runs the interpreter; the author specifies the cases.**

## §A16.6 Robustness / negative / fault-injection tests (REQ-APP-165; core §14.6)
Disconnect at every phase; stale/duplicate action; timeout races; withheld reveal (player and
board); conflicting spends; mempool eviction + resubmission; corrupt persisted record; malformed IPC/
relay/peer message; custody/signing failure; WebView/tab crash mid-hand; node/relay/indexer crash on
desktop. Each maps to a `REQ-*` and a deterministic expected UI+state outcome (fail-closed, recover,
or default). Redaction is fault-tested (no secret ever appears in logs/metrics/traces/exports).

## §A16.7 Performance tests (REQ-APP-166; §A9)
The build **measures** the §A9 targets (action round-trip, frame budget, derivation time vs N,
memory ceilings) on a reference machine and records them as reproducible numbers via `reproduce`
(core §14.5, P10). The author does not produce these numbers; the build does.

## §A16.8 Accessibility tests (REQ-APP-167; §A5.5)
Automated a11y checks (roles/labels/contrast/focus) plus scripted keyboard-only and screen-reader
walkthroughs of every screen; turn/timer/consequence announcements verified. Accessibility is a gate
(§A18.3), not optional.

## §A16.9 Security tests (REQ-APP-168; §A10)
Custody-boundary tests (no key crosses IPC/DOM/logs); fail-closed input-validation tests on every
boundary; supply-chain checks (pinned deps, reproducible build, artifact-hash verification);
installer-signature verification. Run by Claude Code.

## §A16.10 End-to-end / acceptance (REQ-APP-169; core §14.4, §14.7)
A scripted full heads-up Hold'em hand runs through the self-contained image on regtest: setup →
shuffle → deal → betting streets → showdown/settlement, plus the §A16.6 fault injections, all
producing reproducible transcripts — on both the desktop build and the web build. This is the
Phase-1 acceptance E2E (§A10/§A18.3).

---

# §A17 Engineering-standard mapping

Mission-critical practice, **honestly mapped** to a GC TypeScript/Go application (no overclaim).

## §A17.1 NASA NPR 7150.2 (REQ-APP-170)
Adopted as software-assurance **practice**: requirements with traceability (§A18), design before
build (this document), reviews (red-team each pass, §A20), verification obligations (§A16),
configuration management and reproducible builds (§A14). Claimed as "NPR 7150.2 assurance practice,"
not certification.

## §A17.2 JPL Power-of-Ten — adopted / adapted / N-A (REQ-APP-171; mirrors core §13.1)
- **Adopted:** simple control flow, no recursion in consensus/state-derivation paths; every loop in
  those paths bounded with a provable upper bound; runtime assertions on module boundaries; check
  every return/error; small single-purpose functions; warnings-as-errors (`tsc --strict`, Go
  `vet`).
- **Adapted:** "limit data scope" → no untyped `any` in the core; exhaustive `switch` with
  compile-time exhaustiveness; strict null checks. "Limit the preprocessor" → restrict
  metaprogramming/codegen; document any that remains.
- **N-A in a GC runtime (stated, not dropped):** rule 3 (no dynamic allocation after init) and the
  raw-pointer/aliasing rules have no literal meaning under garbage collection; in their place the
  state-derivation hot path uses bounded, pre-sized working structures and avoids unbounded
  allocation. Claimed as "a Power-of-Ten **adaptation**," never literal compliance.

## §A17.3 Microsoft SDL (REQ-APP-172)
Adopted as security practice: threat-informed design (§A10.5), secure defaults (regtest, loopback,
fail-closed), least privilege (custody boundary, key isolation), input validation on every boundary,
supply-chain integrity (signed installer, reproducible build), and security testing in CI (§A16.9).

## §A17.4 Boundary-in-source (REQ-APP-173; core §13.4)
Every stated boundary/limit here (the trust surface §A10.1, the audit boundary §A8.4, fail-closed
§A11.2, redaction §A12.5, regtest-default §A3.5) is asserted in the build's source so no future
change silently papers over it.

---

# §A18 Requirements register, traceability, acceptance gates

## §A18.1 Register (REQ-APP-180)
Every `REQ-APP-*` in this document is an entry in a machine-readable register
(`/spec/app-requirements.yaml`) with: id, text, owning module (§A2–§A8), verification method (the
§A16 level), and status. The register is generated/validated in CI and kept in lock-step with the
unique `REQ-APP-*` count (a mismatch is a defect). It never double-defines a core requirement; an
app requirement that refines a core one cites it (e.g. REQ-APP-030 refines core REQ-VM-007).

## §A18.2 Traceability matrix (REQ-APP-181)
Every requirement → owning module → test(s) → acceptance gate. CI fails if any requirement has no
verifying test or any application source file in a consensus/security path is untraced
(mirrors core §13.3).

## §A18.3 Acceptance gates (REQ-APP-182)
A phase is accepted only when: every requirement for that phase traces to passing tests; `reproduce`
is green inside the image; the phase's adversarial, accessibility, and security tests pass; the phase
E2E (§A16.10) runs clean on both desktop and web builds; and the documentation set (§A15) for that
phase is current. No phase advances on a green-looking test that does not exercise the behaviour
(P9 spirit).

## §A18.4 The practical definition of done (REQ-APP-183)
The application spec is complete when Claude Code can build Phase 0 and Phase 1 **without asking a
further application design question**, every `REQ-APP-*` is registered and traced, every NFR/
performance/security/accessibility obligation is measured by the build (or carries a justified
`TRACKED ASSUMPTION` pending the build's run), and the documentation set is produced and current.

---

# §A19 Division of labour — author (how-to) vs Claude Code (build/run)

The rule, made concrete and binding. **The author writes the how-to and runs nothing.** Claude Code
builds and runs everything.

| Task | Author (this document) | Claude Code |
|---|---|---|
| Architecture, contracts, screen/IPC specs | Writes | Implements |
| Hand-eval vectors (core §19.D) | States cases + properties | **Runs** the oracle; embeds verified output |
| Script byte schedules + fair-play size (core §19.C) | States the templates + scaling question + fallback rule | **Constructs scripts, measures** through the interpreter |
| Interpreter-level tests (§A16.5) | States which spends + negatives | **Runs** the real interpreter (Genesis) |
| Canonical-serialization example (core §19.A) | States layout + the worked-example requirement | **Runs** the serializer; shows bytes + hash |
| Performance numbers (§A9/§A16.7) | States targets as `TRACKED ASSUMPTION` | **Measures** on the reference machine |
| Installer / web bundle / image (§A14) | States targets + acceptance | **Builds**; records hashes |
| E2E + adversarial + a11y + security (§A16) | States scenarios + gates | **Runs** all of them |
| `reproduce` (§A16.7) | States what must be regenerable | **Runs** it; non-zero on mismatch |
| Documentation (§A15) | States the doc set + standard | **Generates/maintains** it |

If a step requires running code, it is in the right-hand column. The author does not enter it.

---

# §A20 Open decisions and the remaining-passes plan to ≥10,000 lines

## §A20.1 Open application-layer decisions (declared, not hidden)
- **AD-OPEN-1** Web connection default per environment (bundled-local vs hosted). DECISION REQUIRED.
- **AD-OPEN-2** Service worker / offline shell for the web client. DECISION REQUIRED.
- **AD-OPEN-3** Desktop custody process boundary (Rust side vs isolated worker); both keep keys off
  the DOM. DECISION REQUIRED; default leans Rust-side.
- **AD-OPEN-4** Literal VM image (OVA/qcow2) in addition to the container. DECISION REQUIRED; does
  not change the architecture.
- **AD-OPEN-5** Desktop auto-update. Later track.
The protocol-layer `DECISION REQUIRED` items (reveal-token core §4.6; Mode-B signing core §6.7) stay
in the core spec and do not block Phase 1 (Mode A).

## §A20.2 Honest status and the path to ≥10,000 lines (no padding)
This pass establishes the full structure (§A0–§A19 + §A21–§A23 + Appendices), fills it to
mission-critical depth at the section level, and adds the **multi-game platform architecture**
(§A21: all poker variants + Blackjack as game modules), the **NFT/revocation** (§A22) and
**micro-payment** (§A23) integration seams, and the **required-capability coverage matrix** (§A0.5)
mapping every stated requirement to where it is handled. Remaining depth is filled across the
passes below — dense, no padding. The ≥10,000-line target is
reached across the following **dense, non-padded** passes — each adds real content, each red-teams
its own additions (BLOCKER/MAJOR/MINOR + fix + verdict), each logged here:

- **Pass A2 — Appendices realised (DONE this pass).** Appendix I (IPC command/event catalog with
  message schemas, trust-boundary rules, and error sets), Appendix II (the Screen × action × SDK-call
  matrix across screens and variants), Appendix III (the error-code catalog with message/remediation/
  severity/test), Appendix V (the configuration catalog), Appendix VI (glossary). Appendix IV realised
  to its **core set** (resolving every TC-* referenced in Appendix III); per-case expansion completes
  in Pass A5.
- **Pass A3 — Screen specs to component-and-state-machine depth.** Each screen (§A6) expanded to a
  full state machine (states, transitions, guards, events, edge/empty/error/loading), wireframe-level
  layout description, the exact view-model prop contract, and the per-screen test specifications
  (Appendix IV) — for all nine seats and all five variants' table views.
- **Pass A4 — app-services to interface-contract depth.** The connection manager, sync/deriver,
  custody client, timeout/observer, and persistence gateway each given a full interface contract
  (operations, inputs/outputs, error semantics, invariants) and a behavioural state machine.
- **Pass A5 — Test specification to per-case depth (Appendix IV realised).** Every test case from
  §A16 written as a spec (id, level, preconditions, steps, expected, the requirement it verifies),
  including the full adversarial/fault-injection matrix and the determinism/replay corpus definition.
- **Pass A6 — Desktop supervisor and web runtime to implementation-contract depth.** The IPC contract
  fully enumerated; the lifecycle, health, restart-policy, and recovery flows specified to the level
  Claude Code builds without a further question; the web connection/persistence/worker-custody flows
  likewise.
- **Pass A7 — Security and observability to control-and-event depth.** The redaction rules per data
  type, the metric/log/trace event catalog, the supply-chain control list, and the per-threat
  mitigation+residual entries (§A10.5) fully enumerated and cross-referenced to the core's `THR-*`.
- **Pass A8 — Red-Team Review (application).** Adversarial review of the whole application spec
  against these requirements (severity-rated, fixes applied in place, verdict), mirroring the core's
  Red-Team Review 01 method.

Each pass updates this section's changelog with the honest line count and the requirements added.
Completeness is never claimed beyond what is written.

---

# §A21 Multi-game platform architecture

The platform is a **multi-game** dealerless card-game application — all poker variants plus Blackjack,
behind one game-module interface. This section specifies the **application layer** of that design; it
consumes the core game model (core §5, §7) and the `GameModule` interface (core §7.1), and adds the
variant-aware UI, the lobby/registry integration, and per-game test and rollout obligations. No game
logic is implemented in the UI (§A2.2); the UI is variant-agnostic where it can be and variant-
specialised only where a variant's surface genuinely differs.

## §A21.1 The game-module abstraction at the app layer (REQ-APP-210)
Each game is a module implementing the core `GameModule` contract (core §7.1:
`init`/`getLegalActions`/`apply`/`isTimeoutEligible`/`isHandComplete`/`settle` + serialization),
packaged per core §16 (`/packages/game-holdem`, `/packages/game-omaha`, `/packages/game-stud`,
`/packages/game-draw`, `/packages/game-razz`, and the planned `/packages/game-blackjack`). The app
consumes modules **only** through the SDK/engine (core §15.2); `ui-core` never imports a game module
directly (REQ-APP-211). The UI renders whatever `getLegalActions`/`deriveState` return; the set of
legal actions and the table shape are the module's, surfaced generically.

## §A21.2 Game registry & lobby integration (REQ-APP-212)
A **game registry** lists available games with, per game: display name, supported seat range (core
D2: 2–9), supported betting structures (core §5.4: NL/PL/FL), the forced-bet model (blinds vs
ante+bring-in), and the table-view variant profile (§A21.3). The lobby (§A6.3) and table-create
(§A6.4) screens are driven by this registry: a player picks a game, then the registry constrains the
rest of configuration (seats, structure, blinds/antes). The registry is **data**, not UI branching;
adding a game is adding a registry entry + a module, not editing screens (REQ-APP-213).

## §A21.3 Per-variant table-view profiles (REQ-APP-214)
The table view (§A6.5) is **one** screen parameterised by a variant profile from the registry:

| Game | Hole cards | Board | Reveals | Acting order | Special UI |
|---|---|---|---|---|---|
| Texas Hold'em | 2 concealed | 5 community (3-1-1) | board = N-of-N cooperative + timeout-default (core §4.6) | button-relative (HU: button=SB acts first preflop) | — |
| Omaha (PL/NL) | **4** concealed | 5 community (3-1-1) | as Hold'em | as Hold'em | reminder "exactly 2 hole + 3 board" (engine enforces, core §5.3.2) |
| Seven-Card Stud | 2 down + up cards | none | **up-cards** public N-of-N; down-cards private | **board-driven** (highest board acts; bring-in = lowest up-card, core §7.3.2) | per-seat up/down layout; bring-in indicator; 8-handed deck-exhaustion shared community up-card |
| Five-Card Draw | 5 concealed | none | showdown only | button-relative | **draw control**: discard 0–5 no-reveal + redraw (count public, identities private, core §7.3.3); stand-pat |
| Razz | 2 down + up | none | up-cards N-of-N | board-driven, **reversed** (lowest acts; bring-in = **highest** up-card, core §7.3.4) | low-hand indicator; reversed-order cues |
| Blackjack | distinct model | — | distinct model | — | see §A21.7 |

The UI consumes the profile + the engine's per-state output; it does not encode rules. Profiles cover
the full 2–9 seat envelope (§A21.6).

## §A21.4 The three card UI primitives (REQ-APP-215; core REQ-FSM-003/004/005)
- **Down-card** — dealt by `draw(position)` then **privately revealed to its holder** via the custody
  boundary (§A8.2); others see a concealed card, the holder sees a viewer-path face.
- **Up-card** — dealt by `draw(position)` then **immediately publicly revealed by an N-of-N
  cooperative transition** (core §4.6) with a timeout-default; the UI shows cooperative-release
  progress, not a unilateral publish.
- **Draw** (five-card draw) — the player surrenders chosen concealed cards to a dead-hand **without
  reveal** (a partial fold) and is dealt the same number of fresh concealed cards (private-revealed to
  the drawer); the **count is public, the identities are not**. The UI exposes a multi-select discard
  + "stand pat" (draw 0), each producing the appropriate signed transaction(s) via the SDK.
Each primitive is one or more signed transactions (core §6.1); the UI obtains signing consent (§A6.7)
and never reveals what the rules keep concealed.

## §A21.5 Betting-structure UI (REQ-APP-216; core §5.4)
The bet sizer is structure-aware via the `BettingStructure` interface (core §5.4): No-Limit
(max = stack), Pot-Limit (max = pot + call), Fixed-Limit (fixed small/big bet, capped raises). The UI
reads `legalBets` and renders only legal sizings; it never computes the range. Stud/Razz small-/
big-bet streets and the Fixed-Limit open-pair rule are surfaced from the engine.

## §A21.6 Multi-way (3–9 seat) UI (REQ-APP-217; core D2, §5.5, §19.B)
The seat ring, acting-order indicator, and **side-pot display** handle 2–9 seats. Side pots (main +
ordered side pots, core §5.5/§19.B) are computed by the engine and rendered; the UI shows each pot,
its eligible seats, and the award. Acting order is per-game (button-relative vs board-driven,
§A21.3). Phase 1 is fixed at 2 seats (core D1/D2); the UI and state model handle the full envelope
without redesign (REQ-APP-218).

## §A21.7 Blackjack — required game, distinct dealerless model (REQ-APP-219; core D7)
Blackjack **is a required game** (R6) and is captured here as a first-class **planned** module — it is
not dropped. But dealerless blackjack is **not** the symmetric mental-poker shuffle: it is
player-vs-dealer, and a dealerless construction needs its **own** concealment and settlement model
(core D7 forbids smuggling that difference into the poker pipeline). Therefore Blackjack is a
`GameModule` with its own deal/settlement design, and its protocol model is **DECISION REQUIRED** — a
dedicated design track (parallel to the poker §7.3 work) covering how the "dealer" role is realised
with no trusted dealer, how the shoe is concealed and dealt, and how outcomes settle. The app layer
reserves now: its registry entry; its variant profile (hit/stand/double/split/insurance controls, a
dealer area, no inter-player pot); and its test obligations. The module ships **after** its protocol
model is fixed. This captures the requirement and the seam without overclaiming a model the project
has not yet specified (P7/P8).

## §A21.8 Per-game test obligations (REQ-APP-220; Claude Code runs)
For each game module: the variant state machine is exercised E2E on regtest (core §7.3, §19.E + the
multi-way generalisations); the hand-evaluation paths are tested against the core's **generated**
vectors (core §19.D — Omaha 2+3, ace-to-five low, etc.), which **Claude Code generates by running the
oracle**; the variant table-view profile is tested (controls, reveals, order) at every supported seat
count, on both desktop and web builds. The author specifies the cases; Claude Code runs them.

## §A21.9 Multi-game phased rollout (REQ-APP-221; mirrors core §17)
- **Phase 1** — Texas Hold'em (heads-up NL, regtest, with discovery): the full pipeline (core D1).
- **Phase 2** — Hold'em robustness + multi-way (6-max) + fair-play (core §17 Phase 2).
- **Phase 3** — Omaha, Seven-Card Stud, Five-Card Draw, Razz as modules (core §17 Phase 3), each with
  its variant profile, betting structures (PL/FL), and generated hand-eval vectors.
- **Later track** — Blackjack (after its §A21.7 model is fixed), and the NFT (§A22) and richer
  micro-payment (§A23) tracks.
Each game's acceptance gate (§A18.3): its E2E + adversarial + generated vectors green, at every
supported seat count, on both builds.

**Provenance.** The substrate `cardtable` ships a partial **In-Between** (Acey-Deucey) as its first
game (core §2.1); the platform uses cardtable's **primitives**, not its game, and builds the games
above on top — it does **not** assume any poker variant exists in cardtable (core §2.1).

---

# §A22 NFT / revocation integration track (required; later track; seam exposed)

True transferable + revocable NFTs are a **required capability** (R10): once Bob owns the item, Alice
permanently loses access. The platform realises this on `overlay-broadcast` (core §2.4) via the NFT/
access seam (core §15.7), as a **separate product track** — **not** shipped inside the core poker
phases, but with the seam exposed so it integrates without re-architecting (core §0.3, §15.7).

## §A22.1 What revocation actually is (REQ-APP-230; core §2.4, P8)
Revocation = an **unspent expiring output** decided by no operator (core §2.4 INV-OB-2): access is a
funded session whose renewal spends a member output; **unspent past expiry = revoked**. Content is
encrypted under a key-graph (Logical Key Hierarchy, `O(log n)` rekey); a transfer re-keys so the prior
owner's key no longer opens the content. The UI MUST state the property **exactly** — revocation is
the on-chain expiry/rekey fact; the platform claims no more than `overlay-broadcast` enforces (P8). A
copy exfiltrated **before** revocation is outside what any such system can revoke; the UI says so
where relevant.

## §A22.2 App seam & UI (REQ-APP-231; core §15.7)
The SDK seam (`OB`-backed `accessSession`, `revokeByExpiry`, `wrapContentKey`, core §15.7) is exposed
but unused in core poker phases. The NFT product UI (gallery; list/buy/sell/**transfer-with-
revocation**) is a later-track screen set; transfer triggers the re-key so the old owner's access is
revoked on-chain. Marketplace economics are out of scope here.

## §A22.3 Boundary & test (REQ-APP-232)
The Grok-doc `revocable-nft-tee` repo is **not** in the author's published list (core §2.4 note); the
revocable-content capability is the `overlay-broadcast` primitive, and the polished NFT product is
unshipped — the platform builds it on that primitive, claims only what it enforces, and tests
transfer→revocation against the **real** `overlay-broadcast` implementation (core §2.6 REQ-DEP-004).
TEE-sealed custody is optional (AD7) and not required for revocation.

---

# §A23 Micro-payment integration track (required; flag-gated early)

Sub-satoshi in-game value is a **required capability** (R9), realised on `bonded-subsat-channel`
(core §2.2) — sub-satoshi granularity `k`, whole-satoshi on-chain settlement via the largest-
remainder reconciliation `Q*`, and a fixed **1-satoshi anti-cheat bond** forfeited on a stale-state
broadcast (core §2.2, §5.7, §9.4). It is **optional and flag-gated** in Phases 1–2 (core §0.3),
because play-money/regtest play does not require it.

## §A23.1 App seam & custody (REQ-APP-240; core §2.2, §9.4)
Micro-betting uses the `BS.channel.open/transfer/close/contested` lifecycle (core §15) and
`BS.reconcile.Qstar` for whole-satoshi settlement (core §2.2). Channel keys and the 1-sat bond are
managed via the `Custody` interface (core §9.4, REQ-WALLET-005); every channel operation is an
**explicit signing action** with a clear prompt (§A6.7) — no silent value movement.

## §A23.2 UI & consequence text (REQ-APP-241)
The UI surfaces channel open/transfer/close/contested as signing actions; it shows that sub-satoshi
precision lives only in off-chain accounting and **no fractional output is ever written on-chain**
(core §2.2 INV-BS-1), and that risked capital is fixed at one satoshi/participant regardless of
payment size/path (INV-BS-2). On a stale-state broadcast the bond is forfeited to honest parties (core
§18.1); the UI states this is a tunable deterrent, not a proof.

## §A23.3 Boundary & test (REQ-APP-242)
Stale-state broadcast, contested-close, and the `Q*` whole-satoshi reconciliation are tested against
the **real** `bonded-subsat-channel` implementation and through the real interpreter where on-chain
(core §2.6 REQ-DEP-004, §14.3); the author specifies the cases, Claude Code runs them.

---

# Appendix I — IPC command/event catalog (desktop Tauri main ⇄ ui-core)

Notation: `cmd(req) → res` for request/response; `evt: {…}` for one-way events. Types describe the
**message contract** (not code); exact definitions are built against `protocol-types` and core §15.
Every command obeys a trust-boundary rule (§A10.4) and fail-closed (§A11.2): an unrecognised/malformed
message is rejected (`IPC-MALFORMED`, Appendix III) and logged, never partially applied (REQ-APP-026).
Raw key material MUST NOT appear in any payload (REQ-APP-025). On web the same contract is served by
the connection layer against remote services (§A4.1); `services.*` is desktop-only.

### I.1 `services.*` (desktop only) — service lifecycle (§A3.2)
- `services.start() → {accepted: bool}` — ordered startup (node→indexer→relay); idempotent.
- `services.stop() → {accepted: bool}` — reverse-order shutdown.
- `evt services.status: {service:'node'|'indexer'|'relay', state:'starting'|'healthy'|'degraded'|'failed'|'recovering', detail?:string, attempt?:int}` — emitted on every transition.
- Trust boundary: control-plane only; no value, no keys. Errors: `SVC-START-FAILED`, `SVC-PORT-CONFLICT`, `SVC-STORE-CORRUPT`.

### I.2 `chain.*` — chain access (pass-through to `Chain`, core §15.9)
- `chain.broadcast(rawTx:hex) → {txid:hex, status:'accepted'|'seen'|'double-spend-attempted'|'rejected', reason?:string}` — broadcasts an **already-signed** tx; never builds or signs.
- `chain.outpointStatus({txid,vout}) → {state:'unspent'|'spent'|'unknown', spentBy?:hex}`.
- `chain.txStatus(txid) → {state:'mempool'|'confirmed'|'evicted'|'unknown', confirmations?:int}`.
- `chain.headers({from?,count?}) → {headers:BlockHeader[]}` — SPV-edge checks (core §34).
- `chain.conflicts(outpoint) → {conflicting:hex[]}` — double-spend observability (core §8.4).
- Trust boundary: read/broadcast only; responses are hints to confirm (core P3); `accepted` ≠ finality (finality = confirmation depth, core §5.7). Errors: `CHAIN-UNREACHABLE`, `CHAIN-BADTX`, `CHAIN-TIMEOUT`.

### I.3 `custody.*` — custody-trusted operations (results only; core §9.3, §15.6)
- `custody.derive({gid,j?,role}) → {publicKey:hex}` — HKDF-derived **public** key only; never the scalar (REQ-APP-025).
- `custody.sign(intent:SignIntent) → {signature:hex}` where `SignIntent={sighashPreimage:hex, describe:{action,amounts,potOrState}}` — signs exactly the bytes the prompt renders (§A6.7); fail-closed on mismatch.
- `custody.decryptToViewer(card:ConcealedCardRef) → {viewerToken:opaque}` — decrypts into the controlled viewer path (§A10.3); returns a viewer token, never DOM plaintext.
- `custody.combineSignShare(req) → {share|signature}` — Mode-B threshold share (core §6.7); absent under Mode A.
- Trust boundary: the **only** door to key operations; keys never cross it. Errors: `CUSTODY-LOCKED`, `CUSTODY-BACKEND-UNAVAILABLE`, `CUSTODY-INTENT-MISMATCH`, `CUSTODY-DECRYPT-FAILED`.

### I.4 `config.*`
- `config.runtime() → {ports, network:'regtest'|'mainnet', dataDir, flags}`.
- `config.setNetwork(network) → {accepted:bool}` — **guarded**: rejects non-regtest unless the mainnet research flag is set (§A3.5, REQ-APP-030); success requires the UI banner. Errors: `CONFIG-MAINNET-FLAG-REQUIRED`, `CONFIG-INVALID`.

### I.5 `diag.*` — diagnostics (redacted, §A12.5)
- `diag.logs(query) → {entries:LogEntry[]}` (redacted; no keys/faces/secrets, REQ-APP-124).
- `diag.metrics() → {metrics:Metric[]}` (§A12.2).
- `diag.bundleDiagnostics() → {path}` — opt-in, redacted. Errors: `DIAG-EXPORT-FAILED`.

---

# Appendix II — Screen × action × SDK-call matrix

Per action: the screen, the engine gate, the SDK build (core §15.5), the custody call (core §15.6),
the send paths (§A7.4: canonical=`chain.broadcast`; speed=table channel), and the consequence/signing
text. The UI never decides legality — it calls `getLegalActions` (core §15.2). Every value-affecting
action raises the signing modal (§A6.7).

### II.1 Lobby / table-create (§A6.3/§A6.4)
| Action | Gate | SDK build | Custody | Send | Signing/consequence |
|---|---|---|---|---|---|
| Create table | ruleset valid (§15.3) | `createTable`/`buildFunding` | `sign` | both | "Locks your stake; refunds via the pre-signed path if the table aborts." |
| Join table | seat open; stake available | `joinTable`/`buildFunding` | `sign` | both | "Joining locks your stake into the table." |

### II.2 Table view — betting (all poker variants; §A6.5)
| Action | Gate (`getLegalActions`) | SDK build | Custody | Send | Signing/consequence |
|---|---|---|---|---|---|
| Check | check legal | `buildAction(check)` | `sign` | both | "Check — no chips committed." Timeout-default if you do nothing & check is legal. |
| Bet | bet legal; size ∈ `legalBets` (§5.4) | `buildAction(bet,amt)` | `sign` | both | shows amount + resulting pot. |
| Call | facing a bet | `buildAction(call,amt)` | `sign` | both | shows call amount + pot. |
| Raise | raise legal; size ∈ `legalBets` | `buildAction(raise,amt)` | `sign` | both | shows raise-to + pot. |
| Fold | in hand | `buildFold` (**no reveal**, core P5/§4.6) | `sign` | both | "Fold — surrender the hand without showing your cards." |

### II.3 Table view — variant-specific
| Action | Variant | Gate | SDK build | Custody | Notes |
|---|---|---|---|---|---|
| Discard 0–5 / draw | Five-Card Draw | draw phase (§7.3.3) | `buildAction(draw,{discardSet})` + redeal | `sign` + `decryptToViewer` (new cards) | discards to dead-hand **no reveal**; count public, identities private (REQ-APP-215). |
| Stand pat | Five-Card Draw | draw phase | `buildAction(draw,{discardSet:∅})` | `sign` | draw timeout-default = stand-pat (core REQ-FSM-010). |
| Up-card reveal release | Stud/Razz | up-card dealt (§7.3.2/§7.3.4) | `buildReveal(upCard)` (N-of-N, §4.6) | `combineSignShare`/`sign` | UI shows cooperative-release + timeout-default, not a unilateral publish. |

### II.4 Board reveals (Hold'em/Omaha; core §4.6)
| Step | Gate | SDK build | Custody | Notes |
|---|---|---|---|---|
| Reveal flop/turn/river | street-reveal; N-of-N | `buildReveal(board)` | each party releases (`sign`/`combineSignShare`) | **N-of-N cooperative + timeout-default**; a withholder → recovery (core §6.4); UI shows progress. |

### II.5 Showdown / settlement (§A6.8)
| Action | Gate | SDK build | Custody | Notes |
|---|---|---|---|---|
| Reveal hand (min) | showdown; contender (§5.6) | `buildReveal(hand)` | `decryptToViewer` then `sign` | only what the showdown needs; verified vs commitments (core §6.6). |
| Muck | cannot win a contested pot | muck (`buildFold`-equiv) | `sign` | no reveal. |
| Settlement (close-out) | winning proof valid (engine) | `buildSettlement` (close-out, core §6.6) | `sign`/`combineSignShare` | engine computes the award; pots per §5.5/§19.B. |

### II.6 Recovery / timeout (§A6.9, core §6.4)
| Action | Gate | SDK build | Custody | Notes |
|---|---|---|---|---|
| Advance timeout-default | maturity reached (tx-level nLockTime, core §6.2) | `buildTimeout`/`buildRecovery` | `sign` | any peer may advance; the client does so when it is its role. |
| Reconnect/resume | on (re)connect | — (request transcript gap) | — | engine rebuilds (core §8.6); no new value action. |

Micro-payment channel actions (open/transfer/close/contested) map analogously via `BS` (§A23.1) when
the micro-betting flag is on; each is an explicit signing action (§A6.7).

---

# Appendix III — Error-code catalog

Each code: stable id, category (§A11.1), severity (`FATAL`/`DEGRADED`/`RECOVERABLE`/`USER`), plain
user message, remediation, test (Appendix IV). No error is swallowed (§A11.1); secrets never appear in
any error payload (§A12.5).

| Code | Category | Severity | User message | Remediation | Test |
|---|---|---|---|---|---|
| CFG-INVALID | configuration | FATAL | "Configuration is invalid; can't start." | reinstall / restore default | TC-ERR-001 |
| SVC-START-FAILED | service-lifecycle | DEGRADED | "A local service didn't start." | retry; view diagnostics | TC-ERR-010 |
| SVC-PORT-CONFLICT | service-lifecycle | DEGRADED | "A required port is in use." | free it / let the app pick another | TC-ERR-011 |
| SVC-STORE-CORRUPT | service-lifecycle | DEGRADED | "The local regtest store is corrupt." | re-init store (explicit confirm) | TC-ERR-012 |
| CHAIN-UNREACHABLE | connectivity | DEGRADED | "Can't reach the node/network." | reconnect; play continues on the speed path | TC-ERR-020 |
| CHAIN-BADTX | protocol/validation | RECOVERABLE | "The network rejected a transaction." | re-derive; action not applied (fail-closed) | TC-ERR-021 |
| CHAIN-TIMEOUT | connectivity | RECOVERABLE | "A chain request timed out." | retry with backoff | TC-ERR-022 |
| RELAY-UNREACHABLE | connectivity | DEGRADED | "Can't reach the relay; trying LAN/peers." | reconnect; canonical path authoritative | TC-ERR-030 |
| CUSTODY-LOCKED | custody/signing | USER | "Your wallet is locked." | unlock to continue | TC-ERR-040 |
| CUSTODY-BACKEND-UNAVAILABLE | custody/signing | DEGRADED | "Custody backend unavailable." | check backend; signing paused | TC-ERR-041 |
| CUSTODY-INTENT-MISMATCH | security | FATAL (per action) | "Bytes to sign didn't match what was shown — refused." | report; never auto-retry | TC-SEC-005 |
| CUSTODY-DECRYPT-FAILED | custody/signing | RECOVERABLE | "Couldn't decrypt your card." | retry; no fake card shown | TC-ERR-042 |
| TX-VALIDATION-FAILED | protocol/validation | RECOVERABLE | "A move wasn't valid for this state." | re-derive; legal actions only | TC-ERR-050 |
| STATE-CONFLICT | protocol/validation | RECOVERABLE | "Resolving a conflicting move…" | follow accepted successor (core §8.5) | TC-ADV-007 |
| PERSIST-CORRUPT-RECORD | persistence | RECOVERABLE | "A saved record was corrupt and was quarantined." | re-fetch/re-derive | TC-ERR-060 |
| PERSIST-QUOTA | persistence | RECOVERABLE | "Local storage is full." | export/prune; load-bearing state re-derivable | TC-ERR-061 |
| IPC-MALFORMED | configuration/security | RECOVERABLE | (internal) | reject + log; never partially applied | TC-SEC-010 |
| CONFIG-MAINNET-FLAG-REQUIRED | security | USER | "Mainnet needs the explicit research flag." | set the flag knowingly; banner shown | TC-SEC-020 |
| UI-RENDER-FAULT | UI/render | DEGRADED | "Something went wrong displaying this screen." | error boundary recovers it; app keeps running | TC-ERR-070 |
| STRANDED-VALUE | protocol/validation | FATAL | "Unexpected state — stopping to protect funds." | surfaced, never hidden (core P4, §A11.5) | TC-ADV-020 |

The threat-failure codes (CUSTODY-INTENT-MISMATCH, CONFIG-MAINNET-FLAG-REQUIRED, IPC-MALFORMED)
cross-reference §A10.5 and the core `THR-*` (core §18).

---

# Appendix IV — Test-case catalog (core set; full per-case expansion in Pass A5)

Each case: id, level (§A16.1), gate/preconditions, expected UI+state, classification, requirement
verified. **Claude Code runs every case** (§A19). Negative cases involving a script/transaction fail
**inside** the real interpreter with Genesis rules (core §14.3, P9). The set below resolves every TC-*
referenced in Appendix III.

### IV.1 Determinism & replay (§A16.4)
- **TC-DET-001** (property) same ordered valid-tx set + ruleset ⇒ byte-identical derived state across runs — REQ-APP-163, core REQ-TEST-002.
- **TC-DET-002** (property) desktop and web builds agree exactly on the same set — cross-client agreement.
- **TC-DET-003** (integration) reconnect-from-gap ≡ continuous play — REQ-APP-075.

### IV.2 Engine-legality / UI (§A16.2)
- **TC-UI-001** the UI never enables an action absent from `getLegalActions` — REQ-APP-010/051 (fail-closed).
- **TC-UI-002** consequence text matches the acting state's timeout-default (check vs fold-when-facing-a-bet; never a forced wager) — core §6.4.

### IV.3 Error paths (§A16.6) — resolves Appendix III TC-ERR-*
- **TC-ERR-001** invalid config ⇒ FATAL, no play. **TC-ERR-010/011/012** start-fail/port/corrupt-store ⇒ DEGRADED + guided recovery. **TC-ERR-020/021/022** chain unreachable/badtx/timeout ⇒ banner+speed-path / fail-closed re-derive / backoff. **TC-ERR-030** relay unreachable ⇒ LAN/peer fallback. **TC-ERR-040/041/042** custody locked/unavailable/decrypt-failed ⇒ unlock / pause signing / no fake card. **TC-ERR-050** invalid move ⇒ re-derive, legal-only. **TC-ERR-060/061** corrupt-record/quota ⇒ quarantine / export-prune. **TC-ERR-070** render fault ⇒ error boundary recovers one screen.

### IV.4 Security (§A16.9) — resolves TC-SEC-*
- **TC-SEC-001** no key material in any log/metric/trace/bundle (redaction, REQ-APP-124). **TC-SEC-002** no key crosses IPC or reaches the DOM (REQ-APP-025/081). **TC-SEC-005** signing intent ≠ presented bytes ⇒ refuse (CUSTODY-INTENT-MISMATCH); no auto-retry. **TC-SEC-010** malformed IPC ⇒ reject+log, never partially applied. **TC-SEC-020** mainnet without flag ⇒ refused + banner when flagged. **TC-SEC-030** installer-signature / artifact-hash verification (supply chain, §A10.6).

### IV.5 Adversarial / fault-injection (§A16.6) — resolves TC-ADV-*
- **TC-ADV-001..006** disconnect at each phase (deal/bet/reveal/showdown/settle/recovery) ⇒ correct default/recover; no stranded value. **TC-ADV-007** conflicting spend ⇒ STATE-CONFLICT resolves to the accepted successor (core §8.5). **TC-ADV-008** withheld board/player reveal ⇒ N-of-N timeout-default to recovery (core §4.6/§6.4). **TC-ADV-009** stale-state micro-payment broadcast ⇒ 1-sat bond forfeited (core §18.1). **TC-ADV-010** mempool eviction ⇒ resubmission; convergence restored. **TC-ADV-020** any would-strand-value state ⇒ STRANDED-VALUE FATAL, surfaced (core P4, §A11.5).

### IV.6 Interpreter-level script (§A16.5; Claude Code runs the real interpreter, Genesis)
- **TC-INT-001** each template's positive spend accepted (funding, action, fold, reveal-or-timeout, settlement, fair-play, optional TTP — core §6.6). **TC-INT-002** each template's negative battery fails **inside** the interpreter (not a wrapper guard; no signature spot-check): card-substitution rejected by byte-equality (core §6.3), bad reveal opening rejected, replayed branch rejected by binding (core §6.3).

### IV.7 Accessibility (§A16.8)
- **TC-A11Y-001..N** keyboard-only + screen-reader walkthrough of each screen; turn/timer/consequence announced; contrast/roles/labels pass.

### IV.8 Per-game (§A21.8) — one block per variant
- **TC-GAME-HOLDEM-\*** HU + 6-max E2E; betting tree; min-reveal showdown; side pots. **TC-GAME-OMAHA-\*** 4 hole cards; 2+3 evaluation (generated vectors, core §19.D); PLO sizing. **TC-GAME-STUD-\*** up/down cards; bring-in; board-driven order; 8-handed deck-exhaustion case. **TC-GAME-DRAW-\*** no-reveal discard+redraw; stand-pat default; count-public/identities-private. **TC-GAME-RAZZ-\*** ace-to-five low; reversed bring-in/order (generated vectors).

---

# Appendix V — Configuration catalog

Every key: type, default, the AD/AD-OPEN it realises, validation (fail-closed, §A10.4). No timing
constant here is a consensus value — timing is transaction-level (core §6.2); these are UI/operational
timeouts and budgets.

| Key | Type | Default | Realises | Validation |
|---|---|---|---|---|
| `project.name` | string | `bsv-poker` | core §0.4 | non-empty; matches rename script |
| `desktop.shell` | enum(tauri,electron) | tauri | AD2 | electron only on a recorded Tauri limitation |
| `web.stack` | enum | react-ts-vite | AD3 | fixed for Phase 1 |
| `chain.backend` | enum | bonded-subsat-node | AD4 | must expose `BS.node` (core §2.2) |
| `chain.network` | enum(regtest,mainnet) | regtest | §A3.5 | mainnet rejected unless `flags.mainnetResearch` |
| `flags.mainnetResearch` | bool | false | §A3.5/REQ-VM-007 | true requires explicit user action + banner |
| `services.ports.{node,indexer,relay}` | int\|auto | auto | §A3.4 | allocated, written to runtime config; no hard-coding |
| `services.restart.maxAttempts` | int | TRACKED ASSUMPTION | §A3.2 REQ-APP-022 | bounded; never unbounded loop |
| `services.restart.backoffMs` | int | TRACKED ASSUMPTION | §A3.2 | bounded, increasing |
| `dataDir` | path | per-user app dir | §A3.4 | namespaced by network (regtest/mainnet isolated) |
| `desktop.store` | enum | sqlite | AD9 | — |
| `web.store` | enum | indexeddb | AD10 | localStorage/sessionStorage forbidden for load-bearing state |
| `web.connectionMode` | enum(bundled-local,hosted) | DECISION REQUIRED | AD-OPEN-1 | per environment |
| `web.serviceWorker` | bool | DECISION REQUIRED | AD-OPEN-2 | if on, must not cache keys/secrets |
| `custody.backend` | enum(software,threshold,tee) | software | AD7 | TEE optional; pluggable |
| `custody.processBoundary` | enum(rust,worker) | rust | AD-OPEN-3 | both keep keys off the DOM |
| `crypto.signingMode` | enum(A,B) | A | core D9 | UI must not claim Mode B property under Mode A |
| `timeouts.decisionMs` | int | TRACKED ASSUMPTION | core §6.4 | UI countdown; default check/fold, never forced wager |
| `timeouts.recoveryMs` | int | TRACKED ASSUMPTION | core §6.4 | > decision timeout |
| `reconnect.{backoffMs,maxAttempts}` | int | TRACKED ASSUMPTION | §A7.6 | bounded |
| `transcripts.retention` | int\|all | TRACKED ASSUMPTION | §A13.4 | export-before-prune offered |
| `microBetting.enabled` | bool | false (P1–P2) | §A23/core §0.3 | flag-gated; uses `BS` |
| `microBetting.granularityK` | int | per `BS` | §A23/core §2.2 | whole-satoshi settle via `Q*` |
| `table.maxSeats` | int(2..9) | 2 (P1) | core D2 | envelope 2–9; UI handles all |
| `nft.track.enabled` | bool | false | §A22 | seam exposed; product later |

All `TRACKED ASSUMPTION` values are set and **measured/justified** by the build (§A16.7); the author
asserts none.

---

# Appendix VI — Glossary (application layer)

Consistent with the core glossary (core §0.6).
- **Supervisor** — the Tauri Rust main process that spawns/supervises/tears down local services and
  hosts custody-trusted operations (§A3).
- **Shell** — a thin host of the UI core: `client-desktop` (Tauri/WebView2) or `client-web` (Vite); no
  business logic (§A5).
- **UI core (`ui-core`)** — the shared TS/React core both shells run: store, view-models, components (§A5).
- **app-services** — the client-side layer between `ui-core` and the SDK: connection manager,
  sync/deriver, custody client, timeout/observer, persistence gateway (§A2.3).
- **Connection manager** — owns both send paths and the table-channel/presence/reconnect lifecycle (§A7).
- **Canonical path** — sending an action to the node/network as a real transaction (authoritative;
  eventual finality) (§A7.4, core §8.3).
- **Speed path** — sending an action directly to table peers for fast convergence; never overrides the
  canonical path (§A7.4, core §8.3).
- **Table channel** — the per-table inventory/object relay subscription (§A7.3, core §8.2 Tier B).
- **Custody boundary** — the trusted process/worker where keys live and signing/decryption happen; keys
  never cross it to the DOM (§A8.2, core §9.3/§11.5).
- **Viewer path** — the controlled path rendering a decrypted card face to its holder only; never DOM
  plaintext (§A10.3, core §11.5).
- **Fail-closed** — on any ambiguity affecting value/state, do not act and surface it (§A11.2).
- **Degraded / Paused** — degraded = play continues with reduced connectivity (canonical path alive);
  paused = play gated until a required local service recovers (§A11.3).
- **Self-contained image ("VM")** — the reproducible container (and optional VM image) bundling
  node+relay+client with a one-command bootstrap (§A14, core §10/D5).
- **Game module / variant profile** — a `GameModule` (core §7.1) and the registry data parameterising
  the table view for that game (§A21).
- **TRACKED ASSUMPTION** — a value/target the build must meet and **measure**, not a claim it is met (§A0.1).
- **DECISION REQUIRED** — a choice not yet fixed; asserted nowhere until decided (§A0.1).
