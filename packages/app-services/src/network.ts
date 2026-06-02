/**
 * 网络客户端（app §A7，core §8）——连接管理器到 relay（仅作传输/索引，绝非真相来源）
 * 与 indexer（每张牌桌的 tx 投影）的传输层。使用全局 `fetch`（Node 24 + 浏览器）。
 * relay/indexer 将载荷视为不透明的；客户端通过从有效 tx 集合重新派生状态来掌握真相
 * （REQ-NET-001，P3）。
 *
 * 双路径发送（REQ-NET-003）：一个动作既作为 tx 记录发往 indexer/node（权威），
 * 也通过 relay 通道发往牌桌对端（速度）。速度路径绝不会覆盖权威路径。
 */

export interface PresenceEntry {
  playerId: string;
  addr: string;
}
export interface TableInfo {
  id: string;
  name: string;
  members: number;
}
export interface TxRecord {
  txid: string;
  class: string;
  tableId: string;
  /** 不透明字节（base64）——indexer 从不解析游戏逻辑。 */
  raw?: string;
}

type FetchFn = typeof fetch;

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Tier-A 发现 + Tier-B 不透明扇出（core §8.2）。 */
export class RelayClient {
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  constructor(base: string, fetchFn: FetchFn = fetch) {
    this.base = base;
    this.fetchFn = fetchFn;
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.base}/healthz`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async heartbeat(playerId: string, addr: string): Promise<void> {
    await asJson(
      await this.fetchFn(`${this.base}/presence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, addr }),
      }),
    );
  }

  async listPresence(): Promise<PresenceEntry[]> {
    return asJson(await this.fetchFn(`${this.base}/presence`));
  }

  async createTable(id: string, name: string): Promise<TableInfo> {
    return asJson(
      await this.fetchFn(`${this.base}/tables`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name }),
      }),
    );
  }

  async listTables(): Promise<TableInfo[]> {
    return asJson(await this.fetchFn(`${this.base}/tables`));
  }

  /**
   * Tier-B 订阅：将不透明的牌桌对象（SSE `data: <json>` 帧）流式传给 `onEvent`。
   * 返回一个取消订阅函数。relay 从不解释这些对象（REQ-NET-001）。
   */
  subscribe(tableId: string, onEvent: (text: string) => void): () => void {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await this.fetchFn(`${this.base}/tables/${tableId}/subscribe`, {
          signal: ac.signal,
          headers: { accept: 'text/event-stream' },
        });
        if (!res.ok || !res.body) return;
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, nl);
            buf = buf.slice(nl + 2);
            for (const line of frame.split('\n')) {
              if (line.startsWith('data: ')) onEvent(line.slice(6));
            }
          }
        }
      } catch {
        /* 已中止或流已关闭 */
      }
    })();
    return () => ac.abort();
  }

  /** 速度路径：向牌桌通道发布一个不透明对象；返回投递数量。 */
  async publish(tableId: string, object: Uint8Array): Promise<number> {
    const r = await asJson<{ delivered: number }>(
      await this.fetchFn(`${this.base}/tables/${tableId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: object,
      }),
    );
    return r.delivered;
  }
}

/** 每张牌桌的 tx 投影（core §8.4）。该投影可由任何客户端重建（P2）。 */
export class IndexerClient {
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  constructor(base: string, fetchFn: FetchFn = fetch) {
    this.base = base;
    this.fetchFn = fetchFn;
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.base}/healthz`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** 权威路径：摄入一条 tx 记录；返回它是否为新增（按 txid 去重）。 */
  async ingest(rec: TxRecord): Promise<boolean> {
    const r = await asJson<{ added: boolean }>(
      await this.fetchFn(`${this.base}/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rec),
      }),
    );
    return r.added;
  }

  /** 某张牌桌的有序 txid 投影（确定性的；REQ-NET-006/007）。 */
  async table(tableId: string): Promise<string[]> {
    const r = await asJson<{ tableId: string; txids: string[] }>(
      await this.fetchFn(`${this.base}/table/${tableId}`),
    );
    return r.txids;
  }

  /** 完整的有序记录（转录）——用于重连/重建（REQ-NET-007）。 */
  async records(tableId: string): Promise<TxRecord[]> {
    const r = await asJson<{ tableId: string; records: TxRecord[] }>(
      await this.fetchFn(`${this.base}/table/${tableId}/records`),
    );
    return r.records ?? [];
  }
}
