// 中继的 HTTP + SSE 传输层（仅用标准库，零外部依赖）。
//
// REQ-NET-001（core §8.1）：仅作传输/索引，绝非事实来源。
// REQ-NET-002（core §8.2）：Tier A（在线状态/牌桌）+ Tier B（扇出）API。
// app §A7.7：连接管理器可以在不改动 UI 的情况下将中继发现替换为对等层，
// 因此这里的线缆接口刻意保持最小化。
//
// Tier B 投递在 net/http 上使用 Server-Sent Events —— 一种标准库流式
// 通道 —— 而非依赖 WebSocket，从而使该模块保持无依赖。
package relay

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Server 将各注册表接线到 HTTP 处理器。
type Server struct {
	Presence *PresenceRegistry
	Tables   *TableRegistry
	mux      *http.ServeMux
}

// NewServer 构造一个带有全新注册表的中继服务器。
// ttl 是在线状态心跳的过期窗口。
func NewServer(ttl time.Duration) *Server {
	s := &Server{
		Presence: NewPresenceRegistry(ttl),
		Tables:   NewTableRegistry(),
	}
	s.routes()
	return s
}

// Handler 在 CORS 之后暴露已配置的 mux（同时也使 Server 成为 http.Handler）。
func (s *Server) Handler() http.Handler { return withCORS(s.mux) }

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { withCORS(s.mux).ServeHTTP(w, r) }

// withCORS 允许浏览器 web 客户端（不同来源）通过
// fetch/SSE 访问中继（app §A4）。中继只承载不透明的传输对象且绝非事实
// 来源（REQ-NET-001），因此对该传输层而言宽松的跨域策略是可接受的。
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) routes() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)

	// Tier A：在线状态（发现）。
	mux.HandleFunc("POST /presence", s.handleHeartbeat)
	mux.HandleFunc("DELETE /presence/{id}", s.handleLeave)
	mux.HandleFunc("GET /presence", s.handleListPresence)

	// Tier A：牌桌目录。
	mux.HandleFunc("POST /tables", s.handleCreateTable)
	mux.HandleFunc("GET /tables", s.handleListTables)

	// Tier B：以牌桌为范围的不透明对象中继。
	mux.HandleFunc("POST /tables/{id}/publish", s.handlePublish)
	mux.HandleFunc("GET /tables/{id}/subscribe", s.handleSubscribe)

	s.mux = mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	// 此处的编码错误在响应进行到一半时不可恢复；仅尽力而为。
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// REQ-NET-001：/healthz 是监管进程的存活探针（app §A3.2）。
func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type heartbeatReq struct {
	PlayerID string `json:"playerId"`
	Addr     string `json:"addr"`
}

func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	var req heartbeatReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := s.Presence.Heartbeat(req.PlayerID, req.Addr); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleLeave(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, ErrEmptyID.Error())
		return
	}
	s.Presence.Remove(id)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleListPresence(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Presence.List())
}

type createTableReq struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Server) handleCreateTable(w http.ResponseWriter, r *http.Request) {
	var req createTableReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	t, err := s.Tables.Create(req.ID, req.Name)
	if err != nil {
		code := http.StatusBadRequest
		if err == ErrTableExists {
			code = http.StatusConflict
		}
		writeErr(w, code, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, TableInfo{ID: t.ID, Name: t.Name, Members: t.SubscriberCount()})
}

func (s *Server) handleListTables(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Tables.List())
}

// handlePublish 将一个不透明的请求体转发给该牌桌的所有订阅者（Tier B）。
// REQ-NET-001：该请求体绝不会被解析为游戏逻辑；它仅以字节形式
// 被存储/转发。
func (s *Server) handlePublish(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t, err := s.Tables.Get(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 上限：每个对象 1 MiB
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read error")
		return
	}
	delivered := t.Publish(body)
	writeJSON(w, http.StatusOK, map[string]int{"delivered": delivered})
}

// handleSubscribe 通过 SSE 将不透明的牌桌对象流式发送给客户端，直到
// 客户端断开连接（Tier B 扇出）。每个对象都是不经 base64 的原始字节，
// 封装为一个 SSE "data:" 事件；中继不会解读它们。
func (s *Server) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, unsub, err := s.Tables.Join(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	defer unsub()

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ctx := r.Context()
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	for { // 按设计无界：一个实时流式连接，由 ctx.Done 把关。
		select {
		case <-ctx.Done():
			return
		case <-keepalive.C:
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case msg, open := <-ch:
			if !open {
				return
			}
			// SSE 帧：一个以原始数据形式承载不透明对象的事件。
			if _, err := fmt.Fprintf(w, "data: %s\n\n", msg); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// RunSweeper 在一个有界的 ticker 上运行在线状态过期清扫，直到 stop 被
// 关闭（app §A7.2 心跳过期）。意图在一个 goroutine 中启动。
func (s *Server) RunSweeper(interval time.Duration, stop <-chan struct{}) {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			s.Presence.Sweep()
		}
	}
}
