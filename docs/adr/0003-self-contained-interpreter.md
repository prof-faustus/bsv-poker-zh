# ADR 0003 — Self-contained Genesis Script interpreter for Phase 0/1

**Status:** Accepted

**Context.** P9 (core §14.3) requires script spends to run through a **real** BSV Script
interpreter with Genesis rules, with negative tests failing **inside** the interpreter. The
embedded `bonded-subsat-channel` node's production interpreter is the eventual target, but it is
not yet bound, and the build must demonstrate P9 now.

**Decision.** Implement a real stack interpreter (`script-templates-ts/src/interpreter.ts`)
covering the opcode subset the templates use, with **real secp256k1 ECDSA** `OP_CHECKSIG`/
`OP_CHECKMULTISIG` (Node crypto), real hash/conditional/stack ops, CLTV/CSV as **no-ops**
(REQ-TX-001), and `OP_RETURN` rejected (core P11). Negative spends fail inside it.

**Consequences.** P9 is met today with a genuine interpreter (not signature spot-checks).

**Update (v3): the sighash divergence is closed.** `tx-builder/wire.ts` now produces the real BSV
**wire serialization** (txid = double-SHA256) and the real **BIP-143 (FORKID) sighash preimage**.
`OP_CHECKSIG` verifies ECDSA over `sha256(sighashMessage)` where `sighashMessage = sha256(preimage)`
— so the effective signed digest is `double-SHA256(preimage)`, the production sighash. Spends signed
over the BIP-143 sighash validate inside the interpreter (and tampering the tx invalidates them),
verified in `tx-builder/test/wire.test.ts`. Remaining tracked item: only the template opcode subset
is implemented, and broadcasting these txs needs the embedded node's tx-submit RPC (the node daemon
currently exposes mine/height) — the wire+sighash they'd be submitted with are now real.
