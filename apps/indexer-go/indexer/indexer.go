// Package indexer 为协议交易构建以牌桌为单位的投影。
//
// REQ-NET-004（core §8.4）：平台经由 BS.node 摄入不透明的
// 协议交易记录，并构建以牌桌为单位的投影（每个牌桌 id 一份有序 tx
// 列表，按 txid 去重）。
//
// REQ-NET-001（core §8.1，P3）：索引器是一个便利投影，绝非
// 事实来源。事实是已验证的交易图；
// 索引器必须重建出一个完全相同的有序集合，任何客户端都能独立地
// 重建出它（P2，REQ-NET-007）。因此确定性是核心
// 契约：见 Rebuild，任何客户端都可以在同一条记录流上运行它
// 以获得相同的有序 txid 列表。
package indexer

import (
	"errors"
	"sort"
	"sync"
)

var (
	// ErrEmptyTxid 拒绝没有 txid 的记录（防御性校验）。
	ErrEmptyTxid = errors.New("indexer: empty txid")
	// ErrEmptyTable 拒绝没有牌桌 id 的记录。
	ErrEmptyTable = errors.New("indexer: empty table id")
)

// Record 是从 BS.node 摄入的一条不透明协议交易记录。
// 索引器将 Raw 视为不透明字节；它绝不解析游戏逻辑
// （REQ-NET-001）。Class 是生产者赋予的一个不透明标签。
type Record struct {
	Txid    string `json:"txid"`
	Class   string `json:"class"`
	TableID string `json:"tableId"`
	Raw     []byte `json:"raw,omitempty"`
}

// tableProjection 持有某一牌桌的有序、去重后的 tx 集合。
type tableProjection struct {
	order []string            // 按确定性插入顺序排列的 txid
	seen  map[string]struct{} // 去重集合
	recs  map[string]Record   // 按 txid 索引的完整记录（用于记录重建 / 重连）
}

// Indexer 是以牌桌为单位的投影的并发安全集合。
type Indexer struct {
	mu     sync.Mutex
	tables map[string]*tableProjection
}

// New 构造一个空的索引器。
func New() *Indexer {
	return &Indexer{tables: make(map[string]*tableProjection)}
}

// Ingest 将一条记录添加到其所属牌桌的投影中。重复的 txid（按牌桌）
// 会被忽略，保留首次见到的顺序。如果记录是
// 新添加的则返回 true，如果是重复则返回 false。确定性：排序严格按
// 首次见到的插入顺序；重放同一条记录序列会产生
// 完全相同的有序集合（REQ-NET-007）。
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

// Records 返回某一牌桌的完整有序记录（即记录全文），以便任何客户端都能
// 从有效的 tx 集合重建当前状态（REQ-NET-007、REQ-DATA-002/003）。返回的是
// 一份副本；未知牌桌产生一个空切片。
func (ix *Indexer) Records(tableID string) []Record {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	tp := ix.tables[tableID]
	if tp == nil {
		return []Record{}
	}
	out := make([]Record, 0, len(tp.order))
	for _, id := range tp.order { // 受 len(order) 限界
		out = append(out, tp.recs[id])
	}
	return out
}

// Table 返回某一牌桌 id 的有序 txid 列表。返回的是一份副本，使得
// 调用方无法改动内部状态。未知牌桌产生一个空切片。
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

// Tables 返回已知牌桌 id 的排序后列表（稳定快照）。
func (ix *Indexer) Tables() []string {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	out := make([]string, 0, len(ix.tables))
	for id := range ix.tables { // 受 len(tables) 限界
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// Rebuild 在不依赖任何索引器状态的情况下，从一条任意的记录流
// 确定性地为 tableID 重建有序 txid 列表。这是客户端
// 用来独立验证投影的函数（P2，REQ-NET-007）：给定
// 同一批记录、同一顺序，每个客户端都计算出相同的结果。
// 其他牌桌的记录会被忽略；重复项保留首次见到的位置。
func Rebuild(tableID string, records []Record) []string {
	order := make([]string, 0, len(records))
	seen := make(map[string]struct{}, len(records))
	for _, rec := range records { // 受 len(records) 限界
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
