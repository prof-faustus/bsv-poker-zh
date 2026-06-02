// Package indexer builds per-table projections of protocol transactions.
//
// REQ-NET-004 (core §8.4): via BS.node the platform ingests opaque
// protocol-transaction records and builds per-table projections (ordered tx
// list per table id, deduplicated by txid).
//
// REQ-NET-001 (core §8.1, P3): the indexer is a CONVENIENCE PROJECTION, never
// the source of truth. The truth is the validated transaction graph; the
// indexer must reconstruct an identical ordered set that any client can rebuild
// independently (P2, REQ-NET-007). Determinism is therefore the central
// contract: see Rebuild, which any client can run over the same record stream
// to obtain the same ordered txid list.
package indexer

import (
	"errors"
	"sort"
	"sync"
)

var (
	// ErrEmptyTxid rejects records without a txid (defensive validation).
	ErrEmptyTxid = errors.New("indexer: empty txid")
	// ErrEmptyTable rejects records without a table id.
	ErrEmptyTable = errors.New("indexer: empty table id")
)

// Record is an opaque protocol-transaction record ingested from BS.node.
// The indexer treats Raw as opaque bytes; it never parses game logic
// (REQ-NET-001). Class is an opaque tag the producer assigns.
type Record struct {
	Txid    string `json:"txid"`
	Class   string `json:"class"`
	TableID string `json:"tableId"`
	Raw     []byte `json:"raw,omitempty"`
}

// tableProjection holds the ordered, de-duplicated tx set for one table.
type tableProjection struct {
	order []string            // txids in deterministic insertion order
	seen  map[string]struct{} // dedup set
	recs  map[string]Record   // full records by txid (for transcript rebuild / reconnect)
}

// Indexer is the concurrency-safe collection of per-table projections.
type Indexer struct {
	mu     sync.Mutex
	tables map[string]*tableProjection
}

// New constructs an empty indexer.
func New() *Indexer {
	return &Indexer{tables: make(map[string]*tableProjection)}
}

// Ingest adds a record to its table's projection. Duplicate txids (per table)
// are ignored, preserving first-seen ordering. Returns true if the record was
// newly added, false if it was a duplicate. Determinism: ordering is strictly
// first-seen insertion order; replaying the same record sequence yields an
// identical ordered set (REQ-NET-007).
func (ix *Indexer) Ingest(rec Record) (bool, error) {
	if rec.Txid == "" {
		return false, ErrEmptyTxid
	}
	if rec.TableID == "" {
		return false, ErrEmptyTable
	}
	ix.mu.Lock()
	defer ix.mu.Unlock()
	tp := ix.tables[rec.TableID]
	if tp == nil {
		tp = &tableProjection{seen: make(map[string]struct{}), recs: make(map[string]Record)}
		ix.tables[rec.TableID] = tp
	}
	if _, dup := tp.seen[rec.Txid]; dup {
		return false, nil
	}
	tp.seen[rec.Txid] = struct{}{}
	tp.order = append(tp.order, rec.Txid)
	tp.recs[rec.Txid] = rec
	return true, nil
}

// Records returns the FULL ordered records for a table (the transcript) so any client can
// rebuild current state from the valid tx set (REQ-NET-007, REQ-DATA-002/003). A copy is
// returned; an unknown table yields an empty slice.
func (ix *Indexer) Records(tableID string) []Record {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	tp := ix.tables[tableID]
	if tp == nil {
		return []Record{}
	}
	out := make([]Record, 0, len(tp.order))
	for _, id := range tp.order { // bounded by len(order)
		out = append(out, tp.recs[id])
	}
	return out
}

// Table returns the ordered txid list for a table id. A copy is returned so the
// caller cannot mutate internal state. An unknown table yields an empty slice.
func (ix *Indexer) Table(tableID string) []string {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	tp := ix.tables[tableID]
	if tp == nil {
		return []string{}
	}
	out := make([]string, len(tp.order))
	copy(out, tp.order)
	return out
}

// Tables returns the sorted list of known table ids (stable snapshot).
func (ix *Indexer) Tables() []string {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	out := make([]string, 0, len(ix.tables))
	for id := range ix.tables { // bounded by len(tables)
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// Rebuild deterministically reconstructs the ordered txid list for tableID from
// an arbitrary record stream, WITHOUT any indexer state. This is the function a
// client uses to verify the projection independently (P2, REQ-NET-007): given
// the same records in the same order, every client computes the same result.
// Records for other tables are ignored; duplicates keep first-seen position.
func Rebuild(tableID string, records []Record) []string {
	order := make([]string, 0, len(records))
	seen := make(map[string]struct{}, len(records))
	for _, rec := range records { // bounded by len(records)
		if rec.TableID != tableID || rec.Txid == "" {
			continue
		}
		if _, dup := seen[rec.Txid]; dup {
			continue
		}
		seen[rec.Txid] = struct{}{}
		order = append(order, rec.Txid)
	}
	return order
}
