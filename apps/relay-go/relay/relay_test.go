// 中继的测试：在线状态注册/过期、牌桌创建/加入/列表、
// Tier-B publish->subscribe 扇出，以及 /healthz。
//
// REQ-NET-001/002（core §8.1/§8.2）：仅验证传输行为；没有测试
// 断言任何游戏裁决，因为中继不执行任何裁决。
package relay

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestPresenceRegisterAndList(t *testing.T) {
	r := NewPresenceRegistry(time.Minute)
	if err := r.Heartbeat("alice", "addr-a"); err != nil {
		t.Fatalf("heartbeat alice: %v", err)
	}
	if err := r.Heartbeat("bob", "addr-b"); err != nil {
		t.Fatalf("heartbeat bob: %v", err)
	}
	if got := r.Len(); got != 2 {
		t.Fatalf("len = %d, want 2", got)
	}
	list := r.List()
	if len(list) != 2 || list[0].PlayerID != "alice" || list[1].PlayerID != "bob" {
		t.Fatalf("list not sorted/complete: %+v", list)
	}
	if err := r.Heartbeat("", "x"); err != ErrEmptyID {
		t.Fatalf("empty id err = %v, want ErrEmptyID", err)
	}
}

func TestPresenceExpiry(t *testing.T) {
	r := NewPresenceRegistry(10 * time.Second)
	base := time.Unix(1000, 0)
	r.now = func() time.Time { return base }
	if err := r.Heartbeat("alice", "a"); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	// 将时钟推进到超过 TTL。
	r.now = func() time.Time { return base.Add(11 * time.Second) }
	if removed := r.Sweep(); removed != 1 {
		t.Fatalf("sweep removed %d, want 1", removed)
	}
	if got := r.Len(); got != 0 {
		t.Fatalf("len after expiry = %d, want 0", got)
	}
}

func TestPresenceHeartbeatPreventsExpiry(t *testing.T) {
	r := NewPresenceRegistry(10 * time.Second)
	base := time.Unix(1000, 0)
	r.now = func() time.Time { return base }
	_ = r.Heartbeat("alice", "a")
	// 在 TTL 过期前刚好刷新。
	r.now = func() time.Time { return base.Add(9 * time.Second) }
	_ = r.Heartbeat("alice", "a")
	// 现在在 original+11s 处清扫：相对于刷新后的时间戳仍然新鲜。
	r.now = func() time.Time { return base.Add(11 * time.Second) }
	if removed := r.Sweep(); removed != 0 {
		t.Fatalf("sweep removed %d, want 0 (refreshed)", removed)
	}
}

func TestTableCreateJoinList(t *testing.T) {
	reg := NewTableRegistry()
	if _, err := reg.Create("t1", "Heads-Up NL"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := reg.Create("t1", "dup"); err != ErrTableExists {
		t.Fatalf("dup create err = %v, want ErrTableExists", err)
	}
	if _, err := reg.Create("t2", "Razz"); err != nil {
		t.Fatalf("create t2: %v", err)
	}
	list := reg.List()
	if len(list) != 2 || list[0].ID != "t1" || list[1].ID != "t2" {
		t.Fatalf("list = %+v, want t1,t2 sorted", list)
	}
	_, unsub, err := reg.Join("t1")
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	defer unsub()
	list = reg.List()
	if list[0].Members != 1 {
		t.Fatalf("t1 members = %d, want 1 after join", list[0].Members)
	}
	if _, _, err := reg.Join("nope"); err != ErrNoTable {
		t.Fatalf("join unknown err = %v, want ErrNoTable", err)
	}
}

// TestFanoutDeliversToAllSubscribers 是核心的 Tier-B 保证：一次 publish
// 会到达每一个订阅者（REQ-NET-002）。
func TestFanoutDeliversToAllSubscribers(t *testing.T) {
	reg := NewTableRegistry()
	if _, err := reg.Create("t1", "table"); err != nil {
		t.Fatalf("create: %v", err)
	}
	const n = 5
	chans := make([]<-chan []byte, n)
	unsubs := make([]func(), n)
	for i := 0; i < n; i++ {
		ch, unsub, err := reg.Join("t1")
		if err != nil {
			t.Fatalf("join %d: %v", i, err)
		}
		chans[i] = ch
		unsubs[i] = unsub
	}
	defer func() {
		for _, u := range unsubs {
			u()
		}
	}()

	tbl, _ := reg.Get("t1")
	payload := []byte("opaque-object-bytes")
	if delivered := tbl.Publish(payload); delivered != n {
		t.Fatalf("delivered = %d, want %d", delivered, n)
	}

	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			select {
			case got := <-chans[i]:
				if string(got) != string(payload) {
					t.Errorf("sub %d got %q, want %q", i, got, payload)
				}
			case <-time.After(2 * time.Second):
				t.Errorf("sub %d timed out", i)
			}
		}(i)
	}
	wg.Wait()
}

func TestPublishCopiesBuffer(t *testing.T) {
	reg := NewTableRegistry()
	_, _ = reg.Create("t1", "table")
	ch, unsub, _ := reg.Join("t1")
	defer unsub()
	tbl, _ := reg.Get("t1")
	buf := []byte("abc")
	tbl.Publish(buf)
	buf[0] = 'z' // 在 publish 之后修改调用方的缓冲区
	got := <-ch
	if string(got) != "abc" {
		t.Fatalf("delivered %q, want abc (buffer must be copied)", got)
	}
}

func TestHealthz(t *testing.T) {
	s := NewServer(time.Minute)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("status field = %q, want ok", body["status"])
	}
}

func TestHTTPTableLifecycle(t *testing.T) {
	s := NewServer(time.Minute)

	// 通过 HTTP 创建一个牌桌。
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/tables", jsonBody(`{"id":"t1","name":"NL"}`))
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", rec.Code)
	}

	// 列出牌桌。
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/tables", nil)
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	var tables []TableInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &tables); err != nil {
		t.Fatalf("decode tables: %v", err)
	}
	if len(tables) != 1 || tables[0].ID != "t1" {
		t.Fatalf("tables = %+v", tables)
	}

	// 通过 HTTP 发送在线状态心跳。
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/presence", jsonBody(`{"playerId":"alice","addr":"a"}`))
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("presence status = %d", rec.Code)
	}
	if s.Presence.Len() != 1 {
		t.Fatalf("presence len = %d, want 1", s.Presence.Len())
	}
}
