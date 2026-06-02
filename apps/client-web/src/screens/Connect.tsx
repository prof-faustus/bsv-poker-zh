/**
 * Connect 屏幕（§A6.3）—— 输入 relay 基础 URL 并连接到大厅。使用显式 onClick
 * （非 <form> 提交，REQ-UI-003）。REGTEST/游戏币横幅在此处及各处显示。
 */
import React, { useState } from 'react';
import { MainnetBanner } from '@bsv-poker/ui-core/components';

export function Connect(props: {
  defaultRelay: string;
  identityId: string;
  onConnect: (relay: string) => void;
  onPractice: () => void;
  connecting: boolean;
  error: string | null;
}): React.JSX.Element {
  const [relay, setRelay] = useState(props.defaultRelay);
  const trimmed = relay.trim();
  const valid = /^https?:\/\//i.test(trimmed);

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: 16, display: 'grid', gap: 12 }}>
      <MainnetBanner regtest={true} />
      <h1 style={{ margin: 0 }}>BSV Poker — Multiplayer</h1>
      <p style={{ color: '#aaa', margin: 0 }}>
        Connect to a relay to find a table and play real opponents over the wire. The waiting room
        and interactive play are real (over the relay); the on-chain crypto/transactions are the
        Node SDK path (§A2.3) and are not in this browser bundle.
      </p>
      <div style={{ color: '#888', fontSize: 13 }}>
        Your session identity: <code>{props.identityId}</code>
      </div>

      <label style={{ display: 'grid', gap: 4 }}>
        Relay base URL
        <input
          type="url"
          value={relay}
          onChange={(e) => setRelay(e.target.value)}
          placeholder="http://localhost:8091"
          style={{ padding: 6, fontSize: 14 }}
        />
      </label>
      {!valid && trimmed.length > 0 && (
        <div style={{ color: '#f88', fontSize: 13 }}>Enter a http(s):// URL.</div>
      )}
      {props.error && <div style={{ color: '#f88', fontSize: 13 }}>{props.error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={!valid || props.connecting}
          onClick={() => props.onConnect(trimmed)}
          style={{ padding: '8px 16px', fontSize: 16 }}
        >
          {props.connecting ? 'Connecting…' : 'Connect'}
        </button>
        <button type="button" onClick={props.onPractice} style={{ padding: '8px 16px', fontSize: 16 }}>
          Practice vs bot (offline)
        </button>
      </div>
    </div>
  );
}
