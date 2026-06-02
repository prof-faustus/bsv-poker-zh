/**
 * 交互式网络对局客户端（app §A6.5/§A7）——NetworkedTableClient 的人为驱动对应物。
 * 一名真实玩家加入一桌对局，entropy 的 commit/reveal 握手通过中继进行，牌堆由各方
 * 约定的 entropy 派生，然后该玩家在轮到自己时通过 submitAction() 行动，同时其他玩家的
 * 行动通过通道到达。onUpdate 在每次状态变化（轮到你 / 其他玩家已行动 / 此手牌结束）时
 * 触发，以便 UI 进行渲染。浏览器安全。
 *
 * 两个诚实客户端会收敛到逐字节一致的状态（P2 / REQ-TEST-002）；中继仅承担传输职责（P3）。
 */

import {
  type Action,
  type Card,
  type GameState,
  type LegalActions,
  type Ruleset,
  sha256,
  bytesToHex,
  hexToBytes,
  ByteWriter,
} from '@bsv-poker/protocol-types';
import type { RelayClient, IndexerClient } from './network.ts';
import { createGameModule, type GenericGameModule } from './game-registry.ts';
import { deckFromEntropies } from './mp-shuffle.ts';
import { seatedForNextHand } from './table-participants.ts';

export interface TablePlayer {
  readonly seat: number;
  readonly stack: number;
}

interface Envelope {
  t: 'commit' | 'reveal' | 'action';
  seat: number;
  /** 对局内的手牌索引——用于区分每手牌的 commits/reveals/actions。 */
  hand: number;
  c?: string;
  r?: string;
  kind?: Action['kind'];
  amount?: number;
  discard?: readonly number[];
}

export interface ClientUpdate {
  readonly state: GameState;
  readonly mySeat: number;
  readonly yourTurn: boolean;
  readonly legal: LegalActions | null;
  readonly complete: boolean;
}

export class InteractiveNetworkedTableClient {
  private readonly relay: RelayClient;
  private readonly tableId: string;
  private readonly mySeat: number;
  private readonly seats: TablePlayer[];
  private readonly ruleset: Ruleset;
  private readonly entropy: Uint8Array;
  private readonly inbox: Envelope[] = [];
  private unsub: (() => void) | null = null;
  private listeners: Array<(u: ClientUpdate) => void> = [];
  private pendingAction: ((a: Action) => void) | null = null;
  private module: GenericGameModule | null = null;
  private state: GameState | null = null;
  private aborted = false;
  private ingestSeq = 0; // 使每条被摄入记录的 txid 唯一（相同的 check 否则会发生冲突）
  private readonly indexer: IndexerClient | null;

  constructor(opts: {
    relay: RelayClient;
    tableId: string;
    mySeat: number;
    seats: TablePlayer[];
    ruleset: Ruleset;
    entropy: Uint8Array;
    /** 可选的规范路径：每个 envelope 也会在此被摄入，用于 transcript/重连。 */
    indexer?: IndexerClient;
  }) {
    this.relay = opts.relay;
    this.tableId = opts.tableId;
    this.mySeat = opts.mySeat;
    this.seats = [...opts.seats].sort((a, b) => a.seat - b.seat);
    this.ruleset = opts.ruleset;
    this.entropy = opts.entropy;
    this.indexer = opts.indexer ?? null;
  }

  onUpdate(cb: (u: ClientUpdate) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== cb);
    };
  }

  /** 停止一个正在运行的对局（例如玩家离开牌桌）；当前这手牌会先完成。 */
  abort(): void {
    this.aborted = true;
  }

  /** 在轮到本地玩家时提交其行动（否则为 no-op）。 */
  submitAction(a: Action): void {
    const p = this.pendingAction;
    if (p) {
      this.pendingAction = null;
      p(a);
    }
  }

  getState(): GameState | null {
    return this.state;
  }

  stateHash(): string | null {
    return this.module && this.state ? this.module.stateHash(this.state) : null;
  }

  /** 当前需行动的座位：可能是下注回合，否则是非下注的决策回合（例如 Draw 的弃牌）。 */
  private static toAct(s: GameState): number | null {
    return s.betting.toAct ?? s.drawToAct ?? null;
  }

  legalActions(): LegalActions | null {
    if (!this.module || !this.state) return null;
    if (InteractiveNetworkedTableClient.toAct(this.state) !== this.mySeat) return null;
    return this.module.getLegalActions(this.state, this.mySeat);
  }

  private emit(complete = false): void {
    if (!this.state || !this.module) return;
    const yourTurn = !complete && InteractiveNetworkedTableClient.toAct(this.state) === this.mySeat;
    const update: ClientUpdate = {
      state: this.state,
      mySeat: this.mySeat,
      yourTurn,
      legal: yourTurn ? this.module.getLegalActions(this.state, this.mySeat) : null,
      complete,
    };
    for (const l of this.listeners) l(update);
  }

  private async publish(env: Envelope): Promise<void> {
    const json = JSON.stringify(env);
    // 速度路径：中继通道
    await this.relay.publish(this.tableId, new TextEncoder().encode(json));
    // 规范路径：摄入到索引器（按 txid 去重），以便 transcript 可被重建
    if (this.indexer) {
      // 每次出现都唯一：相同的 envelope（例如重复的 check）绝不能被去重掉
      const txid = bytesToHex(sha256(new TextEncoder().encode(`${this.mySeat}:${this.ingestSeq++}:${json}`)));
      try {
        await this.indexer.ingest({ txid, class: env.t, tableId: this.tableId, raw: btoa(json) });
      } catch {
        /* 规范路径尽力而为；本对局中中继通道仍承载着真实数据 */
      }
    }
  }
  private received(pred: (e: Envelope) => boolean): Envelope | undefined {
    return this.inbox.find(pred);
  }
  private peerActions(seat: number, hand: number): Envelope[] {
    return this.inbox.filter((e) => e.t === 'action' && e.seat === seat && e.hand === hand);
  }
  private async awaitCond(done: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!done()) {
      if (Date.now() > deadline) throw new Error('timeout waiting for a table message');
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  /**
   * 每 300ms 重新广播一次 `envs`，直到 `done()`。关键：一个订阅较晚的 peer 必须
   * 仍能收到我更早的 envelope，因此调用方在 reveal 阶段也会持续重发 commit——一个
   * 玩家绝不能仅因为自己已集齐所有 commit 就停止广播它自己的 commit。
   */
  private async gossip(envs: Envelope[], done: () => boolean, timeoutMs = 30000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (const e of envs) await this.publish(e);
    while (!done()) {
      if (Date.now() > deadline) throw new Error('handshake timeout');
      await new Promise((r) => setTimeout(r, 300));
      if (!done()) for (const e of envs) await this.publish(e);
    }
  }

  private subscribe(): void {
    if (this.unsub) return;
    this.unsub = this.relay.subscribe(this.tableId, (text) => {
      try {
        const env = JSON.parse(text) as Envelope;
        if (process.env.MP_DEBUG) console.error(`[icx seat${this.mySeat}] rx ${env.t} h${env.hand} seat=${env.seat}`);
        this.inbox.push(env);
      } catch {
        /* 心跳保活（keepalive） */
      }
    });
  }

  /** 在 `seats` 上以 `buttonIndex` 进行 `handNo` 这一手牌，使用 `entropy` 进行洗牌。 */
  private async playOneHand(
    handNo: number,
    seats: TablePlayer[],
    buttonIndex: number,
    entropy: Uint8Array,
  ): Promise<GameState> {
    const commitEnv: Envelope = { t: 'commit', seat: this.mySeat, hand: handNo, c: bytesToHex(sha256(entropy)) };
    const revealEnv: Envelope = { t: 'reveal', seat: this.mySeat, hand: handNo, r: bytesToHex(entropy) };
    const has = (t: 'commit' | 'reveal', seat: number): boolean =>
      !!this.received((e) => e.t === t && e.seat === seat && e.hand === handNo);
    await this.gossip([commitEnv], () => seats.every((s) => has('commit', s.seat)));
    await this.gossip([commitEnv, revealEnv], () => seats.every((s) => has('reveal', s.seat)));

    const entropies: Uint8Array[] = [];
    for (const s of seats) {
      const commit = this.received((e) => e.t === 'commit' && e.seat === s.seat && e.hand === handNo)!;
      const reveal = this.received((e) => e.t === 'reveal' && e.seat === s.seat && e.hand === handNo)!;
      const r = hexToBytes(reveal.r!);
      if (bytesToHex(sha256(r)) !== commit.c) throw new Error(`bad reveal for seat ${s.seat}`);
      entropies.push(r);
    }
    const deck: Card[] = deckFromEntropies(entropies);

    this.module = createGameModule(this.ruleset.variant, deck, buttonIndex);
    this.state = this.module.init(this.ruleset, seats.map((s) => ({ seat: s.seat, stack: s.stack })));
    this.emit();

    const cursor = new Map<number, number>();
    while (!this.state.handComplete) {
      const toAct = InteractiveNetworkedTableClient.toAct(this.state);
      if (toAct === null) break;
      if (toAct === this.mySeat) {
        const action = await new Promise<Action>((res) => {
          this.pendingAction = res;
          this.emit(); // 轮到你（更新中包含合法行动）
        });
        this.state = this.module.apply(this.state, action);
        await this.publish({
          t: 'action',
          seat: this.mySeat,
          hand: handNo,
          kind: action.kind,
          amount: action.amount,
          ...(action.discard ? { discard: action.discard } : {}),
        });
      } else {
        const seen = cursor.get(toAct) ?? 0;
        await this.awaitCond(() => this.peerActions(toAct, handNo).length > seen, 120000);
        const env = this.peerActions(toAct, handNo)[seen]!;
        cursor.set(toAct, seen + 1);
        this.state = this.module.apply(this.state, {
          kind: env.kind!,
          seat: toAct,
          amount: env.amount ?? 0,
          ...(env.discard ? { discard: env.discard } : {}),
        });
      }
      this.emit();
    }
    this.emit(true);
    return this.state;
  }

  /** 单手牌（订阅 + 在索引 0、按钮 0 进行一手牌）。 */
  async play(): Promise<GameState> {
    this.subscribe();
    try {
      return await this.playOneHand(0, this.seats, 0, this.entropy);
    } finally {
      this.unsub?.();
      this.unsub = null;
    }
  }

  /**
   * 连续牌桌：一手接一手地进行——每手牌使用全新的 entropy（REQ-CRYPTO-010）、延续的
   * 筹码量、轮转的按钮——直到达到 `maxHands`、只剩一名玩家有筹码，或本玩家破产。
   * onUpdate 全程持续触发（state.handNumber 用于区分各手牌）。
   */
  async playSession(opts?: { maxHands?: number }): Promise<void> {
    const maxHands = opts?.maxHands ?? Number.POSITIVE_INFINITY;
    this.subscribe();
    // 按原始座位号维护的实时筹码量，逐手牌延续
    const stacks = new Map<number, number>(this.seats.map((s) => [s.seat, s.stack]));
    let button = 0;
    try {
      for (let hand = 0; hand < maxHands; hand++) {
        if (this.aborted) break;
        // 参与者集合在各手牌之间（重新）计算，并为本手牌冻结（REQ-CRYPTO-011）。
        const participants = seatedForNextHand(this.seats, (seat) => stacks.get(seat) ?? 0);
        if (participants.length < 2) break; // 牌桌无法继续
        if (!participants.some((p) => p.seat === this.mySeat)) break; // 我破产了 → 我出局
        const seats: TablePlayer[] = participants.map((s) => ({ seat: s.seat, stack: stacks.get(s.seat)! }));
        const buttonIndex = button % seats.length;
        // 绑定到手牌索引的全新逐手 entropy（每手牌进行一次新的 N 方洗牌）
        const handEntropy = sha256(concat(this.entropy, u32(hand)));
        const final = await this.playOneHand(hand, seats, buttonIndex, handEntropy);
        for (const s of final.seats) stacks.set(s.seat, s.stack);
        button += 1;
      }
    } finally {
      this.unsub?.();
      this.unsub = null;
    }
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
function u32(n: number): Uint8Array {
  const w = new ByteWriter();
  w.u32(n);
  return w.toBytes();
}
