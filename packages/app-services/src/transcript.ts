/**
 * 重连 / 恢复（core §8.6，§12.3；REQ-NET-007，REQ-DATA-002/003）——从转录
 * （indexer 上的有序记录）重建一手牌的状态。（重）连接的客户端获取这些记录并通过确定性引擎
 * 重放它们，从而得到逐字节一致的状态；真相从不依赖于保持连接（P2/P3）。浏览器安全。
 */

import {
  type Action,
  type GameState,
  type Ruleset,
  type Card,
  sha256,
  bytesToHex,
  hexToBytes,
} from '@bsv-poker/protocol-types';
import { createGameModule } from './game-registry.ts';
import { deckFromEntropies } from './mp-shuffle.ts';
import type { TxRecord } from './network.ts';
import type { TablePlayer } from './interactive-client.ts';

interface TEnvelope {
  t: 'commit' | 'reveal' | 'action';
  seat: number;
  hand: number;
  c?: string;
  r?: string;
  kind?: Action['kind'];
  amount?: number;
  discard?: readonly number[];
}

function parseRecords(records: readonly TxRecord[]): TEnvelope[] {
  const out: TEnvelope[] = [];
  for (const rec of records) {
    if (!rec.raw) continue;
    try {
      out.push(JSON.parse(atob(rec.raw)) as TEnvelope);
    } catch {
      /* 不是我们的信封之一 */
    }
  }
  return out;
}

/**
 * 从转录记录重建第 `handNo` 手牌的最终状态，用每个 commit 校验对应的 reveal。
 * 返回重建后的状态及其哈希（必须与实时客户端的一致）。
 */
export function rebuildHand(
  records: readonly TxRecord[],
  ruleset: Ruleset,
  seats: readonly TablePlayer[],
  handNo = 0,
  buttonIndex = 0,
): { state: GameState; stateHash: string } {
  const envs = parseRecords(records).filter((e) => e.hand === handNo);
  const seatList = [...seats].sort((a, b) => a.seat - b.seat);

  const entropies: Uint8Array[] = seatList.map((s) => {
    const reveal = envs.find((e) => e.t === 'reveal' && e.seat === s.seat);
    if (!reveal?.r) throw new Error(`transcript missing reveal for seat ${s.seat}`);
    const bytes = hexToBytes(reveal.r);
    const commit = envs.find((e) => e.t === 'commit' && e.seat === s.seat);
    if (commit?.c && bytesToHex(sha256(bytes)) !== commit.c) {
      throw new Error(`transcript reveal does not match commit for seat ${s.seat}`);
    }
    return bytes;
  });

  const deck: Card[] = deckFromEntropies(entropies);
  const m = createGameModule(ruleset.variant, deck, buttonIndex);
  let state = m.init(ruleset, seatList.map((s) => ({ seat: s.seat, stack: s.stack })));

  // 权威存储会交错这两条路径，因此原始记录顺序不保证是出牌顺序（§8.5）。
  // 每个座位自身的动作是有序的，所以按引擎的 toAct 来重放：
  // 每一步取轮到的座位的下一个尚未使用的动作。确定性且稳健。
  const queues = new Map<number, Action[]>();
  for (const e of envs) {
    if (e.t !== 'action') continue;
    const a: Action = { kind: e.kind!, seat: e.seat, amount: e.amount ?? 0, ...(e.discard ? { discard: e.discard } : {}) };
    (queues.get(e.seat) ?? queues.set(e.seat, []).get(e.seat)!).push(a);
  }
  const cursor = new Map<number, number>();
  for (let guard = 0; guard < 5000 && !state.handComplete; guard++) {
    const toAct = state.betting.toAct ?? state.drawToAct ?? null;
    if (toAct === null) break;
    const q = queues.get(toAct) ?? [];
    const i = cursor.get(toAct) ?? 0;
    if (i >= q.length) break; // 转录（尚）未覆盖该座位的下一步动作
    cursor.set(toAct, i + 1);
    state = m.apply(state, q[i]!);
  }
  return { state, stateHash: m.stateHash(state) };
}
