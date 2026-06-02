import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelayClient, IndexerClient } from '../src/network.ts';

/** 一个脚本化的伪 fetch，记录调用并返回预设的 JSON。 */
function fakeFetch(routes: Record<string, unknown>): {
  fn: typeof fetch;
  calls: Array<{ url: string; method: string; body: string | undefined }>;
} {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push({
      url: u,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const key = `${init?.method ?? 'GET'} ${new URL(u).pathname}`;
    const payload = routes[key] ?? routes[u] ?? { status: 'ok' };
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      },
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('RelayClient hits the right endpoints with the right bodies (REQ-NET-002)', async () => {
  const { fn, calls } = fakeFetch({
    'POST /presence': { status: 'ok' },
    'POST /tables': { id: 't1', name: 'Table 1', members: 0 },
    'GET /tables': [{ id: 't1', name: 'Table 1', members: 1 }],
    'POST /tables/t1/publish': { delivered: 2 },
  });
  const relay = new RelayClient('http://127.0.0.1:8091', fn);
  await relay.heartbeat('p1', '127.0.0.1:5000');
  const t = await relay.createTable('t1', 'Table 1');
  assert.equal(t.id, 't1');
  const tables = await relay.listTables();
  assert.equal(tables.length, 1);
  const delivered = await relay.publish('t1', Uint8Array.from([1, 2, 3]));
  assert.equal(delivered, 2);

  assert.deepEqual(JSON.parse(calls[0]!.body!), { playerId: 'p1', addr: '127.0.0.1:5000' });
  assert.equal(calls[0]!.url, 'http://127.0.0.1:8091/presence');
  assert.deepEqual(JSON.parse(calls[1]!.body!), { id: 't1', name: 'Table 1' });
  assert.equal(calls.at(-1)!.url, 'http://127.0.0.1:8091/tables/t1/publish');
});

test('IndexerClient ingests records (canonical path) and reads the ordered projection', async () => {
  const { fn, calls } = fakeFetch({
    'POST /ingest': { added: true },
    'GET /table/t1': { tableId: 't1', txids: ['aa', 'bb', 'cc'] },
  });
  const ix = new IndexerClient('http://127.0.0.1:8092', fn);
  const added = await ix.ingest({ txid: 'aa', class: 'Funding', tableId: 't1' });
  assert.equal(added, true);
  const txids = await ix.table('t1');
  assert.deepEqual(txids, ['aa', 'bb', 'cc']); // 确定性的有序投影（REQ-NET-006/007）
  assert.deepEqual(JSON.parse(calls[0]!.body!), { txid: 'aa', class: 'Funding', tableId: 't1' });
});

test('health() returns false when fetch throws (degraded, fail-closed)', async () => {
  const throwing = (async () => {
    throw new Error('refused');
  }) as unknown as typeof fetch;
  const relay = new RelayClient('http://127.0.0.1:9', throwing);
  assert.equal(await relay.health(), false);
});
