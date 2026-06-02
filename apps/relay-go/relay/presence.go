// Package relay 实现 bsv-poker 的第一阶段托管 relay。
//
// REQ-NET-001（core §8.1）：relay 仅负责传输 + 索引，
// 绝不作为事实来源。它加速收敛并扇出不透明的
// 牌桌消息；它从不解析或裁定游戏逻辑。事实来源是
// 经校验的交易图，由每个客户端以相同方式重建（P2）。
//
// 本文件：A 层发现 —— 带心跳/过期清扫的内存玩家在线注册表
// （core §8.2 / REQ-NET-002；app §A7.2）。
package relay

import (
	"errors"
	"sort"
	"sync"
	"time"
)

// 有界循环 / Power-of-Ten 纪律（core §A17）：本 package 中每次清扫和每次
// 扫描都遍历一个有限 map 的快照，因此循环
// 本质上受在线注册表大小的约束。

var (
	// ErrEmptyID 拒绝空白标识符（防御性输入校验）。
	ErrEmptyID = errors.New("relay: empty id")
)

// Presence 是单个玩家的发现记录（A 层）。
type Presence struct {
	PlayerID string `json:"playerId"`
	Addr     string `json:"addr"`     // 不透明的联系提示（relay 不作解释）
	LastSeen int64  `json:"lastSeen"` // 最近一次心跳的 unix 纳秒值
}

// PresenceRegistry 是一个内存中、按心跳过期的在线状态表。
// 它是并发安全的。它不持有任何游戏状态（REQ-NET-001）。
type PresenceRegistry struct {
	mu      sync.Mutex
	ttl     time.Duration
	now     func() time.Time // 可注入的时钟，用于确定性测试
	players map[string]*Presence
}

// NewPresenceRegistry 用给定的心跳 TTL 构造一个注册表。
// 非正的 ttl 会被替换为一个安全默认值，使过期机制永不失效。
func NewPresenceRegistry(ttl time.Duration) *PresenceRegistry {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &PresenceRegistry{
		ttl:     ttl,
		now:     time.Now,
		players: make(map[string]*Presence),
	}
}

// Heartbeat 注册或刷新一个玩家的在线状态（加入/保活）。
func (r *PresenceRegistry) Heartbeat(playerID, addr string) error {
	if playerID == "" {
		return ErrEmptyID
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	p := r.players[playerID]
	if p == nil {
		p = &Presence{PlayerID: playerID}
		r.players[playerID] = p
	}
	p.Addr = addr
	p.LastSeen = r.now().UnixNano()
	return nil
}

// Remove 立即移除一个玩家（显式离开）。
func (r *PresenceRegistry) Remove(playerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.players, playerID)
}

// Sweep 驱逐最近一次心跳早于 TTL 的玩家，并返回
// 被移除的数量。调用方在一个有界的 ticker 上运行它。
func (r *PresenceRegistry) Sweep() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := r.now().Add(-r.ttl).UnixNano()
	removed := 0
	for id, p := range r.players { // 受 len(players) 约束
		if p.LastSeen < cutoff {
			delete(r.players, id)
			removed++
		}
	}
	return removed
}

// List 返回一份稳定的、按字母排序的在线状态快照。
func (r *PresenceRegistry) List() []Presence {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Presence, 0, len(r.players))
	for _, p := range r.players { // 受 len(players) 约束
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PlayerID < out[j].PlayerID })
	return out
}

// Len 报告当前在线状态记录的数量。
func (r *PresenceRegistry) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.players)
}
