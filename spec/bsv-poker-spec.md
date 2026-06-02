# BSV Poker Platform — Master Engineering Specification

**Document status:** Part 1 of a multi-part specification. This file is written to be
extended in place. Sections marked `[EXPAND: Part N]` are scaffolded with their required
structure and the decisions already taken; the voluminous catalogs (per-variant state
tables, full transaction byte schedules, exhaustive test-vector lists, the complete
requirements register) are filled in subsequent passes. Nothing in this document is
padding. Where a number, rule, or interface is not yet fixed, it is marked explicitly as
`DECISION REQUIRED` or `TRACKED ASSUMPTION`, never asserted.

**Document type:** Build specification for execution in Claude Code. This is a design
artifact. It contains no application code. It defines what is to be built, the contracts
between parts, the acceptance criteria, and the test obligations.

**Working project name:** `bsv-poker` (provisional; rename is a one-line change in §0.4).

**Target chain:** Bitcoin SV (BSV), post-Genesis consensus only. There is no BTC code,
no BTC assumption, and no BTC fallback anywhere in this system. Any construction that
would require a BTC-only feature is a defect (see §6.2 for the specific post-Genesis
consequences this imposes).

**Engineering bar:** flight-software grade — NASA NPR 7150.2 software-assurance
practice plus the JPL "Power of Ten" coding rules, with a requirements-traceability
matrix mapping every requirement to the code and tests that satisfy it (§13). The bar is
a *process and a checkable set of obligations*, not a slogan. Robustness is demonstrated
by tests that fail honestly and by reproducible evidence, not declared.

---

## Table of Contents

- §0 Preamble: purpose, principles, scope, glossary, open decisions
- §1 Product definition
- §2 Dependency stack and integration contracts (the prof-faustus repositories)
- §3 System architecture
- §4 Cryptographic protocol: mental poker on BSV
- §5 Poker domain model (rules, hand evaluation, betting, pots)
- §6 BSV transaction and Script model
- §7 Game state machines (framework + Texas Hold'em reference) `[EXPAND: Part 2]`
- §8 Networking, discovery, matchmaking, anti-stall
- §9 Wallet and key management
- §10 Self-contained runtime ("the VM") and packaging
- §11 Client shells: Windows (desktop) and Web
- §12 Persistence, transcripts, audit
- §13 Engineering standard, requirements register, traceability
- §14 Test strategy and acceptance
- §15 Module API / SDK contracts
- §16 Build, CI/CD, reproducibility, release
- §17 Phased roadmap and per-phase acceptance gates
- §18 Threat model `[EXPAND: Part 2]`
- §19 Appendices `[EXPAND: Part 3]`

---

# §0 Preamble

## §0.1 Purpose

Build a new, production-grade, dealerless multiplayer **poker** platform on BSV that:

1. runs as a single self-contained application launchable on **Windows desktop** and on the **web**, requiring no external services to play in local/regtest mode;
2. lets players **discover and connect to each other** and sit at tables;
3. implements **real poker** — starting with one fully playable variant and extending to the standard set through a clean game-module interface;
4. is **dealerless and non-custodial**: no server holds the deck, no operator decides outcomes, every game event is a signed BSV transaction, and the table state is a deterministic function of the valid transaction set;
5. composes the existing BSV primitives (the `prof-faustus` stack — §2) rather than reinventing them;
6. is engineered to the standard in §13 and tested to the obligations in §14.

This document is the contract between the design (here) and the build (Claude Code).

## §0.2 Non-negotiable principles

These govern every later section. A violation of any of them is a build defect, not a
style preference.

- **P1 — BSV-only.** Post-Genesis BSV consensus exclusively. No BTC code, no BTC assumptions, no Lightning-style in-script penalty constructions. See §6.2.
- **P2 — Determinism (relative to an agreed transaction ordering).** Given an *agreed* ordering of the valid transaction set and the ruleset hash, `table_state = f(ordered_valid_txs, ruleset)`, and two honest clients with that same ordered set derive byte-identical state. The engine is deterministic *given* an ordering; it never depends on wall-clock arrival or which packet a node saw first. **What this does and does not claim (corrects RT-01 M1):** before block confirmation the global "valid tx set" is not universally agreed — mempools differ, transactions can be evicted or reorganized (§8.4). Pre-confirmation *safety* is therefore provided not by determinism alone but by the convergence machinery: dual-path propagation (§8.3), the deterministic conflict rules (§8.5), and the timeout-default branch (§6.4). Disagreements about ordering are resolved by §8.5, not by the engine. Reorg/eviction is handled by the recovery/timeout path (§6.4); value that leaves the table is final only at block confirmation (§5.7). The engine's determinism is what makes replay (§12.3) and cross-client agreement (§14.2) checkable; it is not a claim that all clients always hold the same unconfirmed set.
- **P3 — No trusted dealer, no trusted operator.** The shuffle is distributed; the relay is transport and indexing only and is never the source of truth (§8.1).
- **P4 — Every actionable state has two exits.** A cooperative branch (the player acts) and a timeout-default branch (the player does not). Time is an explicit protocol actor. No table can be frozen by one absent or malicious participant (§7, §6.4).
- **P5 — Fold without reveal.** Folding surrenders claim and removes the player from contention without disclosing concealed cards. Only live contenders reveal, and only what the showdown requires (§5.6, §4.6).
- **P6 — Zero fabrication.** Every constant traces to a source (a cited document, a measured value, or a declared `TRACKED ASSUMPTION`). No number is invented to make another number consistent. A hardcoded figure that creates internal inconsistency is a material defect.
- **P7 — Explicit assumptions.** Every assumption appears in the spec and, where it constrains code, in the source. Hidden assumptions are treated as the most serious class of failure because they contaminate everything downstream while pretending not to exist.
- **P8 — No overclaim.** A statement may not assert more than the construction structurally guarantees. "Revocation is an on-chain fact" is permitted only where an unspent-expiring-output mechanism actually enforces it; "trustless" is not used unconditionally — the trust surface is enumerated (§18).
- **P9 — Tests fail inside the interpreter.** Script spends are validated through the real BSV Script interpreter with Genesis rules on. Negative tests fail inside the interpreter, not inside a hand-written guard. Signature spot-checks are not acceptable as a substitute for running the script (§14.3).
- **P10 — Reproducible evidence.** Every reported number is regenerable from committed test vectors by a command that exits non-zero on any mismatch (§14.5).

## §0.3 Scope

**In scope (this program):**

- The platform core (engine, crypto, transaction layer, wallet, networking, persistence).
- Poker variants as game modules: Texas Hold'em, Omaha, Seven-Card Stud, Five-Card Draw, Razz. (Blackjack is tracked separately — §0.5 D7 — because dealerless blackjack is not the same symmetric mental-poker problem as poker and must not be smuggled in under the same model.)
- A self-contained runtime ("the VM", §10) that bundles a local BSV node in regtest mode, the relay, and the client so the whole thing launches with no external dependency.
- Windows desktop and web shells over one shared core (§11).
- Player discovery and table matchmaking (§8).
- Micro-betting integration via `bonded-subsat-channel` for sub-satoshi in-game value (§2.2), optional and behind a flag in early phases.

**Out of scope for the platform program, available as later tracks (not Phase 1):**

- Revocable encrypted-content NFTs (built on `overlay-broadcast`, §2.4) — a separate product track; the platform exposes the integration seam (§15.7) but ships no NFT product in the core poker phases.
- TEE-sealed key custody — **optional**, per direction. The architecture leaves the custody interface (§9.3) pluggable so a TEE backend can be added later without changing the protocol. No phase below requires a TEE.
- Real-money operation, KYC/AML, regulated gambling. The system is regtest-by-default; mainnet is opt-in behind an explicit research flag (§10.5). In-game tokens carry no external monetary value by default. This is not a regulated gambling product and the spec does not pretend otherwise (P8).
- Mobile (iOS/Android) native shells. The web shell is mobile-responsive; native mobile is a later track.

## §0.4 How to rename the project

Project name appears as: the npm scope `@bsv-poker/*`, the Go module path
`github.com/<owner>/bsv-poker`, the Tauri `productName`, and the VM image tag. Renaming
is: set `PROJECT_NAME`, `NPM_SCOPE`, `GO_MODULE`, `IMAGE_TAG` in `/build/project.env`
and run `scripts/rename.sh`. No source references the literal name outside generated
files.

## §0.5 Open decisions (override any of these; defaults are taken so the build is not blocked)

These are real choices. Defaults are chosen with rationale so design can proceed (per
the instruction to design, not to stall). Each is marked so it can be overridden in one
place.

- **D1 — First playable game.** DEFAULT: **Heads-up (2-player) No-Limit Texas Hold'em** on regtest. Rationale: Hold'em is the canonical mental-poker target (two private hole cards + shared board exercises concealment, selective reveal, and a real betting tree); heads-up removes multi-way side-pot complexity from the first milestone while still exercising the full pipeline (entropy commit/reveal, distributed shuffle, encrypted-card deal, betting FSM, showdown, settlement, timeout). Override sets `phase1.game`.
- **D2 — Table sizes for the platform.** DEFAULT: 2–9 seats; Phase 1 fixed at 2; Phase 3 enables 6-max; Phase 4 enables 9-max. Override sets `table.maxSeats` envelope.
- **D3 — Betting structures.** DEFAULT: No-Limit first; Pot-Limit and Fixed-Limit as betting-structure strategies behind one interface (§5.4). Override per game module.
- **D4 — Discovery for Phase 1.** DEFAULT: a small hosted **relay** (Go) for presence + table discovery + direct message fan-out, plus a **LAN auto-discovery** mode for zero-server same-network play. Full internet P2P with NAT traversal (§8.7) is Phase 5. Rationale: a relay that is transport-only (never source of truth, P3) is the shortest path to "find other players" across the internet without compromising determinism. Override sets `discovery.mode`.
- **D5 — "VM" interpretation.** DEFAULT: "FULL VM" = a reproducible, self-contained runtime image (container image + optional packaged VM image) bundling the local BSV node (regtest), the relay, and the client, launching end-to-end with no external services (§10). If a literal hypervisor VM image (e.g. OVA/qcow2) is required in addition to a container, that is `DECISION REQUIRED` and adds a packaging target in §16; the application architecture does not change.
- **D6 — Reuse the prof-faustus self-contained node.** DEFAULT: reuse the embedded BSV node shipped in `bonded-subsat-channel` (it already provides a native P2P-wire node, a proof-of-work header chain selecting longest-chain-by-work, a DB-backed block/UTXO store, a conflict-detecting mempool under the original replacement rule, and an HD wallet) as the platform's local chain backend (§10.2), rather than building a new node. Override sets `chain.backend`.
- **D7 — Blackjack.** DEFAULT: deferred to a separate track. Rationale: standard blackjack is player-vs-dealer; a dealerless blackjack needs a different settlement and concealment model than the symmetric poker shuffle and must be designed on its own terms, not forced into the poker pipeline (P7 forbids smuggling the difference). Override moves it into a phase with its own design section.
- **D8 — Currency/stake semantics in early phases.** DEFAULT: play-money chips with **no external monetary value**, settled on regtest, so no gambling-regulatory surface exists in Phases 1–4. Override is a serious decision with legal consequences and is out of this document's authority.

## §0.6 Glossary (authoritative; terms used precisely throughout)

- **Mental poker** — playing a card game over a network with no trusted dealer such that the shuffle is verifiable and no coalition below the full set can learn a concealed card before reveal.
- **Distributed/verifiable shuffle** — each player encrypts-and-permutes the deck in turn so the final order is the composition of all secret permutations and is unknown to any single player; each step can be proven a genuine permutation.
- **Commit-reveal** — a player publishes `H(value)` first (binding without disclosing), then later reveals `value`; prevents choosing "randomness" after seeing others'.
- **Combined public key** — for a card/element, the EC point-addition of one public key per party; the corresponding combined private key is the sum of per-party scalars. Whether it is reconstructed in one place depends on the signing mode (§4.3: Mode A reconstructs at reveal; Mode B does not). Spending the UTXO locked to the combined key is the close-out/settlement primitive, not the deal (GB2616862; §4.3).
- **Shuffle key** — an EC point `P' = (s, ±√(s³+7))` on secp256k1 whose x-coordinate is the private key `s`, with public key `P = s·G`; gives a bidirectional point↔scalar relationship used to mix private keys inside the set (GB2616862; §4.2).
- **Encrypted-card UTXO** — a card represented on-chain as a UTXO whose public identity is `(deck_id, card_serial, ciphertext_commitment, locking_script)` and whose face value is concealed until reveal (§4.5, §6.3).
- **Cooperative branch / timeout-default branch** — the two exits every actionable state has (P4).
- **Fair-play transaction** — a transaction whose locking script proves, in-script, that the private keys a party committed to actually derive the public keys and encrypted shuffle keys they used; a cheat that sends mismatched values forfeits the funds bonded to this transaction (GB2616862 §6.5.2; §4.7).
- **Ruleset hash** — `H` of the canonical-serialized game configuration (variant, stakes, blinds/antes, timeouts, seat count, deck format). Bound into every transaction so a branch cannot be replayed against a different context (§6.3, §5.2).
- **Relay** — transport + indexing service. Accelerates convergence and rebroadcast; never the source of truth (P3, §8.1).
- **The VM** — the self-contained runtime image bundling node + relay + client (§10), per D5.
- **Post-Genesis** — the BSV consensus state after the Genesis upgrade: no block-size cap, restored script capability, and specific opcode semantics that differ from BTC — notably the no-op status of `OP_CHECKLOCKTIMEVERIFY`/`OP_CHECKSEQUENCEVERIFY` (§6.2).

---

# §1 Product definition

## §1.1 What the user experiences

A player can: install on Windows or open the web app; create or import a wallet; set or
join a table (choosing variant, stakes, seat count, timeout profile); see the table
(seats, whose turn, community/up cards, pot(s), their own concealed hand decrypted
locally, timers and the exact consequence of inaction); take legal actions (check, bet,
call, raise, fold; draw/stand where the variant has it); reach showdown or win
uncontested; and see deterministic settlement. Every action the player takes is a signed
transaction; the UI shows when a signature is required and what it commits to.

## §1.2 User-facing capabilities (REQ register seed — full IDs in §13)

- REQ-PROD-001 Wallet create/import; key custody pluggable (§9).
- REQ-PROD-002 Lobby: list/create/join tables; presence of other players (§8).
- REQ-PROD-003 Ruleset + stake configuration with a displayed, hashed config (§5.2).
- REQ-PROD-004 Table view: seats, turn, board/up cards, pot(s), balances, timers, default-on-timeout text (§11.4).
- REQ-PROD-005 Local private-hand inspection (decrypt own cards; never expose keys to UI process beyond the custody boundary) (§9.3, §11.5).
- REQ-PROD-006 Signing prompts that state exactly what is being signed (§11.6).
- REQ-PROD-007 Fold-without-reveal action (P5).
- REQ-PROD-008 Showdown reveal of only what is required (§5.6).
- REQ-PROD-009 Deterministic settlement display + final balances (§5.7, §6).
- REQ-PROD-010 Transcript export + deterministic offline replay (§12.3).
- REQ-PROD-011 Reconnect/resume into a live table (§8.6).
- REQ-PROD-012 Clear research/regtest banner; mainnet behind explicit flag (§10.5).

## §1.3 Non-goals for the first release

No multi-table tournaments, no rake/operator economics, no NFT marketplace, no real-money
operation, no native mobile, no TEE requirement. The first release exists to prove the
full pipeline end-to-end for one variant on regtest with real player discovery.

---

# §2 Dependency stack and integration contracts

The platform consumes the existing BSV primitives. This section defines the **contracts**
the platform requires from each repository — the interface, the inputs/outputs, the
invariants, and the failure modes the platform depends on. Claude Code has the
repositories; integration wires the platform's adapter (§15) to each repo's actual API.
Where a repo's concrete API differs from a contract symbol below, the adapter maps it;
the platform core depends only on the contract, never on a repo's internals (this keeps
the core testable against fakes and prevents a repo change from rippling through the
engine).

## §2.1 `cardtable` — mental-poker engine and transaction-native game substrate

**Role:** the dealerless game substrate. Verifiable distributed shuffle, commit-reveal
entropy, encrypted-card UTXOs, and the cooperative/timeout-default transaction state
machine. First target game In-Between; the platform uses its *primitives*, not its game.

**Contract `CT` (consumed):**

- `CT.entropy.commit(secret) -> commitment` / `CT.entropy.reveal(commitment, secret) -> bool` — commit-reveal for shuffle randomness (§4.1).
- `CT.shuffle.*` — the verifiable distributed shuffle over an N-party set producing combined public keys per card and the per-party encrypted shuffle keys (§4.2–§4.4).
- `CT.card.*` — encrypted-card representation `(deck_id, card_serial, ciphertext_commitment, locking_script)`; conceal, locally-decrypt, prepare-reveal-proof, surrender-on-fold (§4.5, §4.6).
- `CT.fsm.*` — committed game-state transitions where each state UTXO has a cooperative successor and a timeout-default successor; transcript record and offline re-verification (§7).
- `CT.tx.*` — transaction-native event emission and the deterministic fallback graph (§6).

**Invariants the platform relies on (must hold or the platform's guarantees do not):**

- INV-CT-1 No single party learns the shuffle order (composition of secret permutations).
- INV-CT-2 A concealed card is decryptable only by its holder until reveal.
- INV-CT-3 Every game-state UTXO has exactly two valid successors (cooperative, timeout).
- INV-CT-4 Timelocks are enforced at the transaction level, never via in-script CLTV/CSV (§6.2). *(This is a stack-wide invariant; see §6.2.)*
- INV-CT-5 Zero fabrication / declared assumptions in its own outputs.

**Status taken as given (per the author's account):** protocol fully specified;
non-on-chain crypto and simulation layers runnable; early build phases substantively in
place; full multi-card game partial; first game In-Between. The platform therefore does
**not** assume Hold'em exists in `cardtable`; the platform builds the poker variants on
top of `CT` primitives (§5, §7).

## §2.2 `bonded-subsat-channel` — sub-satoshi micro-payments + self-contained node

**Role (two distinct uses):**

1. **Micro-betting** — sub-satoshi value movement for in-game stakes at chosen granularity `k`, with whole-satoshi on-chain settlement via the largest-remainder reconciliation `Q*`, and a fixed one-satoshi anti-cheat bond forfeited on a stale-state broadcast. Used for fine-grained chip movement off-chain in later phases (§5.7, §9.4). Optional and flag-gated in Phases 1–2.
2. **Self-contained local node** — its embedded BSV system (native P2P-wire node, PoW header chain longest-by-work, DB-backed block/UTXO store, conflict-detecting mempool under the original replacement rule, HD wallet) is the platform's local chain backend for the VM (§10.2), per D6.

**Contract `BS` (consumed):**

- `BS.node.*` — start/stop a local regtest node; submit tx; query UTXO/outpoint status; observe conflicts/double-spend attempts; block/header queries (§8.4, §10.2).
- `BS.channel.open/transfer/close/contested` — micro-payment channel lifecycle with `k`-granularity and 1-sat bond (§5.7).
- `BS.reconcile.Qstar(microBalances) -> integerSatoshiOutputs` — deterministic largest-remainder settlement; identical on every honest party (P2).

**Invariants:**

- INV-BS-1 No fractional output is ever written on-chain; sub-satoshi precision lives only in off-chain accounting.
- INV-BS-2 Risked capital is fixed (one satoshi/participant) independent of payment size/path length.
- INV-BS-3 Timing enforced at transaction level (nLockTime/nSequence under original replacement), not in-script (§6.2).

## §2.3 `verifiable-accounting` family — audit evidence and triple-entry

**Role:** turn disclosed game/financial records into examinable, anchored audit evidence
without revealing other records; optional enterprise persistence/audit (§12.4).

**Contract `VA` (consumed):**

- `VA.merkle.prove(records, index) -> bundle` / `VA.merkle.verify(bundle) -> bool` — Merkle inclusion against a BSV block header's `merkleroot`, terminating trust in the PoW header chain (Layer A).
- `VA.disclose.*` — selective disclosure: return only the queried record + its path; siblings remain opaque hashes (Layer B). Privacy is the selective disclosure itself; no extra cryptography is bolted on.
- `VA.chain.*` — PKI-root + GL key hierarchy, ECDH/spend-linked signed transaction chain, per-field disclosure (triple-entry).

**Invariants and stated boundary (must be reflected, not overstated, per P8):**

- INV-VA-1 Establishes only: inclusion, integrity, selective disclosure, arithmetic correctness over disclosed records.
- INV-VA-2 Does **not** establish truth-at-origin, that an event occurred, classification correctness, population completeness, or legal enforceability. A record entered falsely at origin in otherwise-consistent books is **not** detected. The platform MUST surface this boundary wherever it presents audit output.
- INV-VA-3 Commitments that must remain in the spend-linked graph are carried as **pushdata in a live script, not `OP_RETURN`** (§6.5).

## §2.4 `overlay-broadcast` — group access control, revocation, threshold custody

**Role (later track; seam exposed in core):** key-graph (Logical Key Hierarchy) broadcast
encryption with logarithmic rekeying, on-chain session lifecycle, **revocation expressed
as an unspent-expiring output**, and threshold key custody (FROST/GG20). The basis for
revocable encrypted-content NFTs (a separate product, not shipped in core poker phases),
and the home for **threshold custody of pot/winning keys** if the platform later splits
those keys (§9.3).

**Contract `OB` (consumed):**

- `OB.keygraph.*` — build/rekey a key-graph; add/remove members at `O(log n)`; wrap/unwrap with authenticated key-wrap (never raw XOR).
- `OB.session.*` — fund `k` sessions; renewal spends member output; **unspent past expiry = revoked** (the platform may not claim revocation beyond what this enforces, P8).
- `OB.custody.threshold.*` — split a key into shares; sign/reconstruct only by a threshold; no share (or sub-threshold set) reveals anything.
- `OB.ecies.*` / `OB.aead.*` — ECIES to a secp256k1 public key; AES-256-GCM AEAD.

**Invariants:**

- INV-OB-1 No key material crosses the wire in seed-isolated signalling; only positions do.
- INV-OB-2 Revocation is an on-chain fact (unspent expiring output), decided by no operator.
- INV-OB-3 Graded to NPR 7150.2 + Power of Ten with a requirements-traceability matrix — the platform adopts the same bar (§13).

## §2.5 Patent GB2616862 — the shuffle/selection/settlement primitive (normative reference)

**Role:** the cryptographic and on-chain mechanism the shuffle and settlement are built
on. Read in full; recorded. Provides, in plain BSV Script: shuffle keys
`P'=(s,±√(s³+7))`; per-element combined keys by point addition; selection = spend of the
combined-key UTXO; two-round encryption (shared scalar then per-element distinct scalars)
with reorder = the shuffle, reversed by inverse scalars at reveal; OP_RETURN stage
commitments; and worked settlement: 2-of-2 funding multisig, nLocktime refund,
locktime-tiered bet transactions, fair-play scripts, and an optional 2-of-3 trusted-third-party
enforcement. Applies to N parties and a 52-card deck by extension (the patent's worked
scripts are 2-party/3-card; scaling them is the platform's work — §6, §4).

**Citation discipline (P6):** cite as **GB2616862A** (the application as published,
2023-09-23) unless/until B-grant is independently confirmed; the v27 poker paper cites a
"B" (granted) form not confirmed by the application document. Licensing applicant:
nChain Licensing AG. Any deployment-licensing obligation is a business matter outside
this document's authority and is flagged, not resolved.

## §2.6 Dependency adapter principle

REQ-DEP-001 The platform core depends only on the contracts `CT/BS/VA/OB` above, accessed
through an adapter layer (§15.8). Each contract has a **fake/in-memory implementation**
used in unit and property tests for orchestration wiring only. REQ-DEP-002 A change in any
repo's concrete API is absorbed in its adapter; no change propagates into the engine,
the FSMs, or the UI. REQ-DEP-003 **Fakes are bound to reality by a conformance suite
(corrects RT-01 M4).** A single contract-conformance test suite per contract is run against
*both* the fake and the real adapter; both MUST pass it, so the fake provably matches the
real contract and a green run against the fake cannot certify a wrong engine. REQ-DEP-004
The **security-critical** behaviors — distributed shuffle correctness, reveal single-use,
fair-play forfeiture, combined-key signing — are tested against the **real** CT/crypto
implementations (and through the real Script interpreter for the on-chain parts, P9); fakes
are **never** permitted to stand in for the security property under test, only for
surrounding orchestration.

---

# §3 System architecture

## §3.1 Layered view

```
+--------------------------------------------------------------+
|  Client shells (§11)                                         |
|   - Web (React/TS/Vite)        - Windows desktop (Tauri)     |
|   shared UI core; no business logic in the shell             |
+--------------------------------------------------------------+
|  Application/SDK layer (§15)  — stable module contracts      |
+--------------------------------------------------------------+
|  Engine (deterministic core, §3.3)                           |
|   state-engine | game-modules | betting | pots | hand-eval   |
+----------------------+----------------------+----------------+
|  Crypto (§4)         |  Tx/Script (§6)      |  Networking (§8)|
|  mental poker        |  builders/templates  |  relay/P2P/sync |
+----------------------+----------------------+----------------+
|  Adapters (§2, §15.8): CT | BS | VA | OB                     |
+--------------------------------------------------------------+
|  Local chain backend (§10.2): bonded-subsat-channel node     |
|  (regtest by default; mainnet opt-in flag)                   |
+--------------------------------------------------------------+
|  Persistence (§12): IndexedDB (web) / SQLite (desktop+relay) |
+--------------------------------------------------------------+
```

## §3.2 Components and languages

- **Engine, crypto orchestration, tx building, game modules:** TypeScript (one core that runs in the browser and inside Tauri). Rationale: a single deterministic core shared by web and desktop removes the largest class of cross-platform divergence bugs; matches the lineage's React/TS/Vite client.
- **Relay, indexer, discovery, local-node supervision, matchmaking:** Go. Rationale: concurrency for many tables/sessions; matches the lineage's Go relay; the embedded node (D6) is Go.
- **Script interpreter tests:** executed against the real BSV Script interpreter with Genesis rules (the one used by the chosen node/SDK), driven from the test harness (§14.3).
- **Hand-evaluation hot path:** TypeScript with a documented, test-vector-backed algorithm (§5.3); a WASM implementation is an optional later optimization behind the same interface, only if profiling justifies it (no premature optimization — Power-of-Ten discipline).

## §3.3 The deterministic core boundary

REQ-ARCH-001 The engine is a pure function of inputs: `(orderedValidTxSet, ruleset) ->
tableState`. REQ-ARCH-002 The engine performs no I/O, no networking, no time reads, and
no randomness except via injected, recorded sources (entropy for this client's own
commit-reveal is drawn at a defined point and recorded in the transcript). REQ-ARCH-003
"Now" enters the engine only as an explicit parameter for timeout-eligibility evaluation
and is derived from chain/relay-anchored heights/timestamps per §6.4, never from local
wall-clock for consensus-affecting decisions. This boundary is what makes P2 and §14
replay testing possible.

## §3.4 Data-flow for one player action (normative sequence)

1. UI requests legal actions: `engine.getLegalActions(state, seat)` (§15.2).
2. Player chooses an action; SDK builds the corresponding transaction template (§6, §15.5).
3. Wallet/custody signs exactly the committed bytes; signing prompt states what is signed (§9, §11.6).
4. Action travels **two paths simultaneously** (§8.3): (a) to the local node/network as a real transaction; (b) directly to table peers via the relay/P2P for fast convergence.
5. Each peer validates and applies the action through the same engine; conflicting attempts resolved by §8.5 deterministic rules.
6. State advances; if the actor fails to act before the deadline, the timeout-default branch becomes valid and any peer may advance it (§6.4).

---

# §4 Cryptographic protocol: mental poker on BSV

This section fixes the cryptography. It adapts GB2616862 (§2.5) to secp256k1 as used by
BSV, and uses `cardtable` primitives (§2.1) for orchestration. All EC points are
secp256k1; `G` is the generator; `n` the group order. Point serialization is SEC-1
compressed 33-byte form for hashing/transmission; hash-derived keying material uses the
32-byte x-coordinate (RFC 5869 convention). The point at infinity is excluded.

## §4.1 Entropy: commit-reveal (no trusted dealer)

Each player `p` samples a high-entropy secret `r_p` from a recorded source, publishes
`c_p = H(r_p)` (commit), and later discloses `r_p` (reveal). Combined seed
`σ = H(r_1 ‖ … ‖ r_N)` (canonical party order, §4.4) seeds the deterministic shuffle
parameters. REQ-CRYPTO-001 Withholding a reveal after committing triggers a deterministic
penalty/fallback (§5.7, §6.4): timeout forfeiture or a committed fallback-seed rule, never
an operator decision. REQ-CRYPTO-002 No player may sample or alter `r_p` after observing
any other `r_q`; binding is by the commit hash and enforced by ordering (commits close
before any reveal opens).

## §4.2 Shuffle keys and per-card keys (GB2616862)

For each card index `j` and each player `p`, a shuffle key is the EC point
`P'_{p,j} = (s_{p,j}, +√(s_{p,j}³ + 7) mod p_field)` with private key `s_{p,j}` = the
x-coordinate, and public key `P_{p,j} = s_{p,j}·G`. The platform fixes the **positive**
square-root branch (the protocol must commit to one branch; mixing branches halves the
search space only if the branch choice leaks — §4.8). Per-card private keys are derived
deterministically inside the custody boundary from a per-game seed bound to `(gid, j)`
(HKDF), so a device stores one long-term key, not D per-card keys (§9.2).

## §4.3 Combined public key, card lifecycle, and the signing-mode decision

For card `j`, combined public key `Q_j = Σ_p P_{p,j}` (point addition); combined private
key `w_j = Σ_p s_{p,j} mod n`. `Q_j` locks a BSV UTXO. The per-card UTXO is the ownership
record and the state-machine anchor for that card.

**Card lifecycle (deal-to-positions; this is poker, not card-selection — corrects RT-01
B2).** GB2616862's worked game is highest-card-wins, where a player *selects* a card by
spending its combined-key UTXO. Poker does not deal that way. The platform uses the
covenant-chain lifecycle `minted → drawn(position) → revealed | folded → discarded`:

- **mint** — the 52 combined-key card UTXOs exist after the shuffle (§4.4), order unknown to any party.
- **draw(position)** — the *deal* operation binds a concealed card UTXO to a seat/board position as a committed state transition (§6.1 Deal class). This is the poker deal; it is **not** a player "selection." Drawing is driven by the protocol's deal schedule for the variant (§7), not by a player choosing which card to spend.
- **reveal | fold** — at showdown a drawn card is revealed (§4.6) or, on fold, surrendered without reveal (§4.6).
- **discard** — spent into a dead-hand/closed state at hand end.

"Selection-by-spend" of `Q_j` is therefore the **close-out / settlement** primitive used at
reveal/showdown and pot settlement (§5.7, §6.6) — **not** the deal. The terms are used with
this distinction throughout; "selection" is never used to mean "deal."

**Signing-mode decision (corrects RT-01 B1 — replaces the earlier unconditional "never
reconstructed in one place" claim, which contradicted the GB2616862 basis).** Spending a
`Q_j`-locked UTXO needs a signature under `Q_j`, i.e. knowledge of `w_j`. Two modes, with
consequences stated in ink:

- **Mode A — patent-literal, reconstruct-at-reveal (DEFAULT, Phase 1).** Per GB2616862
  (Fig. 15; pages 49, 59–61): at reveal, the relevant parties disclose their per-card
  scalars `s_{p,j}`; the party closing out sums to `w_j` and signs. **Consequences that
  MUST be honored:** (i) disclosed scalars are reusable secret material once revealed, so
  per-card keys are single-game and **never reused** (§9.2); (ii) funds locked to combined
  keys are active **only for the hand window** (hours), bounding exposure (GB2616862 pages
  39–40); (iii) the security argument is the patent's bounded-window argument — **not** "no
  whole key ever exists." This mode reconstructs `w_j` in one place at reveal, and the spec
  says so plainly.
- **Mode B — no-reconstruction, threshold/multi-party signing (UPGRADE, Phase 2+).**
  Produce the `Q_j` signature by a dealerless threshold/multi-party ECDSA so `w_j` never
  exists whole. This is the v27 improvement; it is **not** BSVM-specific and is therefore
  compatible with P1 (BSV-only). Pluggable via the custody backend (§9.3). Only Mode B may
  claim the "no whole-key reconstruction" property; Mode A may not.

REQ-CRYPTO-008 The build MUST NOT present Mode A while claiming Mode B's property. The
active mode is recorded in the ruleset (§5.2) and surfaced wherever key-handling guarantees
are shown to the player (P8). DECISION (D9): default Mode A for Phase 1; override sets
`crypto.signingMode`.

## §4.4 Distributed shuffle (two-round encryption + permute)

Per GB2616862 §6.2 and `CT.shuffle`: each party, in canonical order, (i) encrypts every
element by EC scalar multiplication and (ii) permutes the order; a first round uses a
shared scalar per party, a second round uses **distinct per-element scalars**, enabling
later per-element (per-card) selective reveal without revealing the whole set. Reversal at
reveal uses inverse scalars. REQ-CRYPTO-003 **Canonical party order** is the
lexicographic order of parties' long-term public keys in 33-byte SEC-1 compressed form;
it is computed deterministically, published as part of setup state, and is independent of
network arrival order (this fixes the HKDF/ordering inputs so a Dolev-Yao reorderer cannot
change derived keys). REQ-CRYPTO-004 Each shuffle stage is committed: `c_p = H(state_p ‖
scalars_p ‖ permutation_p)`, recorded on-chain (OP_RETURN acceptable for these dead-end
stage commitments, §6.5), enabling post-hoc dispute replay (§12.3).

## §4.5 Encrypted-card representation

A concealed card is `(deck_id, card_serial, ciphertext_commitment, locking_script)`
publicly; the face value is `face_j` (e.g. 6 bits: 2 suit + 4 rank) committed as
`cmt_j = H(face_j ‖ blind_j)` and/or carried as an AEAD ciphertext keyed by material only
the threshold set can derive (§4.6). REQ-CRYPTO-005 Mid-protocol substitution of a card's
ciphertext/commitment is rejected by a byte-equality check across state transitions
(§6.3) and by AEAD integrity at reveal.

## §4.6 Reveal (selective, recipient-bound) and fold-without-reveal

- **Private reveal (a player's own hole card):** the holder derives enough key material to decrypt locally; other players see only that a card object moved (P5). The platform's reveal binds disclosure to the specific card and recipient so disclosed material is single-use and not replayable across cards/positions/recipients. `[EXPAND: Part 2 — the exact single-use reveal token construction the platform adopts; candidate is the consensus-timestamped single-use ECDH token bound to (gid, j, position, height, recipient-ephemeral-key); this is recorded as the leading candidate, not yet fixed — DECISION REQUIRED after reading cardtable's reveal API.]`
- **Public reveal (board cards):** a board card is concealed under *every* party's encryption, so *producing* the reveal is an **N-of-N cooperative transition** — every party must release its decryption material — exactly like a player action, and it therefore has a **timeout-default branch** (corrects RT-01 M2): if a party withholds, the street cannot be revealed and the state resolves via the recovery path (§6.4) with bond slashing where configured (§2.2). Once produced, the published reveal material is verifiable by any observer against the commitment. A single withholder is a *liveness* failure (the hand stalls then defaults), never a confidentiality failure.
- **Fold:** a fold transaction proves the player controls their concealed hand outputs and surrenders them to a dead-hand state **without** disclosing face values; preserves the commitments; removes the player from contention (P5; §6.3 fold script).

## §4.7 Fair-play enforcement (anti-cheat without a trusted third party)

Per GB2616862 §6.5.2: each party commits, in a fair-play transaction, funds that can be
redeemed only by demonstrating in-script that the private keys they used derive the public
keys and the encrypted shuffle keys they sent. A party who sends mismatched values cannot
redeem and forfeits those funds — making honest play the rational outcome without a
referee. REQ-CRYPTO-006 The platform generates fair-play transactions after shuffle/
encryption and before reveal; the fair-play locking script is built from the in-script
shuffle-point-derivation and EC-point-multiplication routines (GB2616862 pages 55–60).
REQ-CRYPTO-009 **Fair-play scaling is a measured risk, not an assumed parameter change
(corrects RT-01 M3).** GB2616862's worked fair-play script is a long nested
`OP_IF`/`OP_ELSE` structure for **3 elements and 2 parties**; for a 52-card deck and N
parties the single-script proof may be very large. Post-Genesis BSV has no script-size cap,
so it is not impossible, but the byte size, fee, and constructibility are unverified. The
build MUST **measure** the fair-play script size for the target deck/party counts (recorded
in §19.C) before relying on a single-script approach, and MUST implement the fallback —
**per-card or per-batch fair-play transactions** — if a single script proves impractical.
The spec does not assert fair-play "scales" until §19.C carries a measured byte schedule. An
optional 2-of-3 TTP enforcement (GB2616862 §6.5.1) is available as a separate, opt-in script
profile (§6.7); it is not used by default (P3 prefers no third party).

## §4.8 Security parameters and stated limits (P8)

- REQ-CRYPTO-007 Fix one square-root branch for shuffle keys; keep the branch choice consistent and treat any protocol that would expose both branches' selection as reducing the key search space by a factor of 2 (GB2616862 pages 39–40). Funds locked to shuffle-derived keys are active only for the shuffle interaction window (hours), bounding exposure.
- Stated limits to carry forward (not to paper over): N-of-N reveal means any single withholder halts that reveal (a liveness, not confidentiality, failure) — bounded by the timeout-default branch and bond slashing; a threshold (t, N) variant trades collusion-resistance for liveness and is an explicit later option; the protocol is non-custodial-at-reveal and no-single-dealer but is **not** unconditionally trustless — its trust surface (DDH on secp256k1; correct off-chain execution; primitive soundness; node/consensus integrity; custody backend) is enumerated in §18.

## §4.9 Participant set per hand (corrects RT-01 m1)

REQ-CRYPTO-010 The shuffle is N-of-N over the **currently-seated set**, and **each hand is
a fresh N-party shuffle**: a new combined seed (§4.1), new shuffle keys (§4.2), new per-card
combined keys (§4.3), and a new canonical party order (§4.4) are generated for every hand.
REQ-CRYPTO-011 Sit-out and join take effect **between hands only**; the participant set is
frozen at hand start and is an input to the canonical party order (so the order is well
defined and identical for all). REQ-CRYPTO-012 There is **no partial reshuffle** of an
in-progress deck and no mid-hand change to the party set; a player who disconnects mid-hand
is handled by the timeout-default/recovery path (§6.4), not by re-deriving the deck.

## §4.10 `[EXPAND: Part 2]` Full message-flow diagrams, the fixed reveal-token construction, and the per-card key-derivation schedule with test vectors.

---

# §5 Poker domain model

This is game logic, independent of chain and crypto. It is large by nature; specified
rigorously here so the FSMs (§7) and transactions (§6) bind to a precise model.

## §5.1 Cards and deck

Standard 52-card French deck. Rank order high→low: A K Q J T 9 8 7 6 5 4 3 2 (Ace high);
Ace also plays low for the wheel (A-2-3-4-5) in high-hand straights and is the lowest in
ace-to-five low (§5.3.3). Suits {c,d,h,s} are equal in rank (no suit precedence in poker
hand comparison). Canonical card encoding: `card = rank*4 + suit`, `rank∈0..12`
(2=0 … A=12), `suit∈0..3` (c=0,d=1,h=2,s=3). `card_serial∈0..51`. REQ-POKER-001 The deck
encoding is fixed and is the same one bound into the shuffle (§4) and the transaction
schemas (§6).

## §5.2 Ruleset and its hash

A `Ruleset` fixes: variant; betting structure (NL/PL/FL); seat count; blind/ante schedule;
bring-in (stud); min/max buy-in; bet/raise sizing rules; number of raises cap (FL); timeout
profile (decision timeout, recovery timeout); deck format; and currency semantics (D8).
REQ-POKER-002 `rulesetHash = H(canonicalSerialize(Ruleset))` is computed once at table
creation, displayed to all players, and bound into every transaction (§6.3) so no branch
can be replayed under a different ruleset. Canonical serialization is defined in §19.A
`[EXPAND: Part 3]`.

## §5.3 Hand evaluation (authoritative)

A 5-card poker hand is compared by category then by tie-break ranks. The evaluator returns
a totally-ordered comparable value so that `compare(handA, handB) ∈ {-1,0,+1}` is exact and
transitive. REQ-POKER-003 The evaluator is pure, deterministic, and backed by the
test-vector catalog in §19.D `[EXPAND: Part 3]` (including all category boundaries, wheel
straights, and tie/kicker edge cases).

### §5.3.1 High-hand categories (high→low)

1. Straight flush (five consecutive ranks, same suit; royal flush is the ace-high case; wheel A-2-3-4-5 is the lowest straight flush).
2. Four of a kind (quads + 1 kicker).
3. Full house (trips + pair; compare trips, then pair).
4. Flush (five of one suit; compare ranks high→low).
5. Straight (five consecutive ranks, mixed suits; wheel is lowest).
6. Three of a kind (trips + 2 kickers).
7. Two pair (high pair, low pair, 1 kicker).
8. One pair (pair + 3 kickers).
9. High card (5 ranks high→low).

Tie-breaking compares the ordered relevant ranks lexicographically; suits never break
ties. REQ-POKER-004 The "best 5 of 7" selection (Hold'em/Stud) enumerates the C(7,5)=21
five-card subsets and takes the maximum by `compare`; Omaha uses the constrained selection
in §5.3.2.

### §5.3.2 Omaha constraint

Exactly **two** of the four hole cards plus exactly **three** of the five board cards form
the hand. REQ-POKER-005 The evaluator enumerates C(4,2)·C(5,3)=6·10=60 combinations and
takes the maximum; this constraint is mandatory and is a frequent source of bugs if the
generic best-of-7 is used by mistake — it is a separate, tested code path.

### §5.3.3 Low-hand evaluation (Razz; hi-lo split games later)

Razz uses **ace-to-five low**: aces are low, straights and flushes do not count against
the hand, and the best hand is the lowest five distinct ranks; the best possible is the
wheel A-2-3-4-5 ("the bicycle"). REQ-POKER-006 Low evaluation returns a comparable where
lower is better; pairs are penalized per ace-to-five rules; the implementation is a
distinct, test-vectored path from high evaluation. (Eight-or-better hi-lo split, if a
later variant needs it, qualifies a low only with five distinct ranks ≤8 — `[EXPAND: Part
2]`.)

### §5.3.4 Performance note (Power-of-Ten discipline)

REQ-POKER-007 The evaluator must be correct first and fast second. The reference
implementation is straightforward enumeration with a fixed, bounded loop count (21 or 60),
satisfying bounded-loop rules. A lookup-table/perfect-hash optimization is permitted only
behind the same interface and only if profiling on the target shows it is needed; it must
reproduce the reference evaluator on the entire §19.D vector set bit-for-bit.

## §5.4 Betting structures and the betting state machine

REQ-POKER-008 Betting is a strategy behind one interface `BettingStructure`:
`legalBets(state, seat) -> {check?, call?: amount, bet?: {min,max}, raise?: {min,max},
fold}` and `applyBet(state, seat, action) -> state'`. Strategies: No-Limit (max = stack),
Pot-Limit (max = current pot + call), Fixed-Limit (fixed small/big bet sizes, capped number
of raises). REQ-POKER-009 The betting machine tracks: each seat's stack, committed-this-round,
total-committed-this-hand, current bet-to-call, last full raise size (for min-raise legality),
who is all-in, who has acted since the last aggressive action, and round-closed condition.
REQ-POKER-010 A betting round closes when action returns to the last aggressor with all
non-folded, non-all-in players having matched the current bet (or checked through). All-in
for less than a full raise does **not** reopen the betting to players already acted unless
it constitutes a full raise (standard rule; tested).

## §5.5 Pots and side pots

REQ-POKER-011 The pot engine computes a **main pot** and ordered **side pots** from per-seat
total contributions when one or more players are all-in for differing amounts. Algorithm:
sort distinct all-in/contribution thresholds ascending; for each threshold layer, every
player who contributed at least that layer contributes the layer increment to that pot, and
the set of players eligible for that pot is exactly those still contending at that layer;
remainder above the top all-in forms a pot contested only by players who matched it.
REQ-POKER-012 Each pot is awarded independently at showdown to the best eligible hand
(ties split with odd-chip rule §5.5.1). The algorithm is specified to the level of a
reference implementation with a worked multi-all-in example in §19.B `[EXPAND: Part 3]`.

### §5.5.1 Odd-chip and split rules

REQ-POKER-013 On a split pot, chips divide as evenly as the chip granularity allows; the
odd chip(s) go by a fixed deterministic rule: **DEFAULT — to the tied winner closest to the
left of the button.** Poker hand ranking has **no suit precedence** (corrects RT-01 m3); a
suit-based tiebreak is *only* a house rule (e.g. some stud rooms), is **defaulted OFF**, is
carried as an explicit ruleset flag, and MUST NOT be implemented inside hand evaluation
(§5.3) — it is a pot-award tiebreak, never a hand comparison. This is a determinism
requirement (P2): all clients award the odd chip identically from the ruleset.

## §5.6 Showdown and minimum reveal

REQ-POKER-014 At showdown, only contenders for a pot reveal, and reveal only what is
needed to adjudicate. Last aggressor shows first; others may show or muck in turn; a player
who would lose may muck without revealing if they cannot win any contested pot (standard
"show one, show all" house variations are a ruleset flag). REQ-POKER-015 A revealed hand
is verified against the player's concealed-card commitments (§4.5) before it can win
(§6.3 reveal script).

## §5.7 Settlement and chip movement

REQ-POKER-016 Hand settlement routes each pot to its winner(s) per §5.5/§5.6 and updates
stacks. On-chain, settlement is a transaction spending the pot/stake structure to the
winner(s) (§6.3 settlement script) or, in micro-betting mode, a `BS` channel update that
re-divides locked value with whole-satoshi reconciliation via `Q*` (§2.2). REQ-POKER-017
If settlement stalls (a winner unreachable, a co-signer absent), the recovery/timeout path
(§6.4) resolves value deterministically; funds are never stranded (P4).

## §5.8 `[EXPAND: Part 2]` Full per-variant rules: Hold'em (done in §7), Omaha, Seven-Card Stud (antes, bring-in, streets, up/down cards), Five-Card Draw (draw/replace), Razz (low, stud structure). Each gets a complete rules section + FSM (§7) + transaction mapping (§6).

---

# §6 BSV transaction and Script model

The executable skeleton. Each protocol state and legal successor maps to enforceable value
movements and branch activations. Every transaction binds to the exact state it spends so a
branch cannot be replayed against a different context.

## §6.1 Transaction classes

| Class | Purpose |
|---|---|
| Funding | Lock player stakes into the table/pot structure; bind `gid` + `rulesetHash` |
| Commitment | Anchor entropy commits and per-stage shuffle commits (§4.1, §4.4) |
| Deal | Assign concealed card UTXOs to seats (§4.5) |
| Action | A player's in-window move (check/bet/call/raise) |
| Timeout | Default branch after a decision deadline (no player participation) |
| Reveal | Disclose committed card material with proof (§4.6, §5.6) |
| Fold | Surrender concealed hand without reveal (§4.6) |
| Fair-play | In-script proof that committed keys match used keys (§4.7) |
| Settlement | Route pot(s) to winner(s) (§5.7) |
| Recovery | Longer-timeout unwind/refund for stalled sessions (§6.4) |
| Table mgmt | TABLE_CREATE/JOIN/LOCK/ABORT/CLOSE |

(Wire names are implementation detail; these are conceptual classes.)

## §6.2 Post-Genesis BSV Script constraints (CRITICAL — P1, and a correction)

REQ-TX-001 **`OP_CHECKLOCKTIMEVERIFY` (CLTV) and `OP_CHECKSEQUENCEVERIFY` (CSV) are no-ops
on post-Genesis BSV** and MUST NOT be used to enforce timing. A script relying on them
enforces nothing. This corrects any earlier/generic design (including the platform's own
architecture lineage) that listed CLTV/CSV among required opcodes. REQ-TX-002 Where timing
is needed (decision timeouts, recovery windows, refund maturity), enforce it at the
**transaction level** using `nLockTime` and the input `nSequence` field under the original
transaction-replacement rule — mechanisms that operate on the transaction as a whole and
remain meaningful post-Genesis. REQ-TX-003 Combined with the economic bond-forfeiture
incentive where applicable (§2.2), transaction-level timing is sufficient for the
cooperative/timeout branch model (P4). REQ-TX-004 The opcode palette the platform uses is
limited to primitives that mean something post-Genesis: signature checks
(`OP_CHECKSIG`/`OP_CHECKSIGVERIFY`/`OP_CHECKMULTISIG`), hash/equality
(`OP_SHA256`/`OP_HASH160`/`OP_HASH256`/`OP_EQUAL`/`OP_EQUALVERIFY`), conditionals
(`OP_IF`/`OP_ELSE`/`OP_ENDIF`/`OP_VERIFY`), and the numeric/stack ops needed for the
fair-play EC routines (`OP_MUL`/`OP_ADD`/`OP_MOD`/`OP_DUP`/`OP_SWAP`/`OP_ROT`/
`OP_TOALTSTACK`/`OP_FROMALTSTACK`/`OP_2DUP`/`OP_NOTEQUAL`, etc., as in GB2616862 pages
55–60).

## §6.3 Branch binding (anti-replay)

REQ-TX-005 Every transaction binds, at minimum: `gid` (game id), `rulesetHash`, round
number, state hash, acting seat (where relevant), economic state, board/up cards,
concealed-commitment references, and a successor-state commitment. This prevents
cross-state replay and stale-branch misuse. State carried across card-state transitions is
checked byte-for-byte (e.g. the card ciphertext slot equality, §4.5) so substitution fails
the script.

## §6.4 Timeout and recovery (transaction-level)

REQ-TX-006 Two timeout layers: a short **decision timeout** (default-on-inaction for a
specific action — for poker the safe default is check if checking is legal, else
fold/forfeit; never a forced wager, which would create asymmetric exploitable risk) and a
longer **recovery timeout** (withheld reveal, stalled settlement, lost quorum) that unlocks
or redistributes value from the last valid committed state. REQ-TX-007 "Now" for these is
derived from chain/relay-anchored height/time (§3.3 / §8), not local wall-clock for
consensus-affecting decisions. REQ-TX-008 A **pre-signed fallback graph** is signed before
play for: table-abort refund, no-quorum unwind, deck-build timeout, deal timeout, action
timeout default, showdown/reveal timeout forfeit, settlement timeout, table-closure refund.
After the relevant maturity, value reverts through an already-authorized path — by script
graph design, not goodwill.

## §6.5 Commitment carriage: OP_RETURN vs pushdata

REQ-TX-009 Dead-end commitments that need only be anchored (shuffle stage commits,
ruleset-hash anchoring) MAY use `OP_RETURN` (per GB2616862). REQ-TX-010 Commitments that
must remain inside the spend-linked, chainable transaction graph (e.g. audit/triple-entry
links via `VA`, §2.3) MUST be carried as **pushdata in a live script, not `OP_RETURN`**.
The distinction is functional, not stylistic.

## §6.6 Script templates (scaled from GB2616862's 2-party worked examples)

The platform requires the following template families. GB2616862 gives 2-party/3-card
worked scripts; the platform parameterizes them for N parties and the deck size. Each
template is specified to byte-schedule level in §19.C `[EXPAND: Part 3]`; the structure:

- **Funding template** — N-of-N (or threshold) multisig over player buy-ins; binds `gid`+`rulesetHash`; companion refund (nLockTime maturity) pre-signed.
- **Per-card selection/close-out lock** — UTXO locked to combined key `Q_j` (§4.3); its spend is the close-out/settlement primitive (not the deal). Signed per the active signing mode (§4.3): Mode A reconstructs `w_j` at reveal and signs; Mode B uses threshold/multi-party signing with no whole-key reconstruction.
- **Concealed-card custody** — assignment to seat; fold-surrender path; reveal path; reclaim-on-timeout path, all conditioned by signatures and the state checks of §6.3 (timing at tx level, §6.2).
- **Reveal-or-timeout** — one branch accepts a valid reveal opening before maturity (hash-opening check `H(face‖blind)=cmt`); the other reverts/forfeits after maturity (nLockTime).
- **Fold** — proves control of concealed outputs, transfers to dead-hand, preserves commitments (no face disclosure).
- **Pot/settlement** — pays winner(s) on valid winning proof + signatures; or cooperative-signature distribution; or timeout refund branch.
- **Fair-play** — the in-script shuffle-point-derivation + EC-point-multiplication proof (GB2616862 pages 55–60); redeemable only if committed keys derive used keys; forfeited otherwise. Scaling beyond the patent's 3-element example is a measured risk (REQ-CRYPTO-009): a single 52-card N-party script may be impractical; the fallback is per-card/per-batch fair-play transactions, decided by the §19.C measurement.
- **Optional 2-of-3 TTP** — opt-in profile adding a partially-trusted third signer for dispute-only intervention (GB2616862 §6.5.1); off by default.

REQ-TX-011 Each template ships with: a positive test (valid spend accepted by the
interpreter), a battery of negative tests (each supposed-to-fail case fails **inside** the
interpreter, P9), and a measured wire-byte size recorded as a reproducible vector (P10).

## §6.7 Signing of combined-key UTXOs (per the §4.3 mode decision)

REQ-TX-012 Spending a `Q_j`-locked UTXO requires a signature valid under `Q_j`, produced
per the active signing mode (§4.3), surfaced via the pluggable custody backend (§9.3):

- **Mode A (DEFAULT, Phase 1):** the closing party reconstructs `w_j = Σ_p s_{p,j}` from
  the scalars disclosed at reveal and signs. This closes the Phase-1 signing question with a
  concrete, patent-faithful construction — no threshold cryptography is required to ship
  Phase 1. The Mode-A consequences (single-game keys, bounded hand-window exposure) from
  §4.3 apply and are enforced in §9.2.
- **Mode B (UPGRADE, Phase 2+):** a dealerless threshold/multi-party ECDSA (an `OB.custody`
  FROST/GG20 backend is the candidate) produces the signature with no whole-key
  reconstruction.

In both modes the output signature MUST verify at `OP_CHECKSIG` and be indistinguishable
from an ordinary signature at verification. `[EXPAND: Part 2 — the Mode-B construction is
fixed only after reading cardtable's signing API; recorded candidate is dealerless threshold
ECDSA. Mode A requires no such dependency and is fully specified here.]`

## §6.8 `[EXPAND: Part 3]` Full byte schedules, sighash/`SIGHASH` flag choices per template, and the complete pre-signed fallback-graph transaction set.

---

# §7 Game state machines (framework + Texas Hold'em reference)

## §7.1 FSM framework

REQ-FSM-001 A game module implements `GameModule`:
`init(ruleset, seats) -> GameState`, `getLegalActions(state, seat) -> Action[]`,
`apply(state, action) -> GameState`, `isTimeoutEligible(state, now) -> {seat, defaultAction}?`,
`isHandComplete(state) -> bool`, `settle(state) -> Payouts`, plus serialization. The engine
(§3.3) drives modules; modules contain **no** I/O, networking, time, or randomness (P2).
Every state node enumerates its legal successors including the timeout-default (P4).

## §7.2 Texas Hold'em (Phase-1 reference; heads-up first)

Phases of a hand (each a committed state; each actionable phase has cooperative + timeout
exits): post blinds → deal 2 concealed hole cards/seat → preflop betting → reveal flop (3
board) → flop betting → reveal turn (1 board) → turn betting → reveal river (1 board) →
river betting → showdown (minimum reveal §5.6) → settle (§5.7) → next hand (button moves).
Heads-up specifics (button posts small blind and acts first preflop, second postflop) are
encoded in the betting order. REQ-FSM-002 The full Hold'em state-transition table — every
state, trigger, guard, successor, and timeout-default — is specified in §19.E `[EXPAND:
Part 2]`; the prose flow here is normative for the phase order and the two-exit rule.

## §7.3 Other variants (FSMs)

All variants reuse the §7.1 `GameModule` interface and the two-exit rule (P4). Each is
specified as its rules, the **mental-poker primitives it uses** (up-card vs down-card
reveals, the draw operation), and a transition table or an explicit delta from the Hold'em
table (§19.E). New requirements continue the `REQ-FSM-*` series.

### §7.3.0 Up-cards, down-cards, and the draw — the three new primitives

REQ-FSM-003 A **down-card** is dealt by the `draw(position)` operation (§4.3) and then
**privately revealed to its holder only** (§4.6 private reveal). An **up-card** (stud/razz)
is dealt by the same `draw(position)` operation and then **immediately publicly revealed**
by an **N-of-N cooperative reveal** (§4.6 public reveal, with the timeout-default of
RT-01 M2). REQ-FSM-004 The **draw** operation (five-card draw) is: the player surrenders a
chosen subset of their concealed card UTXOs to a dead-hand state **without revealing them**
(a partial fold, §4.6) and is dealt the same number of fresh concealed card UTXOs from the
still-undealt portion of the shuffled deck (§4.3 `draw`). The discarded cards are never
revealed; the replacements are private-revealed to the drawer only. REQ-FSM-005 Because
stud/razz expose up-cards, **betting order is determined by the exposed board**, not by the
button (see each variant); this is a distinct ordering function in the engine and is tested
separately.

### §7.3.1 Omaha (and Pot-Limit Omaha)

**Rules.** Structurally identical to Texas Hold'em (§19.E): blinds, four betting streets
(preflop/flop/turn/river), a shared five-card board revealed 3-1-1. **Differences:** each
seat is dealt **four** concealed hole cards (not two), and at showdown the hand is formed
from **exactly two hole + exactly three board** (§5.3.2, REQ-POKER-005 — the C(4,2)·C(5,3)=60
evaluation, verified in §19.D). The common betting structure is **Pot-Limit** (PLO; §5.4),
though NL/FL Omaha are selectable per ruleset (D3). REQ-FSM-006 Omaha is the Hold'em FSM
(§19.E) with two overrides: (i) `DEAL_HOLE` draws **4** concealed cards per seat; (ii)
`SHOWDOWN` uses the Omaha-constrained evaluator. No other state changes.

**FSM delta from §19.E (heads-up; generalises to multi-way exactly as Hold'em does):**

| §19.E state | Omaha override |
|---|---|
| S3 DEAL_HOLE | draw **4** concealed cards/seat (not 2); commitments recorded as in §4.5 |
| S11 SHOWDOWN | evaluate by Omaha exactly-2+3 (§5.3.2); everything else (min reveal, verification vs commitments) identical |

REQ-FSM-007 **Omaha Hi-Lo (Omaha-8)** is a later variant: it adds an ace-to-five
eight-or-better *low* split (§5.3.3) awarding half each pot to the best qualifying low (five
distinct ranks ≤ 8); the low evaluator and the pot-split-into-high-and-low are a distinct,
test-vectored path and are not in the Phase-3 Omaha module unless `ruleset.hiLo` is set.

### §7.3.2 Seven-Card Stud (high)

**Rules.** No community cards, no blinds. Every player posts an **ante**. Cards per player
across five betting rounds ("streets"):

- **3rd street:** two down + one up (the "door card"). The **lowest up-card** (by rank,
  ties broken by a fixed suit order used **only** for the bring-in selection, declared in
  the ruleset — this is a forced-bet selector, not hand-evaluation suit precedence, cf.
  RT-01 m3) posts the **bring-in**. Betting at the small-bet level.
- **4th street:** one up. From here on, the **highest exposed (board) hand acts first**
  (REQ-FSM-005). In Fixed-Limit, an open pair on 4th street allows either bet level.
- **5th street:** one up. Big-bet level from here.
- **6th street:** one up.
- **7th street ("the river"):** one down.
- **Showdown:** best **5 of 7** (§5.3, REQ-POKER-004).

Typical structure is **Fixed-Limit** (D3). REQ-FSM-008 With 8 players, 7 cards each would
need 56 > 52; if the deck is exhausted before 7th street, the final card is dealt as a
**single shared community up-card** (N-of-N reveal) used by all remaining players —
otherwise the practical table max is 7. The seated-set/no-reshuffle rule (§4.9) still
applies per hand.

**FSM (one hand; "BET\_n" rounds have cooperative round-close + per-actor timeout-default
of check/fold per §6.4):**

| State | Entry | Deal / reveal | Betting / order | Cooperative successor | Timeout-default |
|---|---|---|---|---|---|
| S0 ANTE | seats funded | — | all post ante | S1 SHUFFLE | RECOVERY (abort refund) |
| S1 SHUFFLE | from S0 | entropy commit + shuffle stages (§4.1/§4.4) | — | S2 THIRD | RECOVERY |
| S2 THIRD | from S1 | draw 2 down (private) + 1 up (N-of-N reveal) per seat | bring-in = lowest up-card; small-bet betting | round-close → S3; folds reduce field | timeout → bring-in default-post / others check-fold |
| S3 FOURTH | from S2 | draw 1 up (N-of-N reveal) | highest board first; small bet (open pair → either) | round-close → S4 | timeout → check/fold |
| S4 FIFTH | from S3 | draw 1 up | highest board first; big bet | round-close → S5 | timeout → check/fold |
| S5 SIXTH | from S4 | draw 1 up | highest board first; big bet | round-close → S6 | timeout → check/fold |
| S6 SEVENTH | from S5 | draw 1 **down** (private) | highest board first; big bet | round-close → S7; fold → FOLD\_END | timeout → check/fold |
| S7 SHOWDOWN | from S6 | min reveal (§5.6); verify vs commitments | last aggressor shows first | S8 SETTLE | RECOVERY (reveal timeout forfeit) |
| S8 SETTLE | S7/FOLD\_END | — | best 5-of-7; side pots §19.B | S9 HAND\_END | RECOVERY |
| FOLD\_END | one live player remains | award uncontested, no reveal (P5) | — | S8 SETTLE | — |
| S9 HAND\_END | from S8 | re-seat sit-out/join (§4.9) | — | S0 ANTE (next) / TABLE\_CLOSE | TABLE\_CLOSE |

### §7.3.3 Five-Card Draw

**Rules.** Blinds (or antes per ruleset). Each seat dealt **5 concealed** cards. One
betting round; then the **draw** (each player, in turn, discards 0–5 cards and draws the
same number of fresh concealed cards — REQ-FSM-004); then a second betting round; then
showdown of the **5 cards held** (§5.3). NL/PL/FL selectable (D3). REQ-FSM-009 The draw
must preserve concealment: discards go to dead-hand **without reveal**, replacements are
drawn from the still-undealt shuffled deck and private-revealed to the drawer only; the
number drawn is public (it is observable game information) but the card identities are not.

**FSM (heads-up reference):**

| State | Entry | Deal / reveal | Betting | Cooperative successor | Timeout-default |
|---|---|---|---|---|---|
| S0 BLINDS | seats funded | — | post blinds | S1 SHUFFLE | RECOVERY |
| S1 SHUFFLE | from S0 | entropy + shuffle stages | — | S2 DEAL | RECOVERY |
| S2 DEAL | from S1 | draw 5 concealed/seat (private) | — | S3 BET1 | RECOVERY (deal timeout) |
| S3 BET1 | from S2 | — | first round | round-close → S4; fold → FOLD\_END | check/fold |
| S4 DRAW | from S3 | each in turn: discard 0–5 (dead-hand, no reveal) + draw replacements (private) | — | S5 BET2 | timeout → **stand pat** (draw 0) |
| S5 BET2 | from S4 | — | second round | round-close → S6; fold → FOLD\_END | check/fold |
| S6 SHOWDOWN | from S5 | min reveal (§5.6); verify vs commitments | last aggressor first | S7 SETTLE | RECOVERY (reveal timeout) |
| S7 SETTLE | S6/FOLD\_END | — | best-5; side pots §19.B | S8 HAND\_END | RECOVERY |
| FOLD\_END | one live player | award uncontested, no reveal | — | S7 SETTLE | — |
| S8 HAND\_END | from S7 | re-seat (§4.9); button moves | — | S0 BLINDS / TABLE\_CLOSE | TABLE\_CLOSE |

REQ-FSM-010 The S4 DRAW timeout-default is **stand pat** (draw zero) — the safe default
that forfeits no information and no equity beyond declining to improve.

### §7.3.4 Razz (Seven-Card Stud low)

**Rules.** Seven-Card Stud **structure** (ante; streets 3–7; two down, four up, one down;
best 5 of 7) but the **lowest** hand wins by **ace-to-five low** (§5.3.3, REQ-POKER-006;
straights and flushes do not count, aces are low, best is the wheel A-2-3-4-5 — verified in
§19.D). Order reversals versus stud-high:

- **3rd street bring-in = the HIGHEST up-card** (high is bad in lowball; ties by the same
  declared forced-bet suit order, not hand-eval suit precedence).
- **4th–7th streets: the LOWEST (best) exposed board acts first.**

REQ-FSM-011 Razz is the §7.3.2 stud FSM with three overrides: (i) bring-in selector = highest
up-card; (ii) post-3rd betting order = best (lowest) exposed low first; (iii) showdown
evaluator = ace-to-five low (§5.3.3). No open-pair big-bet rule applies (it is meaningless
for low). The 8-player exhaustion rule (REQ-FSM-008) applies identically.

**FSM delta from §7.3.2 (stud):** identical state graph S0–S9; replace the bring-in selector,
the acting-order function, and the showdown evaluator as in REQ-FSM-011.

---

# §8 Networking, discovery, matchmaking, anti-stall

## §8.1 Roles

REQ-NET-001 The **relay** is transport + indexing only; it is never the source of truth
(P3). It accelerates convergence, rebroadcasts, indexes table transactions, schedules
timeout notices, and assembles transcripts. The truth is the validated transaction graph,
reconstructed identically by each client (P2).

## §8.2 Two-tier model

REQ-NET-002 Tier A (discovery): presence and address gossip — Phase 1 via the hosted relay
and a LAN auto-discovery mode (D4); Phase 5 adds a Bitcoin-style version/verack/getaddr/addr
peer layer. Tier B (game-object propagation): table-scoped inventory/object relay
(inv/getdata/object) with per-table channels for fast convergence (Bitmessage-style),
Phase 1 via the relay's table-scoped fan-out.

## §8.3 Dual-path propagation

REQ-NET-003 Every action is sent simultaneously (a) to the node/network as a real
transaction (canonical path: mempool presence, double-spend observability, eventual
confirmation) and (b) directly to table peers via the relay/P2P (speed path: fast local
state convergence, propagation-delay tolerance). The speed path never overrides the
canonical path; conflicts resolve by §8.5.

## §8.4 Node/chain interface

REQ-NET-004 Via `BS.node` (§2.2): broadcast tx; query outpoint/UTXO status; observe
double-spend-attempt status; header/block queries; mempool conflict signals under the
original replacement rule. The platform tracks its own table-level rebroadcast and peer
visibility and can resubmit missing transactions (mempool contents can change; the table
system does not rely on mempool memory alone).

## §8.5 Deterministic conflict resolution

REQ-NET-005 For each actionable phase there is exactly one spendable phase-right
(state UTXO). Two conflicting actions for the same phase cannot both be valid: the accepted
successor is the one referenced by the next accepted state transition; later conflicting
attempts are invalid relative to the accepted path. REQ-NET-006 Where a deterministic local
tie-break is needed before phase close, the rule is fixed (DEFAULT: first valid transaction
referenced by a threshold of peers; final tie-break by lexicographic txid). A double-spend
attempt is made strategically useless by the timeout-default branch (an absent/conflicting
actor is defaulted/folded; the hand proceeds).

## §8.6 Reconnect/resume

REQ-NET-007 A client can request the transcript gap from a peer/relay and rebuild current
state deterministically from the valid transaction set; resuming changes nothing about the
truth, only this client's view (P2).

## §8.7 `[EXPAND: Part 2/5]` Full relay wire protocol, presence/heartbeat, matchmaking/lobby semantics, NAT traversal and internet P2P (Phase 5), anti-cheat heuristics layered atop the cryptographic guarantees.

---

# §9 Wallet and key management

## §9.1 Roles

The wallet is a game-protocol agent, not only a payment wallet: holds signing keys; derives
per-game/per-card keys; signs transactions and off-chain protocol messages; locally decrypts
concealed cards; interprets table state; presents signing prompts.

## §9.2 Key hierarchy

REQ-WALLET-001 One long-term secp256k1 key per player inside the custody boundary; per-game
and per-card scalars derived deterministically via HKDF bound to `(gid, j)` (§4.2), so the
device stores one key, derivation is deterministic and auditable from `(sk, gid, j)`, and
old-game keys reveal nothing about current games. REQ-WALLET-002 Distinct key sets for
distinct jobs (signing vs. card-encryption vs. session), least authority by construction.

## §9.3 Custody boundary (pluggable; TEE optional)

REQ-WALLET-003 A `Custody` interface abstracts where keys live and signing happens:
`derive`, `sign`, `decryptToViewer`, `combineSignShare`. Backends: (DEFAULT) software
custody with keys held in the wallet process and never exposed to the UI/shell beyond the
viewer path; (UPGRADE) `OB.custody` threshold (FROST/GG20) so no whole key exists in one
place; (LATER, OPTIONAL) a hardware-TEE backend — added without changing the protocol. No
phase requires a TEE (per direction). REQ-WALLET-004 Whole-key handling follows the active
signing mode (§4.3): in **Mode A** (Phase-1 default) the combined private key `w_j` is
reconstructed by the closing party at reveal, and the custody backend MUST therefore treat
all per-card scalars as **single-game** secret material that is never reused across games
(enforced by the HKDF binding to `gid`, REQ-WALLET-001) and MUST hold combined-key-locked
funds only for the bounded hand window; in **Mode B** the threshold backend produces the
`Q_j` signature with no whole-key reconstruction. The custody interface exposes
`combineSignShare` for Mode B and `reconstructAndSign` (scoped, single-game, audited) for
Mode A.

## §9.4 Micro-betting custody

REQ-WALLET-005 In micro-betting mode, channel keys and the 1-sat bond are managed via `BS`
(§2.2); the wallet presents channel open/transfer/close/contested as signing actions with
explicit prompts.

---

# §10 Self-contained runtime ("the VM") and packaging

## §10.1 Goal (D5)

REQ-VM-001 A reproducible, self-contained runtime that launches the whole stack — local BSV
node (regtest), relay, and client — with **no external services**, on Windows and on the
web (the web client connects to a bundled/local or hosted relay+node depending on mode).
"Believe the banner": regtest by default; mainnet opt-in behind an explicit research flag
(§10.5).

## §10.2 Components in the image

REQ-VM-002 (a) The embedded BSV node from `bonded-subsat-channel` (D6) in regtest:
native P2P-wire node, PoW header chain (longest-by-work), DB-backed block/UTXO store,
conflict-detecting mempool (original replacement rule), HD wallet. (b) The Go relay/indexer
(§8). (c) The client (web build served locally; desktop via Tauri, §11). (d) A
one-command bootstrap that brings the stack up, runs self-tests, and prints a transcript.

## §10.3 Packaging targets

REQ-VM-003 Primary: a container image (reproducible build, §16) bundling node+relay+client,
plus a `docker run`/compose one-liner that yields a playable stack. REQ-VM-004 Desktop: a
Windows installer (Tauri) that either embeds or supervises a local node+relay process so a
non-technical user double-clicks and plays. REQ-VM-005 If a literal hypervisor VM image
(OVA/qcow2) is additionally required (D5), it is an extra packaging artifact built from the
same composition — `DECISION REQUIRED`; the application does not change.

## §10.4 Reproducibility

REQ-VM-006 The image build is reproducible (pinned toolchains, locked dependencies, recorded
hashes). The stack's self-test and reproduce commands (§14.5) run inside the image in CI.

## §10.5 Mainnet flag

REQ-VM-007 Mainnet is reachable only behind an explicit, named research-code flag; the UI
shows an unmissable banner; default everywhere is regtest. Real funds are never touched
without the flag (mirrors the lineage's discipline; P8).

## §10.6 `[EXPAND: Part 2]` Exact compose topology, ports, volumes, health checks, and the desktop supervision model.

---

# §11 Client shells: Windows (desktop) and Web

## §11.1 One core, two shells

REQ-UI-001 A single TypeScript/React UI core (state, components, view-models) runs in the
browser (web) and inside **Tauri** for the Windows desktop binary. Rationale: Tauri yields a
small native binary, uses the system webview, and supervises local processes (node/relay)
cleanly; Electron is the fallback only if a Tauri limitation is hit (recorded, not assumed).
No business logic lives in the shell — it calls the engine/SDK (§15).

## §11.2 Browser storage rule

REQ-UI-002 The web shell persists via IndexedDB (keys, table state, transcripts); it MUST
NOT rely on `localStorage`/`sessionStorage` for anything load-bearing. Desktop persists via
SQLite (§12).

## §11.3 No HTML `<form>` submit semantics in React

REQ-UI-003 Interactions use explicit handlers (onClick/onChange), never `<form>` submit, to
avoid navigation/refresh side effects in the embedded webview.

## §11.4 Screens

Lobby (list/create/join, presence); Table (seats, turn indicator, board/up cards, pot(s),
balances, timers with explicit default-on-timeout text, action controls); Hand inspection
(local decrypt of own cards); Signing prompt (states exactly what is signed); Result/settlement;
Reconnect/recovery status; Transcript/replay viewer. REQ-UI-004 The UI hides protocol
complexity but never hides consequences (e.g. "If you do nothing, you check in 30s"; "If
reveal is not completed by the deadline, recovery begins"; "This round is committed and
cannot be altered").

## §11.5 Viewer/decryption boundary

REQ-UI-005 Card decryption goes through the custody boundary (§9.3); the rendered face exists
only in the controlled viewer path. (Screen-capture hardening and watermarking are an
OPTIONAL later track via OS facilities; not required in core phases; if added, claimed only
as partial mitigation, P8.)

## §11.6 Signing UX

REQ-UI-006 Every signing prompt shows the action, the amounts, the pot/state it affects, and
the exact bytes/intent being signed; no silent signing.

## §11.7 `[EXPAND: Part 2]` Full screen specs, component inventory, state shapes, and accessibility/localization.

---

# §12 Persistence, transcripts, audit

## §12.1 Stores

REQ-DATA-001 Web: IndexedDB. Desktop + relay: SQLite. Stored: tables, players, transactions,
card lineage, timeouts, proofs, transcripts, local encrypted hand data.

## §12.2 Transcript

REQ-DATA-002 A transcript is the ordered set of valid table transactions plus the
commit/reveal material needed to re-derive state. It is exportable.

## §12.3 Deterministic replay

REQ-DATA-003 A replay tool reconstructs the entire hand from a transcript and a ruleset hash,
producing byte-identical state and a verified outcome offline; any divergence is a defect
(P2). Disputes (a claimed shuffle stage, a withheld reveal, a claimed outcome) resolve by
replay against the committed hashes (§4.4, §6.3).

## §12.4 Audit integration (optional)

REQ-DATA-004 Via `VA` (§2.3): produce a selective-disclosure bundle proving a specific
figure (e.g. a settlement amount) is genuine and anchored, revealing nothing else; the
platform surfaces `VA`'s stated boundary (INV-VA-2) wherever it shows audit output.

---

# §13 Engineering standard, requirements register, traceability

## §13.1 Standard

REQ-ENG-001 The program is built to **NASA NPR 7150.2** software-assurance practice and to
**an adaptation of the JPL "Power of Ten" rules appropriate to a garbage-collected runtime
— not literal compliance (corrects RT-01 M5).** The original rules target C in embedded
safety-critical contexts; in TypeScript/Go the mapping is explicit:

- **Adopted as-is:** restrict control flow to simple constructs / no recursion in consensus
  and script paths; bound every loop in consensus paths with a fixed, provable upper bound;
  use runtime assertions (design-by-contract) on engine boundaries; check every return/error
  value; keep functions small and single-purpose; treat all warnings as errors
  (`tsc --strict`, Go `vet` + `-Werror`-equivalent).
- **Adapted:** "limit data scope" → no untyped `any` in the core, exhaustive `switch`
  handling with compile-time exhaustiveness, strict null checks; "limit the preprocessor" →
  restrict macro-like metaprogramming/codegen and document any that remains.
- **Not applicable in a GC runtime (stated, not silently dropped):** Rule 3 (no dynamic
  memory allocation after initialization) and the raw-pointer/aliasing restrictions have no
  literal meaning under garbage collection. In their place the core uses bounded, pre-sized
  working structures in the hot consensus path and avoids unbounded allocation inside that
  path; this is an *adaptation*, and the document does not claim Rule 3 compliance.

The headline is therefore "NPR 7150.2 assurance practice + a documented Power-of-Ten
adaptation," never "Power-of-Ten compliant."

## §13.2 Requirements register

REQ-ENG-002 Every `REQ-*` ID in this document is an entry in a machine-readable register
(`/spec/requirements.yaml`) with: id, text, owning section, owning module, satisfying
source files, satisfying tests, status. The register is generated/validated in CI.

## §13.3 Traceability matrix

REQ-ENG-003 A requirements-traceability matrix maps every requirement → code → test. CI
fails if any requirement has no satisfying test, or any consensus-path source file is not
traced to a requirement. (Mirrors `overlay-broadcast`'s practice, INV-OB-3.)

## §13.4 Boundary-in-source

REQ-ENG-004 Every stated boundary/limit (P7/P8) is asserted in the source — e.g. the audit
boundary (INV-VA-2), the N-of-N liveness limit (§4.8), the regtest-default (§10.5) — so no
future change silently papers over it.

## §13.5 `[EXPAND: Part 3]` The full requirements register seeded from every `REQ-*` in this document, with owners and test IDs.

---

# §14 Test strategy and acceptance

## §14.1 Levels

REQ-TEST-001 Unit (pure functions: hand-eval, pots, betting, serialization — against §19.D/B
vectors); property-based (invariants: pot conservation, determinism `f(tx,ruleset)`,
shuffle composition, reveal single-use); integration (engine + adapters with fakes for
CT/BS/VA/OB orchestration); **interpreter-level script tests** (§14.3); end-to-end (full
hand on regtest through the VM, §14.4); adversarial (§14.6).

## §14.2 Determinism tests

REQ-TEST-002 Replay equivalence: a transcript replays to byte-identical state on independent
runs and across platforms (web/desktop). Cross-client agreement: two engines given the same
valid tx set + ruleset hash agree exactly.

## §14.3 Interpreter-level script tests (P9)

REQ-TEST-003 Every script template spend (positive and negative) is executed through the
**real BSV Script interpreter with Genesis rules on**. Negative tests MUST fail **inside**
the interpreter, not in a wrapper guard. Signature spot-checks are explicitly disallowed as
a substitute. This covers all of §6.6 (funding, selection, custody, reveal-or-timeout, fold,
settlement, fair-play, optional TTP).

## §14.4 End-to-end

REQ-TEST-004 A scripted full heads-up Hold'em hand (D1) runs through the VM (§10) on regtest:
setup → shuffle → deal → betting streets → showdown/settlement, plus the failure injections
in §14.6, all producing reproducible transcripts.

## §14.5 Reproducible vectors (P10)

REQ-TEST-005 `reproduce` regenerates every committed vector (hand-eval results, pot splits,
script wire-byte sizes, transcript hashes) and exits non-zero on any mismatch. CI runs it
inside the VM image.

## §14.6 Adversarial suite

REQ-TEST-006 Disconnect at every phase; stale/duplicate action; timeout races; withheld
reveal; conflicting spends; mempool eviction + resubmission; fair-play violation (mismatched
keys) → forfeiture; attempted card-substitution → interpreter rejection; out-of-turn action;
under-min raise; all-in side-pot correctness; odd-chip determinism. Each maps to a `REQ-*`
and a deterministic expected outcome.

## §14.7 Acceptance gate definition

REQ-TEST-007 A phase is accepted only when: all its requirements are traced to passing tests;
`reproduce` is green inside the VM; the adversarial cases for that phase pass; and the E2E for
that phase runs clean. No phase advances on a green-looking test that does not exercise the
behavior (P9 spirit).

---

# §15 Module API / SDK contracts

Stable contracts between layers; each is versioned with explicit error semantics and
canonical serialization (no silent ambiguity between optimistic local state and enforceable
committed state).

## §15.1 Session/Lobby — `createTable(ruleset, stakeConfig, players)`, `joinTable(id, identity)`, `startTable(id)`, `listTables()`, `presence()`.
## §15.2 State engine — `deriveState(transcript, ruleset)`, `getLegalActions(state, seat)`, `apply(state, action)`, `isTimeoutEligible(state, now)`, `validateTransition(state, tx)`.
## §15.3 Ruleset — `validate(ruleset)`, `hash(ruleset)`, `resolveDefaultAction(stateType, seat)`.
## §15.4 Crypto/deck — `commitEntropy`, `revealEntropy`, `runShuffle`, `combinedKey(j)`, `dealConcealed`, `prepareReveal`, `verifyReveal`, `surrenderOnFold` (over `CT`/GB2616862; §4).
## §15.5 Transaction builder — `buildFunding`, `buildAction`, `buildTimeout`, `buildReveal`, `buildFold`, `buildFairPlay`, `buildSettlement`, `buildRecovery`, plus `presignFallbackGraph` (§6).
## §15.6 Wallet/custody — `derive`, `sign`, `combineSignShare`, `decryptToViewer`, `signProtocolMessage`, `selectFundingInputs` (§9).
## §15.7 NFT/access seam (later) — `OB`-backed `accessSession`, `revokeByExpiry`, `wrapContentKey` (not shipped in core poker phases; seam only).
## §15.8 Dependency adapters — `CTAdapter`, `BSAdapter`, `VAAdapter`, `OBAdapter`, each with a fake for tests (§2.6).
## §15.9 Chain — `broadcast(tx)`, `outpointStatus`, `txStatus`, `headers`, `conflicts` (over `BS.node`; §8.4).
## §15.10 `[EXPAND: Part 2]` Full type signatures, error enums, and canonical serialization rules.

---

# §16 Build, CI/CD, reproducibility, release

REQ-BUILD-001 Monorepo layout:
```
/spec            (this document, requirements.yaml, traceability)
/packages
  /protocol-types         (shared TS types: cards, ruleset, actions, state, tx)
  /engine                 (deterministic core: state, betting, pots)
  /hand-eval              (high + low evaluators; §5.3; vectors)
  /game-holdem ...        (one package per variant module; §7)
  /crypto-mentalpoker     (shuffle/reveal orchestration over CT/GB2616862; §4)
  /script-templates-ts    (template builders; §6.6)
  /tx-builder             (§6, §15.5)
  /wallet-custody         (§9; software + threshold backends)
  /adapters               (CT/BS/VA/OB adapters + fakes; §2.6, §15.8)
  /sdk                    (§15 stable surface)
  /ui-core                (React components/view-models; §11)
/apps
  /client-web             (Vite web app)
  /client-desktop         (Tauri wrapper)
  /relay-go               (transport/index/discovery; §8)
  /indexer-go             (table tx indexing/projections)
/vm                       (compose, image build, bootstrap, self-test; §10)
/tests
  /unit /property /integration /interpreter /e2e /adversarial
```
REQ-BUILD-002 Reproducible builds: pinned toolchains, locked lockfiles, recorded artifact
hashes. REQ-BUILD-003 CI stages: typecheck (`tsc --strict`, Go `vet`/`-Werror`-equivalent),
lint (Power-of-Ten ruleset), unit+property, interpreter tests (Genesis rules), integration,
build VM image, E2E inside image, `reproduce`, traceability check. A red stage blocks merge.
REQ-BUILD-004 Releases: Windows installer (Tauri, signed), web bundle, VM/container image,
all from the same commit with recorded hashes; auto-update for desktop is a later track.

---

# §17 Phased roadmap and per-phase acceptance gates

Each phase ends at a checkable gate (§14.7). Phases deliver the smallest thing that genuinely
exercises more of the architecture, never a demo that skips the hard part.

- **Phase 0 — Foundations wiring.** Adapters + fakes for CT/BS/VA/OB; protocol-types; the VM brings up node(regtest)+relay+empty client; `reproduce` green; traceability skeleton live. Gate: VM launches end-to-end, self-test passes, CI all green.
- **Phase 1 — First playable (D1: heads-up NL Hold'em, regtest, with discovery).** Entropy commit/reveal; distributed shuffle; encrypted-card deal; full preflop→river betting FSM; minimum-reveal showdown; settlement; decision + recovery timeouts; fold-without-reveal; relay+LAN discovery; web + Windows shells; transcript+replay. Gate: §14.4 E2E + the Phase-1 adversarial subset pass; all Phase-1 REQs traced to passing tests; interpreter tests green for the templates used.
- **Phase 2 — Robustness + fair-play + multi-way.** Fair-play transactions (§4.7) enforced and interpreter-tested; full pre-signed fallback graph (§6.4); side pots + multi-way showdown (§5.5); 6-max (D2); reconnect/resume. Gate: full adversarial suite (§14.6) passes for Hold'em multi-way.
- **Phase 3 — More variants.** Omaha, Seven-Card Stud, Five-Card Draw, Razz as modules (§7.3, §5.8) with hand-eval (§5.3) vectors; betting structures PL/FL (§5.4). Gate: each variant's E2E + adversarial + vectors green.
- **Phase 4 — Micro-betting + audit.** `bonded-subsat-channel` micro-betting (§5.7) with `Q*` settlement; `verifiable-accounting` selective-disclosure audit bundles (§12.4) with boundary surfaced. Gate: channel contested-state tests; audit bundle verifies independently.
- **Phase 5 — Internet P2P + matchmaking + hardening.** Tier-A peer discovery + NAT traversal (§8.7); matchmaking/lobby at scale; performance; security review; desktop auto-update. Gate: cross-network play; load tests; review actioned.
- **Later tracks (not gated here):** revocable-content NFTs (`overlay-broadcast` seam, §15.7); TEE custody backend (§9.3); Blackjack (D7); mobile; mainnet productionization (only with the §10.5 flag and the legal surface addressed outside this document).

---

# §18 Threat model

Each threat lists the **mechanism that bounds it** and an **honest residual risk** (P8).
"Bounded" never means "eliminated." Threats are grouped; IDs are `THR-*`.

## §18.1 Economic threats

- **THR-ECON-1 Stale-state broadcast (publish an old, more-favourable channel/table state).** Bound: in micro-betting, the fixed one-satoshi bond is forfeited to honest parties on a stale broadcast (§2.2, INV-BS-2), so cheating's expected value is negative; in on-chain table settlement, a superseded state cannot spend the current state's UTXO (§8.5). Residual: an attacker who values griefing above one satoshi can still burn their bond to disrupt; bond size is a tunable, not a proof of deterrence.
- **THR-ECON-2 Settlement manipulation (claim a pot one did not win).** Bound: settlement spends require a valid winning proof verified against concealed-card commitments (§5.6, §6.6 settlement template) and signatures; an unproven claim fails inside the interpreter (P9). Residual: depends on the soundness of the reveal/commitment binding (§4.5–§4.6) and, in Mode A, on the bounded-window key argument (§4.3).
- **THR-ECON-3 Refusing to settle after losing (withhold a needed signature / scalar).** Bound: the pre-signed fallback graph and recovery timeout (§6.4) move value through an already-authorised path after maturity; the loser cannot strand the pot. Residual: a recovery delay (the timeout window) is imposed on the honest winner; the window is a UX/security trade.
- **THR-ECON-4 Griefing / slow-rolling (acting only at the deadline to waste time).** Bound: decision timeouts with default-on-inaction (§6.4) cap per-action delay; repeat offenders can be deprioritised by the relay's lobby reputation (§8.7, later). Residual: within the timeout budget, an attacker can still maximise delay; mitigated only by tuning timeouts.

## §18.2 Fairness threats

- **THR-FAIR-1 Shuffle bias (skew the deck order).** Bound: the verifiable distributed shuffle composes every party's secret permutation, so no single party fixes the order (INV-CT-1); commit-reveal entropy (§4.1) stops late entropy selection. Residual: a *full* coalition of all parties could agree the order — but then there is no honest player to defraud; security degrades gracefully with coalition size up to N−1.
- **THR-FAIR-2 Marked cards / mismatched keys (use keys that do not match what was committed).** Bound: fair-play transactions prove in-script that committed keys derive used keys; a mismatch forfeits bonded funds (§4.7). Residual: depends on the fair-play script being correct and on its scaling solution (REQ-CRYPTO-009 / RT-01 M3) being in place; until §19.C measures it, this control is specified but not proven at deck scale.
- **THR-FAIR-3 Square-root-branch leakage (halve the key search space).** Bound: fix one branch and keep the choice consistent (REQ-CRYPTO-007); funds are short-lived (§4.3 Mode A window). Residual: a factor-2 reduction if the branch choice leaks; still computationally infeasible within the hand window, but stated, not dismissed.
- **THR-FAIR-4 Collusion at reveal (Mode A scalar reuse).** Bound: per-card scalars are single-game and never reused (REQ-WALLET-004); combined-key funds live only for the hand. Residual: within a single game, colluding players already see each other's revealed cards (inherent to any mental-poker coalition); Mode B removes the whole-key-reconstruction exposure entirely for those who need it.

## §18.3 Liveness threats

- **THR-LIVE-1 Withheld reveal (player or board).** Bound: every reveal — including each board street — is an N-of-N cooperative transition with a timeout-default (§4.6, RT-01 M2); recovery resolves value, bond slashing applies where configured. Residual: the hand stalls for the timeout window before defaulting; a determined withholder converts a likely loss into a forced timeout, never a theft.
- **THR-LIVE-2 Dropped quorum (a party disconnects mid-hand).** Bound: the timeout-default/recovery path (§6.4); no partial reshuffle is attempted (REQ-CRYPTO-012). Residual: the hand is voided/settled by fallback, not continued with a substitute; the table proceeds to the next hand with the then-seated set (§4.9).
- **THR-LIVE-3 Mempool eviction / non-propagation.** Bound: the platform tracks table-level rebroadcast and can resubmit; it does not rely on mempool memory alone (§8.4). Residual: propagation delays can slow convergence; the speed path (§8.3) mitigates UX but not the underlying network.

## §18.4 Client and key threats

- **THR-CLIENT-1 Key extraction from the wallet/device.** Bound: the custody boundary (§9.3); Mode B threshold custody so no whole key exists in one place; optional TEE backend later. Residual: software custody (the Phase-1 default) trusts the local device; compromise of the device compromises that player's keys — stated plainly; the platform does not claim device-compromise resistance in Phase 1.
- **THR-CLIENT-2 Hand-view leakage (screen capture, malware reading the decrypted face).** Bound: decryption only through the controlled viewer path (§11.5). Residual: a compromised client can leak its own player's view; this is unpreventable by protocol and is claimed only as partial mitigation (screen hardening is an optional later track).
- **THR-CLIENT-3 Malicious relay.** Bound: the relay is transport/indexing only and is never the source of truth (P3, §8.1); clients derive state independently and detect a lying relay by reconstructing from the valid transaction set. Residual: a malicious relay can degrade liveness (drop/delay messages) and attempt eclipse; mitigated by the canonical network path (§8.3) and, in Phase 5, by the peer layer (§8.7).

## §18.5 Protocol threats

- **THR-PROTO-1 Replay of a branch against a different state.** Bound: every transaction binds `gid`, `rulesetHash`, round, state hash, and successor commitment (§6.3); a replayed branch fails the binding check in the interpreter. Residual: none beyond the soundness of the hash binding.
- **THR-PROTO-2 Double-spend / conflicting action.** Bound: one spendable phase-right per phase; conflicting attempts cannot both be valid; deterministic conflict rules (§8.5) and the timeout-default make a double-spend strategically useless. Residual: pre-confirmation ordering disagreement, resolved by §8.5; final only at confirmation.
- **THR-PROTO-3 Reorg of unconfirmed table transactions.** Bound: gameplay treats confirmation as final settlement for value leaving the table; in-hand state re-derives from the agreed ordering and is protected by the recovery path (§6.4). Residual: a deep reorg could invalidate an unconfirmed settlement; value that has left the table waits for confirmation depth (a ruleset parameter).

## §18.6 The complete trust surface (P8 — nothing is "trustless" beyond this)

A correct, honest player who runs an uncompromised client trusts exactly:

1. **The discrete-logarithm / DDH hardness on secp256k1** (shuffle, keys, signatures).
2. **Correct off-chain execution by the protocol participants** of the steps not enforced on-chain (the on-chain parts are enforced by the interpreter; the off-chain orchestration is trusted to follow the spec, and deviations are caught by fair-play, commitments, and replay where they touch chain state — but pure off-chain misbehaviour that never touches chain is bounded only by the timeout/economic mechanisms).
3. **Soundness of the primitives:** HKDF, the AEAD (AES-256-GCM), SHA-256/double-SHA-256, ECDSA, and (Mode B) the threshold scheme.
4. **Node and BSV consensus integrity:** that the local/connected node enforces post-Genesis consensus and that proof-of-work secures the header chain.
5. **Custody-backend integrity at the configured tier:** software (device trust), threshold (no whole key), or TEE (hardware enclave) — whichever is configured (§9.3).

Outside this list, the platform does not ask for trust. The word "trustless" is not used
unconditionally anywhere; where prose uses "non-custodial" or similar it refers to the
specific property enforced (no operator holds the deck or decides outcomes), bounded by
this surface.

---

# §19 Appendices

- §19.A Canonical serialization (cards, ruleset, actions, state, tx) — byte-exact. `[EXPAND: Part 3]`
- §19.B Side-pot algorithm with a worked multi-all-in example. **(Filled below.)**
- §19.C Script template byte schedules + SIGHASH choices, incl. the fair-play measurement (REQ-CRYPTO-009) and a per-hand transaction-count/byte cost envelope (RT-01 m2). `[EXPAND: Part 3]`
- §19.D Hand-evaluation test-vector catalog (all categories, wheel, kickers, Omaha-2+3, ace-to-five low). **(Filled below — values generated by the reference evaluator, not hand-written.)**
- §19.E Texas Hold'em full state-transition table. **(Filled below.)**
- §19.F Requirements register (all `REQ-*`) with owning module and test family. **(Filled below — auto-generated from this document; the cited section is canonical.)**
- §19.G References (GB2616862A; the prof-faustus repositories; NPR 7150.2; JPL Power of Ten; RFC 5869; SEC-1).

## §19.B Side-pot algorithm (with worked example)

**Inputs:** `contrib[p]` = total chips player `p` committed this hand (folded players
included — their chips are in the pot but they cannot win); `live` = set of players not
folded (eligible to win).

**Algorithm (deterministic; satisfies P2):**

1. Build the sorted set of distinct positive contribution levels across **all** players: `L₁ < L₂ < … < L_m`.
2. `prev ← 0`. For `i = 1..m`:
   a. `increment ← Lᵢ − prev`.
   b. `contributors_i ←` all players (live **or** folded) with `contrib[p] ≥ Lᵢ`.
   c. `potᵢ.amount ← increment × |contributors_i|`.
   d. `potᵢ.eligible ←` the **live** players with `contrib[p] ≥ Lᵢ`.
   e. `prev ← Lᵢ`.
3. Any `potᵢ` with `|potᵢ.eligible| = 1` is **awarded to that player without showdown** (this is the "uncalled/returned" case — the sole eligible contributor takes it back).
4. At showdown, award each remaining `potᵢ` to the best eligible **live** hand by `compare` (§5.3); ties split per §5.5.1 (even division; odd chip by the deterministic rule, never by suit).
5. **Conservation check (assertion, REQ-ENG):** `Σ potᵢ.amount = Σ_p contrib[p]`. A violation is a defect.

**Worked example (3-handed, multi-all-in preflop, no folds for clarity).**

Stacks/contributions: `A = 100`, `B = 60`, `C = 40`. All three are all-in. `live = {A,B,C}`.

- Distinct levels: `L₁=40, L₂=60, L₃=100`.
- **Pot 1 (main):** increment `40−0=40`; contributors with `contrib ≥ 40` = {A,B,C} (3); amount `40×3 = 120`; eligible (live) = {A,B,C}.
- **Pot 2 (side 1):** increment `60−40=20`; contributors with `contrib ≥ 60` = {A,B} (2); amount `20×2 = 40`; eligible = {A,B}.
- **Pot 3 (side 2):** increment `100−60=40`; contributors with `contrib ≥ 100` = {A} (1); amount `40×1 = 40`; eligible = {A} → **single eligible ⇒ returned to A** (step 3).
- Conservation: `120 + 40 + 40 = 200 = 100+60+40`. ✓

Suppose hand strength `C > B > A`:

- Main pot 120 → **C** (best among {A,B,C}). C net: `−40 + 120 = +80`.
- Side 1 (40) → **B** (best among {A,B}; C not eligible). B net: `−60 + 40 = −20`.
- Side 2 (40) → **returned to A**. A net: `−100 + 40 = −60`.
- Net sum: `+80 −20 −60 = 0`. ✓ (C, the best hand, cannot win more than the pot C contributed to — C is capped at the main pot, exactly as the rules require.)

**Edge cases the implementation must cover (each a §19.D vector):** a folded player whose
contribution sits in a pot they cannot win; two players tied for a side pot (even split +
odd-chip rule); an all-in exactly equal to another player's stack (levels coincide → one
layer, not two); an uncalled final raise (single-eligible top pot returned).

## §19.D Hand-evaluation test vectors (generated by the reference evaluator)

**Provenance (P6/P10).** Every value below was produced by a reference evaluator run, not
written from memory. The oracle implements the §5.1 encoding and the §5.3 rules; it is the
source of truth the production evaluator must reproduce **bit-for-bit** (REQ-POKER-003).
`reproduce` (§14.5) regenerates this table and exits non-zero on any mismatch. Encoding
recap: `card_index = rank*4 + suit`, rank `2=0 … A=12`, suit `c=0,d=1,h=2,s=3`. The
"tiebreak" tuple uses internal rank values `2..14` (A=14), with the wheel straight scored
as high-card 5. `compare` orders by `(category, tiebreak)`; higher is better.

**High-hand category vectors (5 cards):**

| Hand | Cards | Canonical indices | Category | Tiebreak |
|---|---|---|---|---|
| Royal flush (spades) | As Ks Qs Js Ts | 51 47 43 39 35 | straight flush | (14) |
| Straight flush 9-high (hearts) | 9h 8h 7h 6h 5h | 30 26 22 18 14 | straight flush | (9) |
| Steel wheel (clubs) | 5c 4c 3c 2c Ac | 12 8 4 0 48 | straight flush | (5) |
| Quads, K kicker | Qs Qh Qd Qc Ks | 43 42 41 40 47 | four of a kind | (12, 13) |
| Quads, 2 kicker | Qs Qh Qd Qc 2s | 43 42 41 40 3 | four of a kind | (12, 2) |
| Full house AAA KK | As Ah Ad Ks Kh | 51 50 49 47 46 | full house | (14, 13) |
| Full house KKK AA | Ks Kh Kd As Ah | 47 46 45 51 50 | full house | (13, 14) |
| Flush A-high (diamonds) | Ad Jd 9d 6d 3d | 49 37 29 17 5 | flush | (14, 11, 9, 6, 3) |
| Flush K-high (diamonds) | Kd Jd 9d 6d 3d | 45 37 29 17 5 | flush | (13, 11, 9, 6, 3) |
| Straight A-high (broadway) | As Kd Qh Jc Ts | 51 45 42 36 35 | straight | (14) |
| Straight 5-high (wheel) | 5s 4d 3h 2c As | 15 9 6 0 51 | straight | (5) |
| Trips 7s, K Q kickers | 7s 7h 7d Ks Qd | 23 22 21 47 41 | three of a kind | (7, 13, 12) |
| Two pair A K, kicker 5 | As Ah Ks Kh 5d | 51 50 47 46 13 | two pair | (14, 13, 5) |
| Two pair A K, kicker 4 | As Ah Ks Kh 4d | 51 50 47 46 9 | two pair | (14, 13, 4) |
| Pair 8s, A 7 5 kickers | 8s 8h Ad 7c 5h | 27 26 49 20 14 | one pair | (8, 14, 7, 5) |
| Pair 8s, K 7 5 kickers | 8s 8h Kd 7c 5h | 27 26 45 20 14 | one pair | (8, 13, 7, 5) |
| High card A K J 8 6 | As Kd Jh 8c 6s | 51 45 38 24 19 | high card | (14, 13, 11, 8, 6) |

**Consistency results (all computed, all pass):** category ladder strictly descending
(royal > sf-9 > steel-wheel > quads > boat > flush > straight > trips > two-pair > pair >
high) = **true**; quads(K-kick) > quads(2-kick) = **true**; AAA-KK > KKK-AA = **true**;
flush(A) > flush(K) = **true**; two-pair(kicker 5) > two-pair(kicker 4) = **true**;
pair(A-kick) > pair(K-kick) = **true**; broadway > wheel = **true**; transitivity over
**20,000** random triples = **true**.

**Omaha 2+3 constraint vector (proves the generic best-of-7 is WRONG for Omaha,
REQ-POKER-005):**

- Board `As Ks Qs 2s 7d` (four spades); hole `Js 9h 4c 3d` (exactly one spade).
- Generic best-of-7 (Hold'em-style) → **flush** A-K-Q-J-2♠, tiebreak (14,13,12,11,2), using `As Ks Qs 2s Js`.
- Correct Omaha (exactly 2 hole + 3 board) → **high card** A-K-Q-J-9, tiebreak (14,13,12,11,9), using `Js 9h | As Ks Qs`.
- They **differ**: Hold'em sees a flush; Omaha cannot, because only one spade is in hand. The Omaha evaluator is therefore a distinct, separately-vectored path.

**Ace-to-five low (Razz) vectors — 7 cards, best 5-card low, lower is better
(REQ-POKER-006). Pattern = `(pair_penalty, sorted-desc low values; A=1)`:**

| Hand | Seven cards | Best 5-card low | Pattern |
|---|---|---|---|
| Wheel (the bicycle) | Ah 2d 3c 4s 5h Kd Qs | Ah 2d 3c 4s 5h | (0, (5,4,3,2,1)) |
| Six-low 6-4-3-2-A | Ah 2d 3c 4s 6h Ks Qd | Ah 2d 3c 4s 6h | (0, (6,4,3,2,1)) |
| Seven-low 7-5-4-2-A | Ah 2d 4c 5s 7h Ks Qd | Ah 2d 4c 5s 7h | (0, (7,5,4,2,1)) |
| Pair forces a NINE-low | Ah Ad 2c 3s 8h 9s Td | Ah 2c 3s 8h 9s | (0, (9,8,3,2,1)) |
| All hearts still the wheel | Ah 2h 3h 4h 5h Kh Qh | Ah 2h 3h 4h 5h | (0, (5,4,3,2,1)) |

Computed orderings: bicycle < six-low < seven-low = **true**; the no-pair seven-low beats
the (pair-forced) nine-low = **true**; the all-hearts hand evaluates **identically to the
wheel** (flushes are ignored for low) = **true**. Note: the paired example is labelled a
**nine-low**, not eight-low — the duplicate ace cannot be reused, so the best distinct
five are 9-8-3-2-A; the computed result governs the label (a hand-written "8-low" would
have been wrong, which is exactly why these are generated, not asserted).

**Edge cases still owed in this catalog (next pass):** an explicit tie/odd-chip split pair
of hands; coincident all-in levels collapsing to one side-pot layer; a folded-but-contributing
player in a side pot (cross-links to §19.B); the Omaha-8 qualifying-low boundary at exactly
8-high.

## §19.E Texas Hold'em — full state-transition table (heads-up NL reference, D1)

Every actionable state has a cooperative successor **and** a timeout-default successor
(P4). "N-of-N reveal" states are cooperative transitions whose timeout-default is the
recovery path (§6.4, RT-01 M2). Heads-up order: **button = small blind, acts first
pre-flop and last post-flop**; the other seat is big blind.

| State | Entry condition | Events / legal actions | Guard | Cooperative successor | Timeout-default successor |
|---|---|---|---|---|---|
| S0 TABLE_LOCKED | 2 seats funded; `rulesetHash` bound (§5.2) | — | quorum=2 | S1 POST_BLINDS | RECOVERY (table-abort refund) |
| S1 POST_BLINDS | from S0 | post SB (button), post BB | blinds match ruleset | S2 SHUFFLE | RECOVERY (no-blind unwind) |
| S2 SHUFFLE | from S1 | each party: commit entropy (§4.1) → shuffle stages (§4.4) | all N commits before any reveal; fair-play committed (§4.7) | S3 DEAL_HOLE | RECOVERY (deck-build timeout) |
| S3 DEAL_HOLE | from S2 | draw 2 concealed cards to each seat (§4.3 draw) | exactly 2/seat; commitments recorded | S4 BET_PREFLOP | RECOVERY (deal timeout) |
| S4 BET_PREFLOP | from S3 | check?/call/bet/raise/fold (button first) | betting rules §5.4; min-raise §5.4 | round-close → S5; any fold → FOLD_END | actor times out → default check if legal else **fold** → FOLD_END or round-close |
| S5 REVEAL_FLOP | from S4 round-close | N-of-N release flop decryption (3 board) | all N release | S6 BET_FLOP | RECOVERY (reveal timeout) |
| S6 BET_FLOP | from S5 | check/bet/call/raise/fold (BB first) | §5.4 | round-close → S7; fold → FOLD_END | timeout → default check/fold |
| S7 REVEAL_TURN | from S6 | N-of-N release turn (1 board) | all N release | S8 BET_TURN | RECOVERY (reveal timeout) |
| S8 BET_TURN | from S7 | check/bet/call/raise/fold | §5.4 | round-close → S9; fold → FOLD_END | timeout → default check/fold |
| S9 REVEAL_RIVER | from S8 | N-of-N release river (1 board) | all N release | S10 BET_RIVER | RECOVERY (reveal timeout) |
| S10 BET_RIVER | from S9 | check/bet/call/raise/fold | §5.4 | round-close → S11; fold → FOLD_END | timeout → default check/fold |
| S11 SHOWDOWN | from S10 round-close | minimum reveal (§5.6): last aggressor shows first; others show/muck | revealed hand verifies vs commitments (§6.6) | S12 SETTLE | RECOVERY (showdown/reveal timeout forfeit) |
| S12 SETTLE | from S11 or FOLD_END | settle pot(s) §5.5/§5.7; close-out spend (§4.3, §6.6) | winning proof + signatures valid in interpreter (P9) | S13 HAND_END | RECOVERY (settlement timeout) |
| FOLD_END | any BET_* fold leaves one live player | award uncontested pot to the sole live player without reveal (P5) | one live player remains | S12 SETTLE | — (no actor to time out; proceeds) |
| S13 HAND_END | from S12 | rotate button; re-seat sit-out/join (§4.9) | seats still ≥ 2 | S1 POST_BLINDS (next hand) | TABLE_CLOSE (refund remaining) |
| RECOVERY | timeout from any state | execute the pre-signed fallback for that state (§6.4) | maturity reached (tx-level nLockTime, §6.2) | value resolved per fallback graph | — (terminal) |

Notes: (1) all timeouts are transaction-level (nLockTime/nSequence), never in-script
(§6.2). (2) "default fold" at S4–S10 means: if facing a bet, the timed-out player folds; if
checking is legal, they check — never a forced wager (§6.4). (3) S5/S7/S9 reveals are
cooperative N-of-N with the recovery default (RT-01 M2). (4) The full multi-way table
(3–9 seats) generalises round-close and adds side-pot settlement at S12 (§19.B) and is in
the §7.3 expansion.

## §19.F Requirements register

**Provenance.** Auto-generated from this document (every `REQ-*` ID and an excerpt of its
text), then mapped to an owning module and a test family. The **cited section is canonical**;
excerpts are truncated for the table. This realises REQ-ENG-002 (the register is also emitted
as `/spec/requirements.yaml` in the build, with `status` per requirement) and feeds the
traceability matrix REQ-ENG-003. Count: **115 unique requirements** across 15 families,
including `REQ-FSM-003…011` added with §7.3. Every unique `REQ-*` in the document has exactly
one register row (a generation-time check; a missing or duplicate row fails CI).

| ID | Requirement (excerpt; cited section is canonical) | Owning module(s) | Test family |
|---|---|---|---|
| REQ-ARCH-001 | The engine is a pure function of inputs: `(orderedValidTxSet, ruleset) -> tableState`. | engine | property + integration |
| REQ-ARCH-002 | The engine performs no I/O, no networking, no time reads, and no randomness except via injected, recorded sources. | engine | property + integration |
| REQ-ARCH-003 | "Now" enters the engine only as an explicit parameter for timeout-eligibility, derived from chain/relay-anchored height/time. | engine | property + integration |
| REQ-BUILD-001 | Monorepo layout (see §16): /spec, /packages, /apps, /vm, /tests. | build / ci | CI |
| REQ-BUILD-002 | Reproducible builds: pinned toolchains, locked lockfiles, recorded artifact hashes. | build / ci | CI |
| REQ-BUILD-003 | CI stages: typecheck, lint (Power-of-Ten), unit+property, interpreter (Genesis), integration, build image, e2e-in-image, reproduce, traceability. | build / ci | CI |
| REQ-BUILD-004 | Releases: Windows installer (Tauri, signed), web bundle, VM/container image, from the same commit with recorded hashes. | build / ci | CI |
| REQ-CRYPTO-001 | Withholding a reveal after committing triggers a deterministic penalty/fallback (timeout forfeiture or committed fallback-seed). | crypto-mentalpoker | property + interpreter + conformance |
| REQ-CRYPTO-002 | No player may sample or alter `r_p` after observing any other `r_q`; binding by commit hash + ordering. | crypto-mentalpoker | property + interpreter + conformance |
| REQ-CRYPTO-003 | Canonical party order = lexicographic order of long-term public keys (33-byte SEC-1); published in setup state. | crypto-mentalpoker | property + interpreter + conformance |
| REQ-CRYPTO-004 | Each shuffle stage is committed `c_p = H(state ‖ scalars ‖ permutation)`; OP_RETURN acceptable for these dead-end commits. | crypto-mentalpoker | property + interpreter + conformance |
| REQ-CRYPTO-005 | Mid-protocol substitution of a card's ciphertext/commitment is rejected by byte-equality across transitions and AEAD integrity. | crypto-mentalpoker | property + interpreter + conformance |
| REQ-CRYPTO-006 | Fair-play transactions generated after shuffle/encryption, before reveal; locking script from in-script EC routines. | crypto-mentalpoker | property + interpreter + conformance |
| REQ-CRYPTO-007 | Fix one square-root branch for shuffle keys; keep it consistent; treat both-branch exposure as a factor-2 reduction. | crypto-mentalpoker | property + interpreter + conformance |
| REQ-CRYPTO-008 | The build MUST NOT present Mode A while claiming Mode B's property; active mode recorded in ruleset. | crypto-mentalpoker | property + interpreter + conformance |
| REQ-CRYPTO-009 | Fair-play scaling is a measured risk; measure script size before single-script use; fallback = per-card/per-batch fair-play. | crypto-mentalpoker | interpreter + measured (§19.C) |
| REQ-CRYPTO-010 | Shuffle is N-of-N over the currently-seated set; each hand is a fresh N-party shuffle (new seed/keys/order). | crypto-mentalpoker | property + integration |
| REQ-CRYPTO-011 | Sit-out/join take effect between hands only; participant set frozen at hand start. | crypto-mentalpoker | property + integration |
| REQ-CRYPTO-012 | No partial reshuffle of an in-progress deck; mid-hand disconnect handled by timeout/recovery. | crypto-mentalpoker | property + adversarial |
| REQ-DATA-001 | Web: IndexedDB; desktop+relay: SQLite. | persistence / engine | unit + replay (§14.2) |
| REQ-DATA-002 | A transcript is the ordered valid tx set plus the commit/reveal material to re-derive state; exportable. | persistence / engine | unit + replay (§14.2) |
| REQ-DATA-003 | Replay reconstructs the hand from transcript + ruleset hash, byte-identical, offline; divergence is a defect. | persistence / engine | replay (§14.2) |
| REQ-DATA-004 | Via VA: selective-disclosure bundle proving a figure is genuine+anchored, revealing nothing else; boundary surfaced. | persistence / engine | integration |
| REQ-DEP-001 | Core depends only on contracts CT/BS/VA/OB via an adapter layer; each has a fake for orchestration tests. | adapters | conformance + integration |
| REQ-DEP-002 | A repo API change is absorbed in its adapter; no change propagates into engine/FSMs/UI. | adapters | conformance + integration |
| REQ-DEP-003 | A single conformance suite per contract is run against both the fake and the real adapter; both must pass. | adapters | conformance |
| REQ-DEP-004 | Security-critical behaviours (shuffle, reveal, fair-play, signing) tested against real implementations, never fakes. | adapters | conformance + interpreter |
| REQ-ENG-001 | Built to NPR 7150.2 assurance + a documented Power-of-Ten adaptation (not literal compliance; rule 3/pointers N/A). | (cross-cutting) | CI gates (§16) |
| REQ-ENG-002 | Every REQ-* is an entry in a machine-readable register with id/text/section/module/tests/status; validated in CI. | (cross-cutting) | CI gates (§16) |
| REQ-ENG-003 | A traceability matrix maps every requirement → code → test; CI fails on any untested requirement or untraced consensus file. | (cross-cutting) | CI gates (§16) |
| REQ-ENG-004 | Every stated boundary/limit (P7/P8) is asserted in the source so no change silently papers over it. | (cross-cutting) | CI gates (§16) |
| REQ-FSM-001 | A game module implements GameModule (init/getLegalActions/apply/isTimeoutEligible/isHandComplete/settle); no I/O. | engine / game-* | property + e2e |
| REQ-FSM-002 | The full Hold'em transition table is specified in §19.E; the prose flow is normative for phase order + two-exit rule. | engine / game-holdem | property + e2e |
| REQ-FSM-003 | Down-card = drawn then privately revealed to holder; up-card = drawn then N-of-N publicly revealed (with timeout-default). | engine / game-stud / game-razz | property + e2e |
| REQ-FSM-004 | Draw = surrender chosen concealed cards to dead-hand without reveal + draw equal fresh concealed cards from undealt deck. | engine / game-draw | property + e2e |
| REQ-FSM-005 | Stud/razz betting order is determined by the exposed board, not the button (a distinct ordering function). | engine / game-stud / game-razz | property + e2e |
| REQ-FSM-006 | Omaha = Hold'em FSM with two overrides: deal 4 hole cards; showdown uses Omaha exactly-2+3 evaluator. | game-omaha | property + e2e + vectors |
| REQ-FSM-007 | Omaha Hi-Lo (Omaha-8) adds an eight-or-better low split; distinct test-vectored path; off unless ruleset.hiLo. | game-omaha | vectors + e2e |
| REQ-FSM-008 | 8-handed stud/razz deck-exhaustion: final card dealt as a single shared community up-card; else 7-handed max. | game-stud / game-razz | property + e2e |
| REQ-FSM-009 | Draw preserves concealment: discards to dead-hand without reveal; replacements private; count public, identities not. | game-draw | property + e2e |
| REQ-FSM-010 | Five-card-draw S4 DRAW timeout-default is stand-pat (draw zero). | game-draw | property + adversarial |
| REQ-FSM-011 | Razz = stud FSM with three overrides: bring-in = highest up-card; post-3rd order = best low first; ace-to-five low showdown. | game-razz | property + e2e + vectors |
| REQ-NET-001 | The relay is transport + indexing only; never the source of truth. | relay-go / indexer-go | integration + adversarial |
| REQ-NET-002 | Tier A discovery = hosted relay + LAN auto-discovery (Phase 1); version/verack peer layer at Phase 5. | relay-go | integration |
| REQ-NET-003 | Every action sent simultaneously to the network (canonical) and to table peers (speed); speed never overrides canonical. | relay-go / indexer-go | integration + adversarial |
| REQ-NET-004 | Via BS.node: broadcast; outpoint/UTXO status; double-spend-attempt status; headers/blocks; mempool conflicts. | indexer-go | integration |
| REQ-NET-005 | One spendable phase-right per phase; conflicting actions cannot both be valid; accepted = referenced by next accepted transition. | engine / indexer-go | adversarial |
| REQ-NET-006 | Deterministic local tie-break: first valid tx referenced by a threshold of peers; final tie-break by lexicographic txid. | indexer-go | adversarial |
| REQ-NET-007 | A client can request the transcript gap and rebuild current state deterministically from the valid tx set. | relay-go / engine | integration |
| REQ-POKER-001 | The deck encoding is fixed and identical to the one bound into the shuffle (§4) and tx schemas (§6). | protocol-types / hand-eval | unit + vectors (§19.D) |
| REQ-POKER-002 | rulesetHash = H(canonicalSerialize(Ruleset)); computed once, displayed, bound into every transaction. | engine / tx-builder | unit + interpreter |
| REQ-POKER-003 | The evaluator is pure/deterministic and backed by §19.D vectors (categories, wheel, kickers, Omaha-2+3, low). | hand-eval | unit + vectors (§19.D) |
| REQ-POKER-004 | Best-5-of-7 enumerates C(7,5)=21 subsets and takes the max by compare. | hand-eval | unit + vectors |
| REQ-POKER-005 | Omaha enumerates C(4,2)·C(5,3)=60 combinations and takes the max; mandatory distinct path. | hand-eval | unit + vectors (§19.D) |
| REQ-POKER-006 | Low evaluation returns a comparable where lower is better (ace-to-five); pairs penalised; distinct path. | hand-eval | unit + vectors (§19.D) |
| REQ-POKER-007 | Evaluator correct first, fast second; bounded enumeration; any LUT optimisation must reproduce the reference bit-for-bit. | hand-eval | unit + vectors |
| REQ-POKER-008 | Betting is a strategy behind one BettingStructure interface (NL/PL/FL); legalBets/applyBet. | engine / betting | unit + property |
| REQ-POKER-009 | Betting machine tracks stacks, committed-this-round/-hand, bet-to-call, last full raise, all-in, who acted, round-close. | engine / betting | unit + property |
| REQ-POKER-010 | Round closes when action returns to last aggressor with all live non-all-in matched; short all-in doesn't reopen unless a full raise. | engine / betting | unit + property |
| REQ-POKER-011 | Pot engine computes main + ordered side pots from per-seat contributions on differing all-ins (§19.B). | engine / pots | unit + vectors (§19.B) |
| REQ-POKER-012 | Each pot awarded independently to the best eligible hand; ties split per §5.5.1. | engine / pots | unit + vectors |
| REQ-POKER-013 | Odd chip deterministic (left-of-button default); suit tiebreak is house-rule, default OFF, never in hand-eval. | engine / pots | unit |
| REQ-POKER-014 | Showdown: only contenders reveal, minimum required; last aggressor shows first; lose-only may muck. | engine | e2e |
| REQ-POKER-015 | A revealed hand is verified against concealed-card commitments before it can win. | engine / script-templates-ts | interpreter |
| REQ-POKER-016 | Settlement routes each pot to winner(s) and updates stacks; on-chain spend or BS channel update. | engine / tx-builder | integration |
| REQ-POKER-017 | If settlement stalls, the recovery/timeout path resolves value deterministically; funds never stranded. | engine / tx-builder | adversarial |
| REQ-PROD-001 | Wallet create/import; pluggable custody. | wallet-custody / ui-core | e2e |
| REQ-PROD-002 | Lobby: list/create/join tables; presence of other players. | app/sdk / relay-go / ui-core | e2e |
| REQ-PROD-003 | Ruleset + stake configuration with a displayed, hashed config. | ui-core / engine | e2e |
| REQ-PROD-004 | Table view: seats, turn, board/up cards, pot(s), balances, timers, default-on-timeout text. | ui-core | component + e2e |
| REQ-PROD-005 | Local private-hand inspection; never expose keys to the UI beyond the viewer path. | ui-core / wallet-custody | e2e |
| REQ-PROD-006 | Signing prompts that state exactly what is being signed. | ui-core | component + e2e |
| REQ-PROD-007 | Fold-without-reveal action. | engine / ui-core | e2e |
| REQ-PROD-008 | Showdown reveal of only what is required. | engine / ui-core | e2e |
| REQ-PROD-009 | Deterministic settlement display + final balances. | engine / ui-core | e2e |
| REQ-PROD-010 | Transcript export + deterministic offline replay. | persistence / ui-core | replay |
| REQ-PROD-011 | Reconnect/resume into a live table. | relay-go / engine / ui-core | integration |
| REQ-PROD-012 | Clear research/regtest banner; mainnet behind explicit flag. | ui-core / vm | e2e |
| REQ-TEST-001 | Unit (hand-eval, pots, betting, serialization vs §19.D/B vectors). | tests/unit | meta (CI) |
| REQ-TEST-002 | Replay equivalence + cross-client agreement (byte-identical). | tests/property | meta (CI) |
| REQ-TEST-003 | Every script template spend (pos+neg) executed through the real interpreter, Genesis on; neg fails inside interpreter. | tests/interpreter | meta (CI) |
| REQ-TEST-004 | Scripted full heads-up Hold'em hand runs through the VM on regtest + the failure injections. | tests/e2e | meta (CI) |
| REQ-TEST-005 | `reproduce` regenerates every committed vector and exits non-zero on mismatch; runs in the VM image. | tests/* | meta (CI) |
| REQ-TEST-006 | Adversarial suite: disconnect/stale/timeout/withheld-reveal/conflict/eviction/fair-play-violation/substitution/etc. | tests/adversarial | meta (CI) |
| REQ-TEST-007 | A phase is accepted only when its requirements trace to passing tests, reproduce is green, adversarial+e2e pass. | tests/* | meta (CI) |
| REQ-TX-001 | CLTV/CSV are no-ops on post-Genesis BSV and MUST NOT enforce timing. | script-templates-ts | interpreter (§14.3) |
| REQ-TX-002 | Timing enforced at the transaction level (nLockTime + nSequence under original replacement). | tx-builder | interpreter |
| REQ-TX-003 | Transaction-level timing + bond-forfeiture incentive is sufficient for the cooperative/timeout model. | tx-builder | interpreter + adversarial |
| REQ-TX-004 | Opcode palette limited to post-Genesis-meaningful primitives (sig/hash/conditional/numeric-stack for EC routines). | script-templates-ts | interpreter |
| REQ-TX-005 | Every tx binds gid, rulesetHash, round, state hash, acting seat, economic state, commitments, successor commitment. | tx-builder | interpreter |
| REQ-TX-006 | Two timeout layers: decision (default check-or-fold, never forced wager) and recovery (withheld reveal/stalled settlement). | tx-builder | adversarial |
| REQ-TX-007 | "Now" for timeouts from chain/relay-anchored height/time, not local wall-clock for consensus decisions. | engine / tx-builder | property |
| REQ-TX-008 | A pre-signed fallback graph is signed before play for every stall (abort/quorum/deck/deal/action/reveal/settlement/close). | tx-builder | interpreter + adversarial |
| REQ-TX-009 | Dead-end commitments (shuffle stage, ruleset-hash) MAY use OP_RETURN. | script-templates-ts | interpreter |
| REQ-TX-010 | Commitments that must stay in the spend-linked graph MUST be pushdata in a live script, not OP_RETURN. | script-templates-ts | interpreter |
| REQ-TX-011 | Each template ships a positive test, negative battery (fail inside interpreter), and a measured wire-byte size vector. | script-templates-ts | interpreter (§14.3) |
| REQ-TX-012 | Spending a Q_j UTXO requires a signature under Q_j per the active signing mode (A: reconstruct-at-reveal; B: threshold). | tx-builder / wallet-custody | interpreter |
| REQ-UI-001 | One TS/React UI core runs in the browser and inside Tauri; no business logic in the shell. | ui-core / client-* | component + e2e |
| REQ-UI-002 | Web persists via IndexedDB; no localStorage/sessionStorage for load-bearing state; desktop SQLite. | client-web | component |
| REQ-UI-003 | Interactions use explicit handlers, never `<form>` submit (avoids webview navigation side effects). | ui-core | component |
| REQ-UI-004 | The UI hides protocol complexity but never hides consequences (explicit default-on-timeout / committed-state text). | ui-core | component + e2e |
| REQ-UI-005 | Card decryption goes through the custody boundary; rendered face only in the controlled viewer path. | ui-core / wallet-custody | e2e |
| REQ-UI-006 | Every signing prompt shows action, amounts, affected pot/state, and the exact intent/bytes signed; no silent signing. | ui-core | component + e2e |
| REQ-VM-001 | A reproducible self-contained runtime launches node(regtest)+relay+client with no external services. | vm | e2e-in-image + reproduce |
| REQ-VM-002 | Image contains the bonded-subsat-channel embedded node (regtest), the Go relay/indexer, the client, and a bootstrap. | vm | e2e-in-image |
| REQ-VM-003 | Primary packaging: a reproducible container image + a one-liner that yields a playable stack. | vm | e2e-in-image |
| REQ-VM-004 | Desktop: a Windows installer (Tauri) that embeds/supervises a local node+relay so a user double-clicks and plays. | client-desktop / vm | e2e |
| REQ-VM-005 | A literal hypervisor VM image (OVA/qcow2), if required, is an extra artifact from the same composition (DECISION). | vm | packaging |
| REQ-VM-006 | The image build is reproducible (pinned toolchains, locked deps, recorded hashes). | vm | CI |
| REQ-VM-007 | Mainnet only behind an explicit named research flag; unmissable banner; regtest default everywhere. | vm / ui-core | e2e |
| REQ-WALLET-001 | One long-term secp256k1 key per player; per-game/per-card scalars via HKDF bound to (gid,j); old-game keys reveal nothing. | wallet-custody | unit + conformance |
| REQ-WALLET-002 | Distinct key sets for distinct jobs (signing vs card-encryption vs session); least authority. | wallet-custody | unit |
| REQ-WALLET-003 | A Custody interface abstracts where keys live and signing happens (derive/sign/decryptToViewer/combineSignShare). | wallet-custody | unit + conformance |
| REQ-WALLET-004 | Whole-key handling follows the signing mode: Mode A reconstructs w_j at reveal (single-game keys, bounded window); Mode B threshold. | wallet-custody | unit + conformance |
| REQ-WALLET-005 | In micro-betting mode, channel keys + the 1-sat bond managed via BS; presented as explicit signing actions. | wallet-custody | integration |

**Register notes.** (1) Module/test columns are the *intended* owners; the build's
`requirements.yaml` replaces them with the *actual* satisfying files and test IDs and adds
`status` (REQ-ENG-002). (2) CI fails if any row lacks a satisfying test or any consensus-path
file is untraced (REQ-ENG-003). (3) Decisions `D1–D9` and threats `THR-*` (§18) are tracked
in companion registers (`decisions.yaml`, `threats.yaml`) on the same generation pass.

---

# §20 Changelog — Red-Team Review 01 applied

This pass applied the corrections from `bsv-poker-spec-redteam-01.md`:

- **B1 (BLOCKER) resolved** — the unconditional "combined private key never reconstructed in one place" claim is removed from §0.6, §4.3, §6.6, §6.7, §9.3 and replaced by an explicit **signing-mode decision (D9)**: Mode A (patent-literal reconstruct-at-reveal, Phase-1 default, with single-game-key and bounded-window consequences stated) vs Mode B (threshold/no-reconstruction, upgrade). The spec no longer ships Mode A's mechanism while claiming Mode B's property (REQ-CRYPTO-008).
- **B2 (BLOCKER) resolved** — §4.3 now specifies the `minted → drawn(position) → revealed|folded → discarded` card lifecycle; the poker **deal** is the `draw` operation, and "selection-by-spend" is the **close-out/settlement** primitive, not the deal.
- **M1 resolved** — P2 reworded: determinism is relative to an agreed ordering; pre-confirmation safety is provided by §8.3+§8.5+§6.4; reorg/eviction handled by recovery + confirmation finality.
- **M2 resolved** — §4.6 board reveals are N-of-N cooperative transitions with a timeout-default.
- **M3 resolved** — §4.7/§6.6 fair-play scaling is a measured risk (REQ-CRYPTO-009) with a per-card/per-batch fallback; no "scales" claim until §19.C measures it.
- **M4 resolved** — §2.6 adds a contract-conformance suite binding fakes to real adapters (REQ-DEP-003) and requires security-critical paths tested against real implementations (REQ-DEP-004).
- **M5 resolved** — §13.1 states which Power-of-Ten rules are adopted/adapted/N-A; claims "NPR 7150.2 + a documented Power-of-Ten adaptation," never literal compliance.
- **M6 partially closed** — B1 Mode A gives Phase 1 a concrete signing construction (no threshold dependency); the reveal-token candidate remains provisional-normative pending cardtable's API.
- **m1 resolved** — §4.9 fixes participant-set-per-hand (fresh N-party shuffle each hand; sit-out/join between hands; no partial reshuffle).
- **m3 resolved** — §5.5.1 odd-chip rule is deterministic; any suit tiebreak is an explicit house-rule flag, defaulted OFF, never inside hand evaluation.

**Filled this pass:** §18 threat model (THR-* with bounding mechanism + residual risk +
trust surface), §19.B side-pot algorithm with a worked conserved example, §19.E Hold'em
heads-up state-transition table.

**Still open after RT-01, tracked honestly:** m2 (cost envelope) and m4 (stage-commitment
carriage re-examination) — folded into §19.C; m5 (trustless-prose hygiene sweep) — partially
done via §18.6, full sweep pending; §7.3 per-variant FSMs; §19.A canonical serialization;
§19.C byte schedules + fair-play measurement; §19.D vectors; §19.F register. Two
constructions remain `DECISION REQUIRED` pending cardtable's API: the Mode-B signing detail
(§6.7) and the reveal-token (§4.6) — neither blocks Phase 0/1, which run on Mode A.

# §20.1 Build-out pass 02

Added this pass, to the same standard, no padding:

- **§7.3 filled** — full FSMs for Omaha (Hold'em + 2 overrides; PLO; Omaha-8 noted), Seven-Card Stud (ante/bring-in/streets 3–7/up-down cards/best-5-of-7/8-handed exhaustion rule), Five-Card Draw (draw = no-reveal discard + private redraw; stand-pat timeout), and Razz (stud structure + ace-to-five low + bring-in/order reversals). New requirements **REQ-FSM-003…011** and the three new mental-poker primitives (up-card, down-card, draw) are specified and registered.
- **§19.D filled — verified, not asserted.** A reference evaluator was implemented and run; its output is embedded as the vector catalog. Consistency checks all pass (category ladder strictly descending; transitivity over 20,000 random triples; kicker/boat/flush orderings; Omaha 2+3 demonstrably diverging from generic best-of-7; ace-to-five low). The evaluator is the oracle the production code must reproduce bit-for-bit (`reproduce`, §14.5). One computed result corrected a label error of mine (a "paired eight-low" is actually a nine-low) — the computed truth governs, which is the point of generating rather than asserting.
- **§19.F filled** — the full **106-requirement** register (id, excerpt, owning module, test family), auto-generated from the document, with the canonical section authoritative and `requirements.yaml`/traceability called out (REQ-ENG-002/003).

**Still open after pass 02:** §19.A canonical serialization (byte-exact); §19.C script byte
schedules + the fair-play measurement (REQ-CRYPTO-009) + the per-hand cost envelope (m2);
§19.D remaining edge-case vectors (ties/odd-chip, coincident all-ins, folded-contributor,
Omaha-8 boundary); m4/m5 closure; the full multi-way (3–9 seat) transition tables; and the
two `DECISION REQUIRED` constructions pending cardtable's API. Mode A keeps Phase 0/1
unblocked.

---

## Build-out status of this specification

Through Build-out pass 02 this file fixes the architecture, principles, dependency contracts
and conformance, the cryptographic protocol (explicit signing-mode decision; deal-to-positions
lifecycle), the full poker domain model **and all five variant FSMs** (Hold'em, Omaha, Stud,
Draw, Razz), the BSV transaction/script model (post-Genesis CLTV/CSV correction; tx-level
timing), the engineering standard (honest Power-of-Ten adaptation), the test strategy
(conformance + interpreter-level + reproducible vectors), the SDK surface, the VM/packaging,
the shells, the phased plan with acceptance gates, the threat model (§18), the side-pot
algorithm with a worked example (§19.B), **verified hand-evaluation vectors generated by a
reference evaluator (§19.D)**, the Hold'em transition table (§19.E), and the **106-requirement
register (§19.F)**. Remaining high-volume content (§19.A serialization, §19.C byte schedules +
fair-play measurement + cost envelope, remaining edge-case vectors, multi-way tables) is
enumerated in §20.1 "Still open" and is written in subsequent passes to the same standard,
without padding.
