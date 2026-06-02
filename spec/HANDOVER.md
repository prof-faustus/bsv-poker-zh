# HANDOVER — BSV Poker Platform spec (continue in a fresh chat)

## 0. What this is
A **new** dealerless multiplayer **poker** platform on **Bitcoin SV**, specified for build
in Claude Code. You (the assistant) **write the spec only — build nothing**. The actual
app is built later in Claude Code, which **has the dependency repos already** (accept this;
do not re-verify, do not second-guess).

## 1. Files (in /mnt/user-data/outputs unless noted)
- `bsv-poker-spec.md` — the master spec. **~1,700 lines, ~19k words, 115 requirements, 17 threats.** This is the live document; extend it in place.
- `bsv-poker-spec-redteam-01.md` — formal red-team review (B1/B2 blockers + 6 MAJOR + minors), all already applied to the spec (§20 changelog).
- Reference evaluator that generated §19.D vectors: `/home/claude/eval.py` (re-run to regenerate; it is the hand-eval oracle). **NOTE: container filesystem resets between sessions — the spec already embeds the verified output, so eval.py may need re-creating if you want to extend the vectors.**

## 2. Hard rules — DO NOT BREAK (user's review framework)
- **BSV-only.** Post-Genesis BSV. No BTC code, no BTC assumptions. BTC = automatic fail.
- **OP_RETURN is BANNED.** Absolute. Any OP_RETURN = automatic reject (see §3, the #1 fix).
- **Zero fabrication.** Every number traces to a source or a declared `TRACKED ASSUMPTION`. Generate values by running code (as §19.D does), never write from memory.
- **No assumptions / no hidden assumptions.** Declare every design choice; mark `DECISION REQUIRED` where unfixed. Hidden assumptions are the worst defect class.
- **No overclaim.** State only what the construction guarantees; enumerate the trust surface.
- **Apologies are banned.** Be direct, concise. Own errors plainly, fix them, move on.
- **Engineering bar:** NPR 7150.2 + a *documented Power-of-Ten adaptation* (not literal compliance — rule 3/pointers N/A in GC), requirements-traceability matrix, tests through the **real Script interpreter** (negative tests fail *inside* it; no signature spot-checks), reproducible committed vectors.
- **No padding.** A dense 10k-line spec beats a padded 50k. Target is 10k–50k lines of *real* content, reached across passes.

## 3. ⚠️ #1 FIX FOR THE NEXT SESSION (BLOCKER) — OP_RETURN ban violation
The spec currently **permits OP_RETURN** for dead-end stage commitments. This **violates the
project's absolute OP_RETURN ban.** Locations to fix:
- §0.6 glossary "post-Genesis" line; §4.4 **REQ-CRYPTO-004**; §6.5 **REQ-TX-009**; any other "OP_RETURN" hit (`grep -n OP_RETURN bsv-poker-spec.md`).
**Required fix:** replace every OP_RETURN with a **pushdata-in-script** construction
(`OP_PUSHDATA <data> OP_DROP` carried in a live, spendable script — the same choice
verifiable-accounting uses, and which GB2616862 itself lists as the alternative). Update
§6.5 so the rule becomes "**never OP_RETURN; all commitments are pushdata-in-script**,"
delete REQ-TX-009's OP_RETURN allowance, and re-scan. Add a principle (e.g. P11) "OP_RETURN
is prohibited" so it cannot creep back. This is a correctness blocker, not a style note.

## 4. Verified technical facts to preserve (do not re-derive wrongly)
- **CLTV/CSV (`OP_CHECKLOCKTIMEVERIFY`/`OP_CHECKSEQUENCEVERIFY`) are NO-OPS on post-Genesis BSV.** All timing is at the **transaction level** (nLockTime + nSequence under the original replacement rule). Never in-script. (§6.2, REQ-TX-001/002.)
- **GB2616862A** ("Set shuffling", Burns & Wright; applicant nChain Licensing AG; cite as **A**, not B — grant unconfirmed) is the shuffle/settlement primitive: shuffle key `P'=(s,±√(s³+7))`, private key = x-coord, public key `P=s·G`; per-card combined key `Q_j=Σ P` by point addition; two-round encryption (shared scalar then per-element distinct scalars) + reorder = the shuffle, reversed by inverse scalars at reveal; settlement via 2-of-2 funding multisig + nLockTime refund + tiered bet txs + fair-play scripts + optional 2-of-3 TTP. Worked example is 2-party/3-card highest-card-wins — **poker deals to positions** (the spec's `minted→drawn→revealed|folded→discarded` lifecycle; §4.3), and the combined-key spend is **close-out, not the deal**.
- **Signing mode (D9, §4.3):** Mode A (patent-literal, reconstruct `w_j` at reveal; single-game keys; bounded hand-window; **Phase-1 default**) vs Mode B (threshold/no-reconstruction; upgrade). Never claim Mode B's "no whole key" property while shipping Mode A.
- **Dependency stack (accept as existing, Claude Code has them):** `cardtable` (mental-poker substrate; partial In-Between; protocol fully specified, off-chain/sim runnable — NOT the five poker variants, that was a Grok-doc overclaim), `bonded-subsat-channel` (sub-sat micro-payments + a **self-contained embedded BSV node** reused as the local regtest backend), `verifiable-accounting` ×3 (Merkle-anchored selective-disclosure audit; pushdata-not-OP_RETURN), `overlay-broadcast` (key-graph broadcast encryption, revocation = unspent-expiring-output, FROST/GG20 threshold custody). `revocable-nft-tee` / `triple-entry-bsv-sql` were in the Grok doc but NOT in the author's published list — treat NFT/revocation as built on `overlay-broadcast`, a later track.
- TEE is **optional** (custody backend pluggable; no phase requires it).

## 5. Current state (done)
- Part 1: full architecture, principles (P1–P10), dependency contracts + conformance, mental-poker protocol, poker domain model (hand eval incl. Omaha-2+3 & ace-to-five low, betting, side pots, odd-chip determinism), BSV tx/script model, NASA-grade standard, test strategy, SDK, VM/packaging, Windows+Web shells, phased roadmap (Phase 1 = heads-up NL Hold'em on regtest with discovery).
- Red-team 01 applied: B1 (w_j reconstruction inconsistency → signing modes), B2 (deal-vs-select → lifecycle), M1–M5, m1, m3 all fixed in place.
- Pass 02: **§7.3** all five variant FSMs (Hold'em, Omaha, Stud, Draw, Razz) + REQ-FSM-003…011; **§19.B** side-pot algorithm with a worked, conservation-checked example; **§19.D** verified hand-eval vectors (generated by eval.py; all consistency checks pass); **§19.E** Hold'em transition table; **§19.F** 115-row requirements register.

## 6. Open decisions
- D1 first game = heads-up NL Hold'em (default). D2 seats 2–9. D3 NL first. D4 discovery = relay + LAN (Phase 1), internet P2P (Phase 5). D5 "VM" = self-contained container/VM image bundling node+relay+client. D6 reuse bonded-subsat-channel node. D7 Blackjack deferred. D8 play-money/regtest. D9 signing Mode A default.
- **DECISION REQUIRED after reading cardtable's API (not blocking Phase 0/1):** the exact reveal-token construction (§4.6) and the Mode-B signing construction (§6.7). Read cardtable before fixing these.

## 7. Remaining work (ordered) — continue here
1. **OP_RETURN ban fix (§3 above) — do first.**
2. **§19.C** — reconstruct the GB2616862 fair-play script structure and **measure** its byte size at 52 cards × N (settles the M3 scaling risk, REQ-CRYPTO-009, with a real number, not "it scales"); add the **per-hand transaction-count + byte cost envelope** (closes m2). Provide the per-card/per-batch fallback if a single script is impractical.
3. **§19.A** — byte-exact canonical serialization (cards, ruleset, actions, state, tx). Everything binds to this; determinism (P2) depends on it.
4. **§19.D edge cases** — ties/odd-chip split, coincident all-in levels, folded-but-contributing player in a side pot, Omaha-8 qualifying-low boundary (regenerate via eval.py).
5. Full **multi-way (3–9 seat)** transition tables (generalise §19.E and the stud/razz tables).
6. Close **m4** (stage-commitment carriage — moot once OP_RETURN is gone; confirm pushdata + spend-linking) and **m5** (full "trustless/non-custodial" prose hygiene sweep against §18.6).
7. After cardtable is read: fix the two DECISION REQUIRED constructions; then run **Red-Team Review 02** against the fixed crypto core.

## 8. How to continue (process)
- Each pass: add real content, then **red-team your own additions** (severity-rated: BLOCKER/MAJOR/MINOR + required fix + verdict), fix in place, log in §20.x.
- Generate any numbers/vectors by **running code**, embed verified output.
- Keep the requirements register and traceability complete (every REQ-* gets one row; CI fails otherwise).
- Report progress **honestly** with real metrics (lines/words/REQ count); never claim completeness you don't have.
- Stay BSV-only; no OP_RETURN; no apologies; concise.

**First action in the new chat:** open `bsv-poker-spec.md`, do §7 step 1 (kill OP_RETURN), then §19.C measurement.
