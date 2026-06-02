/**
 * SigningModal、ShowdownPanel、SettlementSummary（REQ-APP-052；§A6.7/§A6.8）。
 * 仅用于展示。SigningModal 精确地说明正在授权的内容——不存在静默
 * 签名（REQ-UI-006 / core §11.6）。
 */
import React from 'react';
import { CardChip, CardBack, Banner } from './primitives.tsx';
import type { SigningPromptVM } from '../view-models/signing.ts';
import type { ShowdownViewModel } from '../view-models/showdown.ts';
import type { SettlementViewModel } from '../view-models/showdown.ts';

export function SigningModal(props: {
  prompt: SigningPromptVM | null;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element | null {
  const { prompt, onConfirm, onCancel } = props;
  if (!prompt) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={prompt.title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div style={{ background: '#1d1d1d', padding: 20, borderRadius: 8, maxWidth: 460 }}>
        <h2 style={{ marginTop: 0 }}>{prompt.title}</h2>
        <ul>
          {prompt.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <p style={{ fontSize: 12, color: '#bbb' }}>{prompt.disclosure}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Confirm &amp; apply
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShowdownPanel(props: { vm: ShowdownViewModel }): React.JSX.Element {
  const { vm } = props;
  return (
    <div aria-label="showdown" style={{ border: '1px solid #555', borderRadius: 8, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Showdown</h3>
      {vm.uncontested && <Banner tone="info">Hand won uncontested — cards not revealed.</Banner>}
      <div style={{ margin: '8px 0' }}>
        Board: {vm.board.length === 0 ? '(none)' : vm.board.map((c) => <CardChip key={c.code} card={c} />)}
      </div>
      {vm.seats.map((s) => (
        <div key={s.seat} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <strong>Seat {s.seat}</strong>
          {s.folded ? (
            <span style={{ color: '#999' }}>folded {[0, 1].map((i) => <CardBack key={i} />)}</span>
          ) : (
            s.holeCards.map((c) => <CardChip key={c.code} card={c} />)
          )}
          {s.won > 0 && <span style={{ color: '#8f8' }}>won {s.won}</span>}
        </div>
      ))}
    </div>
  );
}

export function SettlementSummary(props: { vm: SettlementViewModel }): React.JSX.Element {
  const { vm } = props;
  return (
    <div aria-label="settlement" style={{ border: '1px solid #555', borderRadius: 8, padding: 12, marginTop: 8 }}>
      <h3 style={{ marginTop: 0 }}>Settlement (total pot {vm.totalPot})</h3>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingRight: 12 }}>Seat</th>
            <th style={{ textAlign: 'left', paddingRight: 12 }}>Net</th>
            <th style={{ textAlign: 'left' }}>Stack</th>
          </tr>
        </thead>
        <tbody>
          {vm.rows.map((r) => (
            <tr key={r.seat}>
              <td>{r.seat}</td>
              <td style={{ color: r.delta >= 0 ? '#8f8' : '#f88' }}>
                {r.delta >= 0 ? '+' : ''}
                {r.delta}
              </td>
              <td>{r.endingStack}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
