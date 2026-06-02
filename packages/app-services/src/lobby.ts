/**
 * 基于中继的大厅 + 等待室（app §A6.3/§A7, core §8.2）——这是真实玩家（而非 bot）发现
 * 并加入一局对战的方式。一名主机用某个配置创建一桌；其他人通过中继的牌桌列表看到它，
 * 并通过在该牌桌通道上宣告自己来加入等待室；当座位坐满时，所有人派生出相同的座位分配
 * （按身份 pubkey 排序）并开始。中继仅承担传输/索引职责（P3）；座位由玩家约定，而非中继决定。
 */

import type { Ruleset, Variant } from '@bsv-poker/protocol-types';
import type { RelayClient } from './network.ts';
import { type TablePlayer } from './interactive-client.ts';

export interface TableMeta {
  readonly name: string;
  readonly variant: Variant;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly startingStack: number;
  readonly maxSeats: number;
  /** Omaha Hi-Lo 分池（Omaha-8, REQ-FSM-007）——仅对 omaha 变体有意义。 */
  readonly hiLo?: boolean;
}

export interface OpenTable {
  readonly id: string;
  readonly meta: TableMeta;
  readonly members: number;
}

export interface SeatedResult {
  readonly mySeat: number;
  readonly seats: TablePlayer[];
  readonly ruleset: Ruleset;
  readonly players: Array<{ id: string; pub: string }>;
}

interface JoinEnvelope {
  t: 'join';
  id: string;
  pub: string;
}

export function rulesetFromMeta(meta: TableMeta): Ruleset {
  // Stud 和 Razz 使用 ante + bring-in；盲注类变体使用小盲/大盲（core §7.3）。
  const bringIn = meta.variant === 'stud' || meta.variant === 'razz';
  return {
    variant: meta.variant,
    bettingStructure: 'NL',
    forcedBetModel: bringIn ? 'ante-bringin' : 'blinds',
    seats: meta.maxSeats,
    blinds: bringIn
      ? { smallBlind: 0, bigBlind: 0, ante: Math.max(1, Math.floor(meta.smallBlind)), bringIn: Math.max(1, Math.floor(meta.smallBlind)) }
      : { smallBlind: meta.smallBlind, bigBlind: meta.bigBlind, ante: 0, bringIn: 0 },
    minBuyIn: meta.startingStack,
    maxBuyIn: meta.startingStack,
    timeouts: { decisionMs: 30000, recoveryMs: 120000 },
    signingMode: 'A',
    currency: 'play-regtest',
    suitTiebreakHouseRule: false,
    hiLo: meta.variant === 'omaha' ? (meta.hiLo ?? false) : false,
  };
}

export class LobbyClient {
  private readonly relay: RelayClient;
  constructor(relay: RelayClient) {
    this.relay = relay;
  }

  /** 主持开一桌新对局；返回该牌桌 id（meta 承载在中继的牌桌名称中）。 */
  async createTable(meta: TableMeta): Promise<string> {
    const id = `tbl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    await this.relay.createTable(id, JSON.stringify(meta));
    return id;
  }

  /** 列出所有开放的牌桌及其已解析的配置。 */
  async listTables(): Promise<OpenTable[]> {
    const out: OpenTable[] = [];
    for (const t of await this.relay.listTables()) {
      try {
        out.push({ id: t.id, meta: JSON.parse(t.name) as TableMeta, members: t.members });
      } catch {
        /* 名称不是我们的 JSON meta 的牌桌——跳过 */
      }
    }
    return out;
  }

  /**
   * 加入某桌的等待室，并在其坐满后 resolve。`onPlayers` 在玩家到达时触发。
   * 返回约定的座位分配（按身份 pubkey 排序）+ ruleset，以及一个 `abort()`。
   */
  joinWaitingRoom(
    tableId: string,
    me: { id: string; pub: string },
    meta: TableMeta,
    onPlayers?: (players: Array<{ id: string; pub: string }>) => void,
  ): { seated: Promise<SeatedResult>; abort: () => void } {
    const joined = new Map<string, { id: string; pub: string }>();
    joined.set(me.pub, me);
    let unsub: (() => void) | null = null;
    let aborted = false;

    const seated = new Promise<SeatedResult>((resolve, reject) => {
      unsub = this.relay.subscribe(tableId, (text) => {
        try {
          const env = JSON.parse(text) as JoinEnvelope;
          if (env.t === 'join' && env.pub) {
            if (!joined.has(env.pub)) {
              joined.set(env.pub, { id: env.id, pub: env.pub });
              onPlayers?.([...joined.values()]);
            }
          }
        } catch {
          /* 不是 join envelope */
        }
      });

      const announce = (): void => {
        void this.relay.publish(
          tableId,
          new TextEncoder().encode(JSON.stringify({ t: 'join', id: me.id, pub: me.pub })),
        );
      };

      const deadline = Date.now() + 120000;
      const tick = (): void => {
        if (aborted) return;
        announce();
        if (joined.size >= meta.maxSeats) {
          // 确定性座位分配：按身份 pubkey 排序后取前 maxSeats 名玩家。
          const sorted = [...joined.values()].sort((a, b) => (a.pub < b.pub ? -1 : 1)).slice(0, meta.maxSeats);
          const players = sorted;
          const seats: TablePlayer[] = players.map((_, i) => ({ seat: i, stack: meta.startingStack }));
          const mySeat = players.findIndex((p) => p.pub === me.pub);
          if (mySeat < 0) {
            // 未能入选本桌
            reject(new Error('table filled before you were seated'));
            return;
          }
          resolve({ mySeat, seats, ruleset: rulesetFromMeta(meta), players });
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error('waiting-room timeout'));
          return;
        }
        setTimeout(tick, 400);
      };
      tick();
    }).finally(() => unsub?.());

    return {
      seated,
      abort: () => {
        aborted = true;
        unsub?.();
      },
    };
  }
}
