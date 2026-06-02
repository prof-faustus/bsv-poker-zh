/**
 * 真实的 BSV 节点客户端（core §2.2 BS / §10.2，D6）—— 将平台的链后端绑定到
 * `bonded-subsat-channel` 参考实现（prof-faustus 仓库）中自带的**内嵌 BSV regtest 节点**。
 * 它使用该节点守护进程的以换行符分隔的 JSON-over-TCP 协议
 * （cmd: ping / status / node.height / node.generate / shutdown）通信。
 *
 * 仅限 Node 端（使用 node:net）；通过 `@bsv-poker/adapters/real-node` 子路径导出，从而绝不会
 * 进入浏览器打包产物。这是一致性/集成测试所针对的真实适配器（REQ-DEP-004）—— 节点运行在宿主机上
 * （仅 regtest），由此处驱动。
 */

import { createConnection } from 'node:net';

export interface NodeResponse {
  ok: boolean;
  [k: string]: unknown;
}

export class RealBsvNode {
  private readonly host: string;
  private readonly port: number;
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  private call(req: Record<string, unknown>, timeoutMs = 3000): Promise<NodeResponse> {
    return new Promise((resolve, reject) => {
      const sock = createConnection({ host: this.host, port: this.port });
      let buf = '';
      const done = (err: Error | null, val?: NodeResponse): void => {
        sock.destroy();
        if (err) reject(err);
        else resolve(val!);
      };
      sock.setTimeout(timeoutMs, () => done(new Error('node call timeout')));
      sock.on('error', (e) => done(e));
      sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const nl = buf.indexOf('\n');
        if (nl >= 0) {
          try {
            done(null, JSON.parse(buf.slice(0, nl)) as NodeResponse);
          } catch (e) {
            done(e as Error);
          }
        }
      });
    });
  }

  async ping(): Promise<boolean> {
    const r = await this.call({ cmd: 'ping' });
    return r.ok === true && r.pong === true;
  }

  async height(): Promise<number> {
    const r = await this.call({ cmd: 'node.height' });
    if (!r.ok) throw new Error(`node.height failed: ${JSON.stringify(r)}`);
    return r.height as number;
  }

  /** 挖出一个 regtest 区块并将奖励支付给 `payoutPubHex`；同时返回 coinbase 的 txid。 */
  async generateBlock(
    payoutPubHex: string,
  ): Promise<{ blockHash: string; txs: number; coinbaseTxid: string }> {
    const r = await this.call({ cmd: 'node.generate', payout_pk_hex: payoutPubHex });
    if (!r.ok) throw new Error(`node.generate failed: ${JSON.stringify(r)}`);
    return { blockHash: r.block_hash as string, txs: r.txs as number, coinbaseTxid: (r.coinbase_txid as string) ?? '' };
  }

  /** 提交一笔原始（已签名）交易；节点通过其真实的 Script 解释器对其进行验证。 */
  async submitTx(rawTxHex: string): Promise<{ ok: boolean; reason: string; txid: string }> {
    const r = await this.call({ cmd: 'node.submit', raw_tx_hex: rawTxHex });
    return { ok: r.ok === true, reason: (r.reason as string) ?? '', txid: (r.txid as string) ?? '' };
  }

  /** 某个 outpoint 的只读 UTXO 状态（针对真实节点的 REQ-NET-004）。 */
  async outpointStatus(txidHex: string, vout: number): Promise<{ unspent: boolean; value: number }> {
    const r = await this.call({ cmd: 'node.outpoint', txid_hex: txidHex, vout });
    if (!r.ok) throw new Error(`node.outpoint failed: ${JSON.stringify(r)}`);
    return { unspent: r.unspent === true, value: (r.value as number) ?? 0 };
  }

  /** 节点 UTXO 集合的当前大小。 */
  async utxoCount(): Promise<number> {
    const r = await this.call({ cmd: 'node.utxo_count' });
    if (!r.ok) throw new Error(`node.utxo_count failed: ${JSON.stringify(r)}`);
    return r.count as number;
  }

  async status(): Promise<NodeResponse> {
    return this.call({ cmd: 'status' });
  }

  async shutdown(): Promise<void> {
    try {
      await this.call({ cmd: 'shutdown' });
    } catch {
      /* 守护进程在关闭时可能会关闭该套接字 */
    }
  }
}
