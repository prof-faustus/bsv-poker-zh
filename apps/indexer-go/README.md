# indexer-go

Table-transaction **indexer** for bsv-poker (BSV-only, post-Genesis).

> **REQ-NET-001 (core §8.1, P3):** the indexer is a **convenience projection,
> NEVER the source of truth**. The truth is the validated transaction graph. The
> indexer ingests opaque protocol-transaction records and builds per-table
> projections (ordered txid list per table id, deduplicated by txid). The
> ordering is deterministic: any client can call `Rebuild` over the same record
> stream and reconstruct an identical ordered set (P2, REQ-NET-007), treating the
> served list as a hint to confirm against the canonical tx graph (app §A7.1).

Zero external dependencies — Go standard library only.

Per the ordered-startup rule (REQ-APP-021) the supervisor starts the indexer
**before** the relay.

## Run

```
go run . -addr 127.0.0.1:8092
```

Flag: `-addr` loopback listen address (default `127.0.0.1:8092`).

## Endpoints (REQ-NET-004, core §8.4)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | `200` + `{"status":"ok"}` (supervisor liveness). |
| `POST` | `/ingest` | Ingest an opaque record. Body: `{"txid","class","tableId","raw"}` (≤1 MiB). Returns `{"added":bool}` (`false` = duplicate txid for that table). |
| `GET` | `/table/{id}` | Ordered, de-duplicated txid list for a table: `{"tableId","txids":[...]}`. |
| `GET` | `/tables` | Sorted list of known table ids. |

## Determinism contract

- Ordering = strict first-seen insertion order; duplicate txids (per table) are dropped and keep their first position.
- `Rebuild(tableID, records)` (pure, stateless) is the function any client uses to verify the projection independently — replaying the same record sequence yields the same ordered txid list.
- The `raw` payload is opaque; the indexer never parses or adjudicates game logic.

## Tests

```
go test ./...
```

Covers dedup, deterministic ordering, per-table isolation, input validation,
`Rebuild`-vs-live equivalence, and the `/healthz` + `/ingest` + `/table/{id}`
HTTP surface.
