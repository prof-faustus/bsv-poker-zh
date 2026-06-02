# Red-Team Review 01 — `bsv-poker-spec.md` (Part 1)

**Subject:** Master Engineering Specification, Part 1.
**Method:** adversarial review against the document's own principles (P1–P10) and the
stated engineering bar. Each finding states the defect, the principle it violates, and the
required fix. Severity: **BLOCKER** (spec is unsound until fixed), **MAJOR** (must be fixed
before the affected phase ships), **MINOR** (must be fixed; not phase-blocking).
**Reviewer stance:** no deference to the author (myself). A single internal inconsistency
in a load-bearing claim is sufficient to reject the section it governs.

**Verdict:** **Revise-and-resubmit.** The architecture is sound and the contracts are
usable, but the document contains **two BLOCKER-class internal inconsistencies** in the
cryptographic core (B1, B2) that, left standing, would propagate a false security claim
into the build. Six MAJOR defects and several MINOR ones follow. None are unsalvageable;
all are fixed in the corrections applied this pass (see end).

---

## BLOCKERS

### B1 — The "combined private key is never reconstructed in one place" claim contradicts the GB2616862 mechanism the spec is built on.

**Where:** §0.6 glossary; §4.3 ("`w_j … **never reconstructed in one place**`"); §6.6
per-card selection lock; §6.7; §9.3 REQ-WALLET-004.

**Defect.** The spec asserts, as an unconditional property, that the combined private key
`w_j = Σ_p s_{p,j}` is never reconstructed in one place. But the cited basis — GB2616862,
§2.5 — does the opposite. In the patent's worked settlement (pages 47–61), bet outputs are
locked to a combined address `P = (s_A·G)+(s_B·G)`, and to spend it a party must produce a
signature under `P`, which requires the scalar `w = s_A + s_B`. The patent's reveal step
(Figure 15; pages 49, 59–61) has each party **disclose their private key share** so the
winner can derive `w` and sign. The patent reconstructs `w` in the winner's hand. The
"never reconstructed" property is the *v27 academic paper's* addition (threshold ECDSA),
not a property of GB2616862.

So the spec claims a security property (no whole-key reconstruction) while citing a
primitive that reconstructs the whole key. This is an internal inconsistency in the
load-bearing claim of the settlement layer.

**Principle violated:** P6 (a claim that creates internal inconsistency is a material
defect), P8 (no overclaim — asserting a property the chosen construction does not provide).

**Required fix.** Replace the unconditional claim with an explicit two-mode decision,
stated with consequences:

- **Mode A — patent-literal (reconstruct-at-reveal).** Follow GB2616862: at reveal,
  parties disclose the per-card scalars; the winner sums to `w_j` and signs the
  combined-key spend. Consequence to state in ink: the disclosed scalars are reusable
  secret material once revealed, so (i) per-card keys are single-game and never reused,
  (ii) funds locked to combined keys are active only for the shuffle/hand window (hours, per
  GB2616862 pages 39–40), and (iii) the security argument is the patent's bounded-window
  argument, **not** "no whole key ever exists." Simpler; faithful to the cited primitive.
  **DEFAULT for Phase 1.**
- **Mode B — no-reconstruction (threshold/multi-party signing).** Produce the `Q_j`
  signature by a dealerless threshold/multi-party ECDSA so `w_j` never exists whole. This
  is the v27 improvement but is **not** BSVM-specific and therefore compatible with the
  BSV-only constraint (P1). More complex; an explicit hardening upgrade (Phase 2+).

The unconditional "never reconstructed in one place" text is deleted everywhere and
replaced by a reference to this mode decision. **The default must not claim Mode B's
property while shipping Mode A's mechanism.**

### B2 — "Selection = spending the UTXO" is asserted as the dealing mechanism, but poker deals to positions; the mapping is unspecified.

**Where:** §0.6 glossary; §4.3 ("**Selecting card `j` is mechanically spending that
UTXO**"); §6.1 Deal class.

**Defect.** GB2616862's worked game is *highest-card-wins*: each player **selects** one
card by spending its combined-key UTXO. Hold'em (and every poker variant) does not work by
players selecting cards; the protocol **deals** concealed cards to positions (two hole
cards per seat; three/one/one board cards) in a defined order, and the combined-key spend
is the *settlement* event at the end, not the deal. The spec imports "selection = spend"
verbatim and never maps the poker **deal-to-positions** operation onto the primitive. As
written, it implies players pick cards by spending, which is not Hold'em. This is an
unstated gap in the central state mechanic.

**Principle violated:** P7 (hidden/omitted assumption about how dealing maps to the
primitive), P2 (the state machine cannot be deterministic if the deal operation is
undefined).

**Required fix.** Specify the card lifecycle explicitly (adopting the v27 covenant-chain
lifecycle, which is the correct shape for deal-to-positions games):
`minted → drawn(position) → revealed | folded → discarded`. The **draw/deal** operation
binds a concealed card UTXO to a seat-position as a committed state transition (this is the
poker "deal", not a player selection). "Selection-by-spend" of the combined-key UTXO is the
**close-out/settlement** primitive used at reveal/showdown, not the deal. §4.3, §5, §6.1,
and §7 must use this lifecycle consistently; "selection" must not be used to mean "deal".

---

## MAJOR

### M1 — The determinism principle overstates what holds before confirmation.

**Where:** §0.1(4); P2 (§0.2); §3.3.

**Defect.** P2 states `table_state = f(valid_tx_set, ruleset)` and that honest clients with
the same valid tx set agree. True as stated — but it quietly assumes clients *have the same
valid tx set*, which is exactly what is **not** globally true before confirmation:
unconfirmed transactions can be evicted from a mempool, reorganized, or seen in different
orders by different peers (the document itself acknowledges mempool volatility in §8.4).
The determinism property is real but **relative to an agreed transaction ordering**; the
thing that makes pre-confirmation play *safe* is the convergence machinery (dual-path
propagation §8.3 + deterministic conflict rules §8.5 + timeout-default §6.4), not the
determinism property alone. Presenting P2 without this is an overclaim about safety.

**Principle violated:** P8 (overclaim), P7 (the "same valid tx set" precondition is hidden).

**Required fix.** Sharpen P2: determinism is relative to an agreed transaction ordering;
state explicitly that (i) pre-confirmation convergence is provided by §8.3+§8.5+§6.4, not by
determinism per se; (ii) reorg/eviction is handled by the recovery/timeout path (§6.4) and
by treating block confirmation as final settlement for value that leaves the table; (iii)
the engine is deterministic *given* an ordering, and disagreements about ordering are
resolved by §8.5, not by the engine.

### M2 — Board (community-card) reveals are described as merely "published"; they are N-of-N cooperative operations with a liveness failure mode.

**Where:** §4.6 ("Public reveal (board cards): revealed to all… any observer can verify").

**Defect.** A board card is concealed under every party's encryption until reveal.
*Producing* the public reveal requires **all N parties to release their decryption
material**; a single withholder prevents the flop/turn/river from being revealed. The spec
describes only the *verification* of a published reveal and omits that the *production* of
the reveal is an N-of-N cooperative step with a timeout-default. As written it hides a
liveness failure mode at every street.

**Principle violated:** P4 (every actionable state needs a timeout exit — board reveal is
such a state and was not given one), P7.

**Required fix.** State that each board reveal is an N-of-N cooperative transition with a
timeout-default branch (recovery if a party withholds), exactly like a player action; the
withholding case resolves via §6.4 and bond slashing where configured.

### M3 — Fair-play scaling to a 52-card deck is assumed, not measured; the patent's in-script proof is already large for 3 cards.

**Where:** §4.7 REQ-CRYPTO-006 ("scaled from the patent's 3-element worked example to the
deck size"); §6.6 Fair-play template.

**Defect.** GB2616862's fair-play locking script (pages 68–72) is a long nested
`OP_IF`/`OP_ELSE` structure for **3 elements and 2 parties**. The spec says it is "scaled
to the deck size" as if that were a parameter change. For 52 cards × N parties, an in-script
proof that every committed key derives every used key may be an enormous script. Post-Genesis
BSV removed the script-size cap, so it is not impossible, but the byte size, fee, and
constructibility are unmeasured. Asserting it scales is an unproven claim.

**Principle violated:** P6 (no fabricated/assumed numbers — "scales" is an unverified
performance claim), P8.

**Required fix.** Mark fair-play scaling as a measured risk: REQ to **measure** the
fair-play script size for the target deck/party counts before relying on a single-script
approach; specify the fallback (per-card or per-batch fair-play transactions) if the single
script is impractical; do not state it scales until §19.C carries a measured byte schedule.

### M4 — Testing the engine against fakes for CT/BS/VA/OB can hide protocol-security bugs; no conformance requirement binds fakes to real implementations.

**Where:** §2.6 REQ-DEP-001/002; §14.1.

**Defect.** The spec tests the engine against in-memory fakes of the dependency contracts
and notes "fakes are for the non-script orchestration." But the security-critical behaviors
— shuffle correctness, reveal single-use, fair-play forfeiture — live precisely in those
dependencies. A green test suite against fakes can certify an engine that is wrong about the
real crypto. There is no requirement that the **real adapters pass the same contract
conformance suite as the fakes**, nor that security-critical paths are tested against real
implementations.

**Principle violated:** P9 (a test must exercise the real behavior, not a flattering stand-in).

**Required fix.** Add: (i) a single **contract conformance suite** that both the fake and
the real adapter must pass, so the fake provably matches the real contract; (ii) a
requirement that shuffle, reveal, and fair-play are tested against the **real** CT/crypto
implementations (and through the real Script interpreter for the on-chain parts), with fakes
permitted only for orchestration wiring, never for the security property under test.

### M5 — "NASA NPR 7150.2 + Power of Ten" is claimed; several Power-of-Ten rules cannot hold in a GC'd TS/Go runtime, so literal compliance is not achievable.

**Where:** §13.1 REQ-ENG-001; §3.2 hand-eval note; §5.3.4.

**Defect.** Power-of-Ten rule 3 (no dynamic memory allocation after initialization) and the
pointer/aliasing rules are written for C in safety-critical embedded contexts. In a
garbage-collected TypeScript/Go application they cannot literally hold; the spec says "where
applicable," which is honest but soft, and the headline "built to … Power of Ten" reads as
literal compliance. Claiming literal compliance would be an overclaim.

**Principle violated:** P8 (overclaim), P7 (the "where applicable" carve-out is too quiet to
carry the weight).

**Required fix.** State plainly which Power-of-Ten rules are **adopted**, which are **adapted**,
and which are **N/A** for a GC runtime (rule 3 and the raw-pointer rules are N/A; bounded
loops, no-recursion-in-consensus-paths, assertions, checked returns, small functions,
warnings-as-errors, restricted `any` are adopted/adapted). Claim "an adaptation of the
Power-of-Ten rules appropriate to a GC runtime," not literal compliance.

### M6 — The reveal-token construction and the signing construction are both `DECISION REQUIRED`, but both are load-bearing security mechanisms; the spec ships a security model with two holes.

**Where:** §4.6 (reveal token); §6.7 (combined-key signing).

**Defect.** Confidentiality of a player's hand depends entirely on the reveal-token
construction; settlement integrity depends on the signing construction. Both are deferred to
"after reading cardtable's API" with only a "leading candidate." A security model with its
two central mechanisms unfixed is not yet a security model — it is a placeholder. This is
acceptable as an explicitly-marked Part-1 boundary **only if** the spec states the fallback
that lets Phase 0/1 proceed without them and does not let the holes hide.

**Principle violated:** P7/P8 (the holes must be visible and bounded, not glossed).

**Required fix.** For each: (i) fully specify the leading candidate as the **provisional
normative** construction (so the build is not blocked), (ii) state the exact property each
must provide and the test that will confirm it, (iii) bind the final choice to an explicit
action (read cardtable's API) with a named owner, and (iv) cross-reference both from §18.
B1's Mode A already gives a concrete signing path for Phase 1, which closes the §6.7 hole
for the default; say so.

---

## MINOR

### m1 — Participant set per hand is unspecified.

The shuffle is N-of-N over the seated set, but players sit out/join between hands; the spec
never states that each hand is a **fresh N-party shuffle over the currently-seated set**,
that sit-out/join takes effect **between hands only**, and that there is **no partial
reshuffle** of an in-progress deck. Add this (it is also a determinism input: who is in the
party set fixes the canonical order §4.4).

### m2 — No on-chain cost model.

The spec specifies 52 combined-key UTXOs + stage commitments + per-action/per-reveal/fold/
settlement transactions but carries no transaction-count or byte/fee model per hand. Even on
regtest (where fees are irrelevant) the design needs a cost envelope to judge feasibility and
to size the fair-play question (M3). Add a per-hand transaction-count and byte estimate as a
`TRACKED ASSUMPTION` to be replaced by measured values in §19.C. (For reference, the v27
paper reports order-of-thousands of bytes for a 52-card Hold'em game; the platform must
derive its own figure, not import that one.)

### m3 — Odd-chip rule mixes a determinism rule with a possible suit-precedence rule.

§5.5.1 gives a deterministic "left of the button" rule (good) but then mentions a stud "high
card by suit order" tiebreak. Poker hand ranking has **no** suit precedence; any suit-based
tiebreak is a house rule and must be flagged as such and defaulted **off**, so it is not
mistaken for hand-evaluation logic. Tighten the wording.

### m4 — `OP_RETURN` vs pushdata guidance is correct but the shuffle stage commitments should be re-examined.

§4.4 REQ-CRYPTO-004 commits shuffle stages via `OP_RETURN`. That is fine **if** those
commitments are genuinely dead-end (anchoring only). But if dispute-replay (§12.3) ever needs
the commitment to remain in the spend-linked graph (e.g. to bind a stage to the next stage's
spend), it must be pushdata (§6.5). Add a note that the carriage choice for stage commitments
is revisited when §12.3's dispute mechanism is finalized.

### m5 — Glossary "trustless" hygiene.

The glossary and §4.8 are careful, but §1 and §2 use "trustless"/"non-custodial" in prose.
Ensure every such use is bounded by the enumerated trust surface (§18) or replaced with the
specific property meant. (Tracked for the §18 pass.)

---

## What this pass fixes

The corrections for **B1, B2, M1, M2, M3, M4, M5** and **m1, m3** are applied in place to
`bsv-poker-spec.md` this pass (see the changelog appended to that file, §20). **M6** is
partially closed (B1 Mode A closes the signing hole for the Phase-1 default; the reveal-token
candidate is elevated to provisional-normative). The remaining expansion — §18 threat model
(filled), §19.B side-pot algorithm (worked example), §19.E Hold'em transition table — is
written this pass. m2, m4, m5 and the full §19.C/D catalogs are scheduled for the next pass
and listed in §20.

**Re-review trigger:** once B1's mode is confirmed (A vs B) and cardtable's reveal/signing
APIs are read, a Red-Team Review 02 re-checks the cryptographic core against the *fixed*
constructions, not the candidates.
