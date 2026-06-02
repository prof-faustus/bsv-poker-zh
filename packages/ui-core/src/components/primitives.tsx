/**
 * 共享的展示型基础组件（REQ-APP-052）。纯粹按 props 渲染——无业务逻辑，
 * 不计算合法性。花色带有字母字形，使任何信息都不仅靠颜色表达（a11y，
 * §A3.5 / core §5.5.1 无花色优先级）。
 *
 * <PlayingCard> 渲染逼真的牌面（圆角白色矩形、四角的点数+花色、中央的花色符号），
 * <CardBack> 为隐藏的牌渲染带花纹的背面。<CardChip> 保留为 <PlayingCard size="sm">
 * 的简短别名，使现有调用点（modals/showdown）继续可用。
 */
import React from 'react';
import type { CardVM } from '../view-models/table.ts';

const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const SUIT_NAME: Record<string, string> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const SUIT_RED = new Set(['d', 'h']);

export type CardSize = 'sm' | 'md' | 'lg';

const SIZES: Record<CardSize, { w: number; h: number; rank: number; pip: number }> = {
  sm: { w: 34, h: 48, rank: 13, pip: 16 },
  md: { w: 46, h: 64, rank: 16, pip: 24 },
  lg: { w: 58, h: 82, rank: 20, pip: 32 },
};

export function PlayingCard(props: { card: CardVM; size?: CardSize }): React.JSX.Element {
  const { card } = props;
  const s = SIZES[props.size ?? 'md'];
  const red = SUIT_RED.has(card.suit);
  const glyph = SUIT_GLYPH[card.suit] ?? '?';
  const color = red ? '#c4122f' : '#16181d';
  const corner = (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 0.95 }}>
      <span style={{ fontSize: s.rank, fontWeight: 800 }}>{card.rank}</span>
      <span style={{ fontSize: s.rank - 2 }}>{glyph}</span>
    </span>
  );
  return (
    <span
      role="img"
      aria-label={`${card.rank} of ${SUIT_NAME[card.suit] ?? card.suit}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: s.w,
        height: s.h,
        borderRadius: 7,
        background: 'linear-gradient(180deg,#ffffff,#f1f1ee)',
        border: '1px solid #c9c9c0',
        boxShadow: '0 2px 4px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.6)',
        color,
        fontFamily: 'Georgia, "Times New Roman", serif',
        margin: 2,
        userSelect: 'none',
        flex: '0 0 auto',
      }}
    >
      <span style={{ position: 'absolute', top: 3, left: 4 }}>{corner}</span>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: s.pip,
        }}
      >
        {glyph}
      </span>
      <span
        style={{ position: 'absolute', bottom: 3, right: 4, transform: 'rotate(180deg)' }}
      >
        {corner}
      </span>
    </span>
  );
}

/** 供 showdown/settlement 面板使用的向后兼容别名。小尺寸明牌。 */
export function CardChip(props: { card: CardVM }): React.JSX.Element {
  return <PlayingCard card={props.card} size="sm" />;
}

export function CardBack(props: { size?: CardSize }): React.JSX.Element {
  const s = SIZES[props.size ?? 'md'];
  return (
    <span
      aria-label="concealed card"
      role="img"
      style={{
        display: 'inline-block',
        width: s.w,
        height: s.h,
        borderRadius: 7,
        background:
          'repeating-linear-gradient(45deg,#39508f,#39508f 5px,#2a3c6e 5px,#2a3c6e 10px)',
        border: '1px solid #1c2747',
        boxShadow: '0 2px 4px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,255,255,0.18)',
        margin: 2,
        flex: '0 0 auto',
      }}
    />
  );
}

/** 单枚赌场筹码（装饰性）。`value` 显示出来以便阅读。 */
export function Chip(props: { value?: number; color?: string; size?: number }): React.JSX.Element {
  const size = props.size ?? 26;
  const color = props.color ?? '#c4122f';
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 50% 40%, ${color}, ${shade(color)})`,
        border: '2px dashed rgba(255,255,255,0.7)',
        color: '#fff',
        fontSize: Math.max(8, size * 0.32),
        fontWeight: 700,
        boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
      }}
    >
      {props.value ?? ''}
    </span>
  );
}

/** 带标签的筹码堆——一枚筹码加一个金额，用于底池/下注显示。 */
export function ChipStack(props: { amount: number; label?: string; color?: string }): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(0,0,0,0.45)',
        borderRadius: 14,
        padding: '2px 10px 2px 4px',
        color: '#fff',
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      <Chip color={props.color} size={22} />
      <span>
        {props.label ? `${props.label} ` : ''}
        {props.amount}
      </span>
    </span>
  );
}

function shade(hex: string): string {
  // 把 #rrggbb 调暗约 35% 作为筹码下方的渐变停止点；失败则回退为输入值。
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#7a0c1d';
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.65);
  const g = Math.round(((n >> 8) & 255) * 0.65);
  const b = Math.round((n & 255) * 0.65);
  return `rgb(${r},${g},${b})`;
}

export function Banner(props: {
  children: React.ReactNode;
  tone?: 'warn' | 'info' | 'error';
}): React.JSX.Element {
  const bg = props.tone === 'error' ? '#7a1f1f' : props.tone === 'info' ? '#1f4d7a' : '#7a5a1f';
  return (
    <div
      role="status"
      style={{
        background: bg,
        color: '#fff',
        padding: '6px 12px',
        borderRadius: 4,
        fontSize: 13,
      }}
    >
      {props.children}
    </div>
  );
}
