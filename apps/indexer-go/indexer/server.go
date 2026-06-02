// 索引器的 HTTP 传输层（仅用标准库，零外部依赖）。
//
// REQ-NET-004（core §8.4）：提供以牌桌为单位的投影服务。
// REQ-NET-001（core §8.1）：所提供的列表是一个便利投影（一个
// 需由客户端对照规范化 tx 图加以确认的提示），绝非事实。
package indexer

import (
	"encoding/json"
	"io"
	"net/http"
)

// Server 将一个 Indexer 接线到 HTTP 处理器。
type Server struct {
	ix  *Indexer
	mux *http.ServeMux
}

// NewServer 在一个全新的 Indexer 之上构造一个索引器 HTTP 服务器。
func NewServer() *Server {
	s := &Server{ix: New()}
	s.routes()
	return s
}

// Index 暴露底层的索引器（用于进程内摄入/测试）。
func (s *Server) Index() *Indexer { return s.ix }

// Handler 返回已配置的 mux。
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

// handleIngest 接受一条不透明的协议交易记录（REQ-NET-004）。
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

// tableResponse 是以牌桌为单位的投影视图。
type tableResponse struct {
	TableID string   `json:"tableId"`
	Txids   []string `json:"txids"`
}

// handleTable 返回某一牌桌 id 的有序、去重后的 txid 列表。
// REQ-NET-001：这是一个便利投影，不是事实来源。
func (s *Server) handleTable(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, ErrEmptyTable.Error())
		return
	}
	writeJSON(w, http.StatusOK, tableResponse{TableID: id, Txids: s.ix.Table(id)})
}

// handleRecords 返回完整的有序记录（即记录全文），以便（重）连接的客户端
// 能从有效的 tx 集合重建当前状态（REQ-NET-007、REQ-DATA-002/003）。
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
