/**
 * 等待室（§A7）—— 在创建/加入之后，我们处于 `LobbyClient.joinWaitingRoom`；已加入的
 * 玩家列表经由 onPlayers 回调（由 App 驱动）实时更新。当房间坐满时，
 * `seated` 在 App 中兑现，我们前进到牌桌。纯渲染 ui-core 的 waitingRoomVM。
 */
import React from 'react';
import { waitingRoomVM } from '@bsv-poker/ui-core/view-models';
import { MainnetBanner } from '@bsv-poker/ui-core/components';

export function WaitingRoom(props: {
  tableName: string;
  capacity: number;
  players: readonly { id: string; pub: string }[];
  myId: string;
  error: string | null;
  onCancel: () => void;
}): React.JSX.Element {
  const vm = waitingRoomVM(props.players, props.capacity);

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: 16, display: 'grid', gap: 12 }}>
      <MainnetBanner regtest={true} />
      <h1 style={{ margin: 0 }}>{props.tableName}</h1>
      <div aria-live="polite" style={{ fontSize: 18 }}>
        {props.error ? <span style={{ color: '#f88' }}>{props.error}</span> : vm.statusText}
      </div>

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
        {vm.players.map((p) => (
          <li
            key={p.pub}
            style={{ border: '1px solid #555', borderRadius: 6, padding: '6px 10px' }}
          >
            {p.id} {p.id === props.myId ? <span style={{ color: '#8f8' }}>(you)</span> : null}
          </li>
        ))}
      </ul>

      <button type="button" onClick={props.onCancel} style={{ padding: '8px 16px', width: 'fit-content' }}>
        Leave waiting room
      </button>
    </div>
  );
}
