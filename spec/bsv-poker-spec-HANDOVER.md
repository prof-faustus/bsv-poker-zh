# HANDOVER — Completing the BSV Poker Platform Specification

**Purpose.** You are taking over authorship of a large engineering specification for a
**new** dealerless multiplayer poker platform on Bitcoin SV. This document tells you the
rules you must work under, what is verified (do not re-derive), what exists, what is done,
what remains, and exactly how to continue — so you can finish the spec without re-reading
the whole history.

**Read this, then open `bsv-poker-spec.md` (the spec) and `bsv-poker-spec-redteam-01.md`
(the review). The spec's §20 / §20.1 changelog is the live status; this handover frames it.**

---

## 0. The one-line scope

Write the **specification only**. The application is built in **Claude Code**, which has
the dependency repositories. **You build nothing** — no application code. A spec file, a
review file, and generated test vectors are the deliverables.

---

## 1. Hard rules (non-negotiable — from the principal; violating any is a failure)

1. **Zero fabrication.** Every number traces to a cited source, a measured value, or is
   marked `TRACKED ASSUMPTION`. A hardcoded figure that creates internal inconsistency is a
   material defect. **Generate vectors by running code, never from memory** (see §3, the
   oracle). A made-up reference or number is treated as fraud.
2. **No assumptions; classify them.** Every assumption appears explicitly. Hidden
   assumptions are the worst class of failure. If a thing is not fixed, mark it
   `DECISION REQUIRED` or `TRACKED ASSUMPTION` — do not assert it.
3. **No overclaim.** Never claim more than the construction guarantees. State boundaries in
   ink (e.g. the audit system cannot detect a lie at origin; N-of-N reveal is a liveness
   risk; "trustless" only within the enumerated trust surface §18).
4. **BSV-only, post-Genesis.** No BTC code, no BTC assumptions, no Lightning-style in-script
   penalty. **`OP_CHECKLOCKTIMEVERIFY`/`OP_CHECKSEQUENCEVERIFY` (CLTV/CSV) are no-ops on
   post-Genesis BSV** — timing is enforced at the **transaction level** (`nLockTime` +
   `nSequence` under the original replacement rule). Confusing BTC and BSV is a failure.
5. **Engineering bar.** NASA **NPR 7150.2** assurance practice + a **documented Power-of-Ten
   adaptation** (NOT literal compliance — rule 3 and the pointer rules are N/A in a GC
   runtime; say so). Requirements-traceability matrix. **Interpreter-level tests**: script
   spends run through the real BSV Script interpreter with Genesis rules; **negative tests
   must fail inside the interpreter**, never in a wrapper guard; signature spot-checks are
   not acceptable. **Reproducible vectors**: a `reproduce` command regenerates every number
   and exits non-zero on mismatch.
6. **Style.** Direct, concise, unambiguous. **Apologies are banned.** Do not pad. Do not
   bluff or sound confident without evidence.
7. **Do not second-guess the principal's stated facts.** The principal has stated the
   `prof-faustus` repositories exist and that Claude Code has access to them. **Accept
   this.** Build against their contracts (§2.1–§2.4 of the spec). Do not re-verify their
   existence or re-litigate it.

---

## 2. Verified facts (cite these; do not re-derive or re-check)

**The dependency repositories (real; the platform consumes them via the adapter contracts
in spec §2):**

- `bonded-subsat-channel` — sub-satoshi channels (granularity `k`, largest-remainder `Q*`
  whole-satoshi settlement, fixed 1-sat anti-cheat bond) **and** a self-contained embedded
  BSV system (native P2P-wire node, PoW header chain longest-by-work, DB-backed block/UTXO
  store, conflict-detecting mempool under the original replacement rule, HD wallet). This
  embedded node is the platform's **local chain backend** for the VM (spec §10.2, D6).
- `verifiable-accounting` (Rust), `verifiable-accounting-bsv` (TS), `verifiable-accounting-chain`
  (TS) — Merkle inclusion against block-header `merkleroot`; selective disclosure;
  triple-entry. **Stated boundary (must be surfaced, never overstated):** establishes only
  inclusion, integrity, selective disclosure, arithmetic correctness over disclosed records;
  **does not** establish truth-at-origin. Carries commitments as **pushdata in a live
  script, not `OP_RETURN`**, when they must stay in the spend-linked graph.
- `overlay-broadcast` — key-graph (Logical Key Hierarchy) broadcast encryption, `O(log n)`
  rekey, revocation = **unspent expiring output**, FROST/GG20 threshold custody, ECIES /
  AES-256-GCM. **Graded to NPR 7150.2 + Power of Ten with a requirements-traceability
  matrix** (the platform adopts the same bar). Basis for later revocable-content NFTs (a
  separate product, not in core poker phases) and for optional threshold custody of pot keys.
- `cardtable` — mental-poker engine + transaction-native game substrate. **Status (the
  author's own words):** protocol fully specified; off-chain crypto + simulation runnable;
  early build phases substantively in place; **full multi-card game partial; first target
  game In-Between**; CLI-first research code; regtest-by-default. The platform uses its
  *primitives*, not its game, and does **not** assume Hold'em exists in it.

**Corrections to the Grok-authored doc (do not propagate its errors):** `cardtable` does
**not** contain 5 poker variants + Blackjack ("Phases 0–5 complete" is false). Repos
`revocable-nft-tee` and `triple-entry-bsv-sql` are **not** in the author's current published
list; revocable NFTs are built on `overlay-broadcast`, and the polished product is unshipped.

**Patent GB2616862 (the shuffle/settlement primitive; read in full; in memory):** "Set
shuffling," Burns & Wright, applicant nChain Licensing AG, filed 2022-03-22, published as
**GB2616862A** (application) 2023-09-23. Cite as **A** unless/until B-grant is confirmed
(the v27 paper cites a "B" not confirmed by the document). Mechanism: shuffle key
`P'=(s,±√(s³+7))` on secp256k1, private key `s` = x-coord, public key `P=s·G`; per-element
**combined key** `Q_j = Σ P_{p,j}` (point addition); two-round encryption (shared scalar,
then per-element distinct scalars) + reorder = the shuffle, reversed by inverse scalars at
reveal; OP_RETURN stage commitments; settlement via 2-of-2 funding multisig + nLocktime
refund + locktime-tiered bet txs + fair-play scripts + optional 2-of-3 TTP. Worked example
is **2-party / 3-card** (Ace>King>Queen); scaling to N-party/52-card is the platform's work.

**The signing-mode fact (BLOCKER B1 resolved — do not reintroduce the error):** GB2616862
**reconstructs** the combined private key `w_j` at reveal (each party discloses its scalar;
the winner sums and signs). The earlier spec claim "never reconstructed in one place" was a
property of the *v27 threshold-ECDSA* path, **not** the patent — it was an internal
inconsistency and is removed. The spec now declares **Mode A** (patent-literal,
reconstruct-at-reveal; Phase-1 default; single-game keys; bounded hand-window exposure) vs
**Mode B** (threshold/no-reconstruction; upgrade; not BSVM-specific so BSV-compatible).
**Never present Mode A while claiming Mode B's property.**

**Post-Genesis Script (rule 4 above):** CLTV/CSV no-ops; timing at the transaction level.

---

## 3. Artifacts and working environment

| Path | What it is | Notes |
|---|---|---|
| `/mnt/user-data/outputs/bsv-poker-spec.md` | The specification (live) | ~1,700 lines, 115 requirements, 17 threats, 5 variant FSMs. §20/§20.1 is the status. |
| `/mnt/user-data/outputs/bsv-poker-spec-redteam-01.md` | Red-Team Review 01 | 2 BLOCKERs + 6 MAJOR + MINORs, all applied. Has the RT-02 re-review trigger. |
| `/home/claude/eval.py` | The hand-evaluation **oracle** | Run `python3 /home/claude/eval.py` to regenerate §19.D vectors and the consistency checks. This is the no-fabrication mechanism — extend it for new vectors. |
| `/mnt/project/` (read-only) | Source documents | GB2616862A patent; v27 poker paper + appendices; the In-Between architecture doc; the Cassandra schema; BSVM papers. Copy out before editing. |
| Memory | GB2616862 identity + mechanism | Already recorded; consistent with the above. |

**Environment notes:** the container has Python; `pip install --break-system-packages` if
needed. Output files go in `/mnt/user-data/outputs/`. To regenerate vectors:
`python3 /home/claude/eval.py`. The real BSV Script interpreter is **not** wired in this
authoring environment — interpreter-level tests (rule 5) are an obligation the **build**
(Claude Code) executes; the spec specifies them, and any script-byte measurement done here
is a structural estimate marked `TRACKED ASSUMPTION` until the build measures it for real.

---

## 4. Section status (snapshot — confirm against the spec's §20.1 before working)

| Spec section | Status |
|---|---|
| §0 principles, glossary, decisions D1–D9 | DONE |
| §1 product | DONE |
| §2 dependency contracts + conformance | DONE |
| §3 architecture | DONE |
| §4 mental-poker crypto (incl. signing-mode decision, card lifecycle) | DONE |
| §5 poker domain (hand eval, betting, pots, odd-chip) | DONE |
| §6 BSV tx/script model (incl. CLTV/CSV correction) | DONE |
| §7.1–§7.2 FSM framework + Hold'em | DONE |
| §7.3 Omaha / Stud / Draw / Razz FSMs | DONE (multi-way 3–9 tables still owed) |
| §8 networking/discovery | DONE (Phase-5 P2P/NAT detail owed in §8.7) |
| §9 wallet/custody | DONE |
| §10 self-contained VM | DONE (compose topology detail owed in §10.6) |
| §11 Windows + Web shells | DONE (full screen specs owed in §11.7) |
| §12 persistence/transcript/audit | DONE |
| §13 engineering standard + traceability | DONE |
| §14 test strategy + acceptance | DONE |
| §15 SDK contracts | DONE (full type signatures owed in §15.10) |
| §16 build/CI/reproducibility | DONE |
| §17 phased roadmap + gates | DONE |
| §18 threat model | DONE |
| §19.A canonical serialization | **OWED** |
| §19.B side-pot algorithm (worked) | DONE |
| §19.C script byte schedules + fair-play measurement + cost envelope | **OWED** |
| §19.D hand-eval vectors (generated) | DONE (edge-case vectors owed) |
| §19.E Hold'em transition table | DONE |
| §19.F requirements register (115) | DONE |
| §19.G references | DONE (light) |

---

## 5. Work remaining — in priority order, with how to do each

1. **§19.A canonical serialization (byte-exact).** Everything binds to it (P2 determinism;
   `rulesetHash`). Specify the exact byte layout for: card, ruleset, action, state, and the
   commitment preimages. *How:* fixed-width integers, defined endianness, length-prefixed
   variable fields, canonical field order, no floats. Provide a **computed** worked example
   (serialize a sample `Ruleset`, show the bytes and the resulting `rulesetHash`) by running
   a small script — do not hand-write the hash.
2. **§19.C script byte schedules + fair-play measurement (REQ-CRYPTO-009) + per-hand cost
   envelope (RT-01 m2).** *How:* (a) transcribe the GB2616862 fair-play locking/unlocking
   scripts (patent pages 55–72), count opcodes and pushdata bytes for the published
   **3-element / 2-party** case to get a real base size; (b) derive the scaling formula for
   52 cards × N parties and decide single-script vs **per-card / per-batch** fair-play
   transactions; (c) build a **per-hand transaction-count envelope** for heads-up Hold'em by
   counting the state transitions in §19.E that emit transactions (funding, commitments,
   deal, per-street reveals, per-action bets, fold/settlement, fair-play) — this count is
   structurally derivable now; **byte sizes** stay `TRACKED ASSUMPTION` until the build runs
   them through the real interpreter. Do **not** claim fair-play "scales" without the number.
3. **Remaining §19.D edge-case vectors.** Tie/odd-chip split; coincident all-in levels
   collapsing to one side-pot layer; folded-but-contributing player in a side pot (link to
   §19.B); Omaha-8 qualifying-low at exactly 8-high. *How:* extend `/home/claude/eval.py`,
   run it, embed the verified output. Never assert these.
4. **Full multi-way (3–9 seat) transition tables** for Hold'em (generalise §19.E) and the
   variants (generalise §7.3): round-close with multiple players, blinds/button rotation,
   multi-way side-pot settlement at the SETTLE state.
5. **§15.10 full type signatures, error enums, canonical serialization rules** for every SDK
   contract (§15.1–§15.9).
6. **m4 / m5 closure:** re-examine shuffle stage-commitment carriage (OP_RETURN vs pushdata)
   once §12.3 dispute-replay is finalized; sweep all prose uses of "trustless"/"non-custodial"
   to bound them by §18.6.
7. **Resolve the two `DECISION REQUIRED` items — requires reading `cardtable`'s actual code.**
   (a) the reveal-token construction (§4.6; leading candidate: consensus-timestamped
   single-use ECDH token bound to `(gid,j,position,height,recipient-ephemeral-key)`); (b) the
   Mode-B signing construction (§6.7; candidate: dealerless threshold ECDSA via `OB.custody`).
   *How:* have Claude Code clone `cardtable`; read its reveal/deal/signing API; fix both to
   the real API; then **trigger Red-Team Review 02** on the cryptographic core against the
   *fixed* constructions (the RT-01 file names this trigger). Mode A keeps Phase 0/1
   unblocked meanwhile.

---

## 6. Open decisions (defaults taken so the build is not blocked; principal may override)

`D1` first game = heads-up NL Texas Hold'em (regtest). `D2` seats 2–9 (P1 fixed 2; 6-max P3;
9-max P4). `D3` No-Limit first; PL/FL behind one interface. `D4` discovery = hosted relay +
LAN auto-discovery for P1; internet P2P/NAT at P5. `D5` "FULL VM" = reproducible
self-contained image (container + optional VM image) bundling node+relay+client, no external
services. `D6` reuse `bonded-subsat-channel`'s embedded node as local chain backend. `D7`
Blackjack deferred (dealerless blackjack ≠ symmetric poker shuffle). `D8` play-money / no
external value in early phases. `D9` signing **Mode A** default for Phase 1, Mode B upgrade.
Items most worth confirming with the principal: `D1` (first game), `D5` (does "VM" mean a
literal hypervisor image too?), `D9` (Mode A vs Mode B), and whether the variant set beyond
Hold'em is wanted in the order given.

---

## 7. Operational checklist (apply every pass)

- Before adding any vector/number: **compute it** (run code) or mark `TRACKED ASSUMPTION`.
- Before claiming any script is correct: it must be specified to pass the **real interpreter
  with Genesis rules**; negative cases fail **inside** the interpreter.
- After each pass: update the **§20.x changelog**; keep the **§19.F register count** in sync
  with the unique `REQ-*` count (a mismatch is a defect — there was one, now fixed); re-run
  `eval.py` consistency checks if vectors changed; report the **honest line count** (do not
  claim completeness you don't have).
- Maintain internal consistency: if you change a claim, grep for every place it appears and
  fix all of them (B1 lived in five places).
- Keep the document **BSV-only**; no CLTV/CSV for timing; no BTC anything.
- Do not apologize; do not pad; do not second-guess the principal's stated facts.

---

## 8. Definition of done (when the spec is complete)

The specification is complete when: every section is filled (no `[EXPAND]` / `OWED`); every
`REQ-*` is registered with an intended owning module and test family and is traceable; every
vector/number is generated and reproducible (`reproduce` green); the per-hand cost and the
fair-play size are measured (or carry an explicit, justified `TRACKED ASSUMPTION` pending the
build's interpreter run); the two `DECISION REQUIRED` constructions are fixed against
`cardtable`'s real API; **Red-Team Review 02** has re-checked the cryptographic core against
the fixed constructions; and — the practical test — **Claude Code can build Phase 0 and Phase
1 from the spec without asking a further design question.** The full 10k–50k-line target is
reached by completing §19.A, §19.C, the remaining §19.D vectors, the multi-way tables, and
§15.10 to the same standard, without padding.

---

## 9. Immediate next action (what the continuing author should do first)

Start with **§19.A canonical serialization** (it unblocks nothing else's *correctness* but is
the foundation everything binds to, and it is fully specifiable now with a computed example),
then **§19.C** (transaction-count envelope now, fair-play byte measurement from the patent
script, byte sizes marked pending the interpreter), then the **remaining §19.D edge-case
vectors** via `eval.py`. The continuation that accompanies this handover begins §19.A.
