/**
 * NetworkedTableClient（app §A7，core §8）——在 relay 之上运行一手真实的多人牌局：
 * 每个玩家通过牌桌作用域的通道（Tier B）交换其熵 commit/reveal（core §4.1）及其下注动作，
 * 并通过确定性引擎在本地派生状态。两个诚实的客户端在给定相同有效动作集合时，
 * 会收敛到逐字节一致的状态（跨客户端一致性，P2 / REQ-TEST-002）。relay 始终仅作传输用途
 * （REQ-NET-001）。
 *
 * 浏览器安全：使用可移植的 sha256（不依赖 node:crypto）。这里的分布式洗牌是对各方约定的熵进行
 * commit-reveal 组合（INV-CT-1）；链上逐牌的密码学（组合密钥、公平博弈）属于 SDK/Node 路径。
 */

import {
  type Action,
  type LegalActions,
  type Ruleset,
  type Card,
  sha256,
  bytesToHex,
  hexToBytes,
  ByteWriter,
} from '@bsv-poker/protocol-types';
import { createHoldem, type HoldemState } from '@bsv-poker/game-holdem';
import type { RelayClient } from './network.ts';

export interface NetworkedSeat {
  readonly seat: number;
  readonly stack: number;
}

export type Strategy = (legal: LegalActions, seat: number, state: HoldemState) => Action;

interface Envelope {
  t: 'commit' | 'reveal' | 'action';
  seat: number;
  c?: string;
  r?: string;
  kind?: Action['kind'];
  amount?: number;
}

/** 确定性的带 seed 的 Fisher–Yates（counter-mode 可移植 sha256）——在每个客户端上都相同。 */
function seededShuffle(seed: Uint8Array, n: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  let counter = 0;
  let pool: number[] = [];
  const draw = (): number => {
    if (pool.length === 0) {
      const w = new ByteWriter();
      for (const b of seed) w.u8(b);
      w.u32(counter++);
      const h = sha256(w.toBytes());
      for (let i = 0; i + 4 <= h.length; i += 4) {
        pool.push(((h[i]! << 24) | (h[i + 1]! << 16) | (h[i + 2]! << 8) | h[i + 3]!) >>> 0);
      }
    }
    return pool.shift()!;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = draw() % (i + 1);
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  return perm;
}

export class NetworkedTableClient {
  private readonly relay: RelayClient;
  private readonly tableId: string;
  private readonly mySeat: number;
  private readonly seats: NetworkedSeat[];
  private readonly ruleset: Ruleset;
  private readonly entropy: Uint8Array;
  private readonly inbox: Envelope[] = [];
  private unsub: (() => void) | null = null;

  constructor(opts: {
    relay: RelayClient;
    tableId: string;
    mySeat: number;
    seats: NetworkedSeat[];
    ruleset: Ruleset;
    entropy: Uint8Array;
  }) {
    this.relay = opts.relay;
    this.tableId = opts.tableId;
    this.mySeat = opts.mySeat;
    this.seats = [...opts.seats].sort((a, b) => a.seat - b.seat);
    this.ruleset = opts.ruleset;
    this.entropy = opts.entropy;
  }

  private async publish(env: Envelope): Promise<void> {
    await this.relay.publish(this.tableId, new TextEncoder().encode(JSON.stringify(env)));
  }

  private received(pred: (e: Envelope) => boolean): Envelope | undefined {
    return this.inbox.find(pred);
  }

  private peerActions(seat: number): Envelope[] {
    return this.inbox.filter((e) => e.t === 'action' && e.seat === seat);
  }

  private async awaitCond(done: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!done()) {
      if (Date.now() > deadline) throw new Error('timeout waiting for a table message');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** 运行一整手牌直至完成；返回最终状态哈希（用于收敛性检查）。 */
  async runHand(strategy: Strategy): Promise<{ state: HoldemState; stateHash: string }> {
    this.unsub = this.relay.subscribe(this.tableId, (text) => {
      try {
        this.inbox.push(JSON.parse(text) as Envelope);
      } catch {
        /* 忽略非 JSON 的保活消息 */
      }
    });
    try {
      // 1) 熵 commit/reveal 握手。在 reveal 阶段也持续重发 commit，
      //    这样晚订阅的对端仍能收到它（玩家不能仅仅因为自己已经拿到所有人的
      //    commit 就停止广播自己的 commit）。
      const commitEnv: Envelope = { t: 'commit', seat: this.mySeat, c: bytesToHex(sha256(this.entropy)) };
      const revealEnv: Envelope = { t: 'reveal', seat: this.mySeat, r: bytesToHex(this.entropy) };
      const allCommits = (): boolean =>
        this.seats.every((s) => this.received((e) => e.t === 'commit' && e.seat === s.seat));
      const allReveals = (): boolean =>
        this.seats.every((s) => this.received((e) => e.t === 'reveal' && e.seat === s.seat));
      await this.gossip([commitEnv], allCommits);
      await this.gossip([commitEnv, revealEnv], allReveals);

      // 2) 用 commit 验证 reveal，派生共享牌组（按座位顺序排列的熵）。
      const entropies: Uint8Array[] = [];
      for (const s of this.seats) {
        const commit = this.received((e) => e.t === 'commit' && e.seat === s.seat)!;
        const reveal = this.received((e) => e.t === 'reveal' && e.seat === s.seat)!;
        const r = hexToBytes(reveal.r!);
        if (bytesToHex(sha256(r)) !== commit.c) throw new Error(`bad reveal for seat ${s.seat}`);
        entropies.push(r);
      }
      const w = new ByteWriter();
      for (const e of entropies) for (const b of e) w.u8(b);
      const deck: Card[] = seededShuffle(sha256(w.toBytes()), 52);

      // 3) 进行牌局：在轮到自己时行动（apply + publish）；按到达顺序应用通道中
      //    各对端的动作（每个对端座位一个游标）。
      const m = createHoldem({ deck });
      let state = m.init(this.ruleset, this.seats.map((s) => ({ seat: s.seat, stack: s.stack })));
      const cursor = new Map<number, number>(); // 对端座位 -> 已应用的其动作数量
      while (!state.handComplete) {
        const toAct = state.betting.toAct;
        if (toAct === null) break; // 引擎已自动推进到终止/非下注状态
        if (toAct === this.mySeat) {
          const legal = m.getLegalActions(state, this.mySeat);
          const action = strategy(legal, this.mySeat, state);
          state = m.apply(state, action);
          await this.publish({ t: 'action', seat: this.mySeat, kind: action.kind, amount: action.amount });
        } else {
          const seen = cursor.get(toAct) ?? 0;
          await this.awaitCond(() => this.peerActions(toAct).length > seen, 10000);
          const env = this.peerActions(toAct)[seen]!;
          cursor.set(toAct, seen + 1);
          state = m.apply(state, { kind: env.kind!, seat: toAct, amount: env.amount ?? 0 });
        }
      }
      return { state, stateHash: m.stateHash(state) };
    } finally {
      this.unsub?.();
    }
  }

  /** 发布 `env` 并每 300ms 重发一次，直到 `done()`（可抵御订阅加入竞态）。 */
  private async gossip(envs: Envelope[], done: () => boolean, timeoutMs = 30000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (const e of envs) await this.publish(e);
    while (!done()) {
      if (Date.now() > deadline) throw new Error('handshake timeout');
      await new Promise((r) => setTimeout(r, 300));
      if (!done()) for (const e of envs) await this.publish(e);
    }
  }
}

