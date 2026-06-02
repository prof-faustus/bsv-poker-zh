// HTTP transport for the indexer (stdlib only, zero external deps).
//
// REQ-NET-004 (core §8.4): serves per-table projections.
// REQ-NET-001 (core §8.1): the served list is a convenience projection (a hint
// to be confirmed by the client against the canonical tx graph), never truth.
package indexer

import (
	"encoding/json"
	"io"
	"net/http"
)

// Server wires an Indexer to HTTP handlers.
type Server struct {
	ix  *Indexer
	mux *http.ServeMux
}

// NewServer constructs an indexer HTTP server over a fresh Indexer.
func NewServer() *Server {
	s := &Server{ix: New()}
	s.routes()
	return s
}

// Index exposes the underlying indexer (for in-process ingestion/tests).
func (s *Server) Index() *Indexer { return s.ix }

// Handler returns the configured mux.
func (s *Server) Handler() http.Handler { return s.mux }

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func (s *Server) routes() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("POST /ingest", s.handleIngest)
	mux.HandleFunc("GET /table/{id}", s.handleTable)
	mux.HandleFunc("GET /table/{id}/records", s.handleRecords)
	mux.HandleFunc("GET /tables", s.handleTables)
	s.mux = mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleIngest accepts an opaque protocol-transaction record (REQ-NET-004).
func (s *Server) handleIngest(w http.ResponseWriter, r *http.Request) {
	var rec Record
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&rec); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	added, err := s.ix.Ingest(rec)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"added": added})
}

// tableResponse is the per-table projection view.
type tableResponse struct {
	TableID string   `json:"tableId"`
	Txids   []string `json:"txids"`
}

// handleTable returns the ordered, de-duplicated txid list for a table id.
// REQ-NET-001: this is a convenience projection, not the source of truth.
func (s *Server) handleTable(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, ErrEmptyTable.Error())
		return
	}
	writeJSON(w, http.StatusOK, tableResponse{TableID: id, Txids: s.ix.Table(id)})
}

// handleRecords returns the FULL ordered records (the transcript) so a (re)connecting client
// can rebuild current state from the valid tx set (REQ-NET-007, REQ-DATA-002/003).
func (s *Server) handleRecords(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, ErrEmptyTable.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tableId": id, "records": s.ix.Records(id)})
}

func (s *Server) handleTables(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.ix.Tables())
}
