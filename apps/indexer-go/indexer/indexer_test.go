// 索引器的测试：去重、确定性排序、Rebuild 等价性，
// 以及 /healthz + /table/{id}。
//
// REQ-NET-001/004（core §8.1/§8.4）：仅断言投影行为；
// 索引器不做任何裁决。
package indexer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestIngestDedup(t *testing.T) {
	ix := New()
	added, err := ix.Ingest(Record{Txid: "a", TableID: "t1"})
	if err != nil || !added {
		t.Fatalf("first ingest added=%v err=%v", added, err)
	}
	added, err = ix.Ingest(Record{Txid: "a", TableID: "t1"})
	if err != nil || added {
		t.Fatalf("dup ingest added=%v err=%v, want added=false", added, err)
	}
	got := ix.Table("t1")
	if !reflect.DeepEqual(got, []string{"a"}) {
		t.Fatalf("table = %v, want [a]", got)
	}
}

func TestDeterministicOrdering(t *testing.T) {
	ix := New()
	for _, tx := range []string{"c", "a", "b", "a", "c"} {
		if _, err := ix.Ingest(Record{Txid: tx, TableID: "t1"}); err != nil {
			t.Fatalf("ingest %s: %v", tx, err)
		}
	}
	got := ix.Table("t1")
	want := []string{"c", "a", "b"} // 首次见到的插入顺序，重复项被丢弃
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
}

func TestPerTableIsolation(t *testing.T) {
	ix := New()
	_, _ = ix.Ingest(Record{Txid: "x", TableID: "t1"})
	_, _ = ix.Ingest(Record{Txid: "y", TableID: "t2"})
	_, _ = ix.Ingest(Record{Txid: "x", TableID: "t2"}) // 相同 txid，不同牌桌
	if got := ix.Table("t1"); !reflect.DeepEqual(got, []string{"x"}) {
		t.Fatalf("t1 = %v", got)
	}
	if got := ix.Table("t2"); !reflect.DeepEqual(got, []string{"y", "x"}) {
		t.Fatalf("t2 = %v", got)
	}
	if got := ix.Tables(); !reflect.DeepEqual(got, []string{"t1", "t2"}) {
		t.Fatalf("tables = %v", got)
	}
}

func TestValidation(t *testing.T) {
	ix := New()
	if _, err := ix.Ingest(Record{Txid: "", TableID: "t1"}); err != ErrEmptyTxid {
		t.Fatalf("empty txid err = %v", err)
	}
	if _, err := ix.Ingest(Record{Txid: "a", TableID: ""}); err != ErrEmptyTable {
		t.Fatalf("empty table err = %v", err)
	}
}

func TestUnknownTableEmpty(t *testing.T) {
	ix := New()
	if got := ix.Table("nope"); len(got) != 0 {
		t.Fatalf("unknown table = %v, want empty", got)
	}
}

// TestRebuildMatchesIngest 是确定性契约（P2，REQ-NET-007）：在
// 同一条记录流上运行 Rebuild 的客户端会得到与实时索引器
// 相同的有序集合。
func TestRebuildMatchesIngest(t *testing.T) {
	records := []Record{
		{Txid: "c", TableID: "t1"},
		{Txid: "a", TableID: "t2"},
		{Txid: "a", TableID: "t1"},
		{Txid: "b", TableID: "t1"},
		{Txid: "c", TableID: "t1"}, // 重复
		{Txid: "z", TableID: "t2"},
	}
	ix := New()
	for _, r := range records {
		if _, err := ix.Ingest(r); err != nil {
			t.Fatalf("ingest: %v", err)
		}
	}
	for _, table := range []string{"t1", "t2"} {
		live := ix.Table(table)
		rebuilt := Rebuild(table, records)
		if !reflect.DeepEqual(live, rebuilt) {
			t.Fatalf("table %s: live=%v rebuilt=%v (must be identical)", table, live, rebuilt)
		}
	}
}

func TestHealthz(t *testing.T) {
	s := NewServer()
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("status = %q, want ok", body["status"])
	}
}

func TestHTTPIngestAndTable(t *testing.T) {
	s := NewServer()
	for _, b := range []string{
		`{"txid":"a","class":"action","tableId":"t1"}`,
		`{"txid":"b","class":"action","tableId":"t1"}`,
		`{"txid":"a","class":"action","tableId":"t1"}`, // 重复
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(b))
		s.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("ingest status = %d body=%s", rec.Code, rec.Body.String())
		}
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/table/t1", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("table status = %d", rec.Code)
	}
	var resp tableResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.TableID != "t1" || !reflect.DeepEqual(resp.Txids, []string{"a", "b"}) {
		t.Fatalf("resp = %+v, want t1 [a b]", resp)
	}
}
