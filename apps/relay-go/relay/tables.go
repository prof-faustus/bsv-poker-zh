// Tier A 牌桌目录 + Tier B 以牌桌为范围的不透明扇出。
//
// REQ-NET-002（core §8.2）：Tier A 发现（牌桌创建/加入/列表）以及
// Tier B 游戏对象传播（每牌桌一个通道，Bitmessage 风格）。中继
// 仅存储并转发不透明字节；它不解析、校验或
// 排序任何游戏逻辑（REQ-NET-001，app §A7.3）。
package relay

import (
	"errors"
	"sort"
	"sync"
)

var (
	// ErrTableExists 在创建重复的牌桌 id 时返回。
	ErrTableExists = errors.New("relay: table already exists")
	// ErrNoTable 在对未知牌桌 id 进行操作时返回。
	ErrNoTable = errors.New("relay: no such table")
)

// defaultFanoutBuffer 限制每个订阅者的待处理消息队列，使得慢速
// 订阅者无法无限制地增长内存（Power-of-Ten 有界资源）。
const defaultFanoutBuffer = 256

// Table 是一个 Tier-A 目录条目加上它的 Tier-B 扇出枢纽。
// 中继将每一条发布的消息都视为不透明字节。
type Table struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Members int    `json:"members"`

	mu   sync.Mutex
	seq  uint64
	subs map[uint64]chan []byte
}

func newTable(id, name string) *Table {
	return &Table{
		ID:   id,
		Name: name,
		subs: make(map[uint64]chan []byte),
	}
}

// Subscribe 将一个订阅者注册到该牌桌的不透明对象通道，并
// 返回接收通道以及一个取消订阅的函数。Tier B（REQ-NET-002）。
func (t *Table) Subscribe() (<-chan []byte, func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	id := t.seq
	t.seq++
	ch := make(chan []byte, defaultFanoutBuffer)
	t.subs[id] = ch
	t.Members = len(t.subs)
	unsub := func() {
		t.mu.Lock()
		defer t.mu.Unlock()
		if c, ok := t.subs[id]; ok {
			delete(t.subs, id)
			close(c)
			t.Members = len(t.subs)
		}
	}
	return ch, unsub
}

// Publish 将一条不透明消息扇出给当前每一个订阅者。
// 它返回消息被投递到的订阅者数量。每次投递都会
// 复制一份，因此调用方的缓冲区绝不会被别名引用。如果某个订阅者的
// 有界缓冲区已满，则消息仅对该订阅者被丢弃（中继是
// 尽力而为的速度路径，绝非事实来源 —— REQ-NET-001）；
// 客户端通过规范化的 tx 图进行对账（REQ-NET-007）。
func (t *Table) Publish(msg []byte) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	delivered := 0
	for _, ch := range t.subs { // 受 len(subs) 限界
		cp := make([]byte, len(msg))
		copy(cp, msg)
		select {
		case ch <- cp:
			delivered++
		default:
			// 订阅者背压：在速度路径上丢弃，不阻塞。
		}
	}
	return delivered
}

// SubscriberCount 报告该牌桌的实时订阅者数量。
func (t *Table) SubscriberCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.subs)
}

// TableInfo 是一个牌桌的可 JSON 序列化的目录视图。
type TableInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Members int    `json:"members"`
}

// TableRegistry 是并发安全的牌桌目录（Tier A）。
type TableRegistry struct {
	mu     sync.Mutex
	tables map[string]*Table
}

// NewTableRegistry 构造一个空的牌桌目录。
func NewTableRegistry() *TableRegistry {
	return &TableRegistry{tables: make(map[string]*Table)}
}

// Create 注册一个新牌桌。重复的 id 会被拒绝。
func (r *TableRegistry) Create(id, name string) (*Table, error) {
	if id == "" {
		return nil, ErrEmptyID
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.tables[id]; ok {
		return nil, ErrTableExists
	}
	t := newTable(id, name)
	r.tables[id] = t
	return t, nil
}

// Get 按 id 返回一个牌桌，或返回 ErrNoTable。
func (r *TableRegistry) Get(id string) (*Table, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.tables[id]
	if !ok {
		return nil, ErrNoTable
	}
	return t, nil
}

// Join 将一个客户端订阅到现有牌桌的 Tier-B 通道。在中继层，
// “Join” 恰好就是对不透明扇出的一次订阅（app §A7.3）；座位
// 占用是中继从不跟踪的游戏状态概念（REQ-NET-001）。
func (r *TableRegistry) Join(id string) (<-chan []byte, func(), error) {
	t, err := r.Get(id)
	if err != nil {
		return nil, nil, err
	}
	ch, unsub := t.Subscribe()
	return ch, unsub, nil
}

// List 返回牌桌目录的一个稳定的、按 id 排序的快照。
func (r *TableRegistry) List() []TableInfo {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]TableInfo, 0, len(r.tables))
	for _, t := range r.tables { // 受 len(tables) 限界
		out = append(out, TableInfo{ID: t.ID, Name: t.Name, Members: t.SubscriberCount()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
