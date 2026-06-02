/**
 * 牌桌界面的展示型组件（REQ-APP-052）。全部为视图模型 props 的纯渲染。
 * 显式的 onClick/onChange 处理器，不使用 <form> 提交（REQ-UI-003）。无业务逻辑：
 * ActionBar 从引擎读取合法动作描述符，从不自行计算合法性——
 * 下注/加注滑块的范围和快捷按钮金额来自纯下注尺度视图模型，
 * 而该视图模型本身只会将值钳制到引擎的合法范围内。
 *
 * <PokerTable> 是核心：一张绿色绒面椭圆牌桌，中央放置底池和公共牌，
 * 座位沿椭圆周围分布（参见 table-layout 视图模型中的 seatPositions）。它
 * 是响应式的（按百分比定位），并且支持键盘/辅助技术无障碍访问（当前待行动座位通过
 * aria-current + aria-live 播报；牌带有花色名称和字母，因此没有任何信息仅靠颜色传达）。
 */
import React from 'react';
import { PlayingCard, CardBack, CardChip, Banner, ChipStack } from './primitives.tsx';
import { seatPositions } from '../view-models/table-layout.ts';
import { sizerRange, clampToRange, quickButtons } from '../view-models/bet-sizing.ts';
import type {
  SeatVM,
  PotVM,
  ActionBarVM,
  TimerVM,
  TableViewModel,
} from '../view-models/table.ts';

export function MainnetBanner(props: { regtest: boolean }): React.JSX.Element {
  // REQ-VM-007 / §A3.5 —— 不容错过。Phase-1 始终是 regtest 游戏币。
  return (
    <Banner tone={props.regtest ? 'warn' : 'error'}>
      {props.regtest
        ? 'REGTEST — play money. No real funds are at risk.'
        : 'MAINNET RESEARCH MODE — real value at risk.'}
    </Banner>
  );
}

export function Board(props: { board: TableViewModel['board'] }): React.JSX.Element {
  return (
    <div
      aria-label="community cards"
      style={{ display: 'flex', minHeight: 64, justifyContent: 'center', alignItems: 'center', gap: 2 }}
    >
      {props.board.length === 0 ? (
        <span style={{ color: 'rgba(255,255,255,0.55)', fontStyle: 'italic', fontSize: 13 }}>
          (no community cards yet)
        </span>
      ) : (
        props.board.map((c) => <PlayingCard key={c.code} card={c} size="md" />)
      )}
    </div>
  );
}

export function PotDisplay(props: { pots: readonly PotVM[]; total: number }): React.JSX.Element {
  const sidePots = props.pots.length > 1 ? props.pots : [];
  return (
    <div aria-label="pots" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <ChipStack amount={props.total} label="Pot" color="#2e7d32" />
      {sidePots.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {sidePots.map((p, i) => (
            <span
              key={i}
              title={`eligible: ${p.eligible.join(', ')}`}
              style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}
            >
              {i === 0 ? 'Main' : `Side ${i}`}: {p.amount}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 某个座位展示的牌：英雄（hero）正面朝上，其他人均为背面朝下的牌背（托管边界）。 */
function SeatCards(props: { seat: SeatVM }): React.JSX.Element {
  const { seat } = props;
  const backs = Math.max(2, seat.holeCards.length || 2);
  return (
    <div aria-label={`seat ${seat.seat} cards`} style={{ display: 'flex', justifyContent: 'center' }}>
      {seat.isHero && seat.holeCards.length > 0
        ? seat.holeCards.map((c) => <PlayingCard key={c.code} card={c} size="sm" />)
        : Array.from({ length: backs }, (_, i) => <CardBack key={i} size="sm" />)}
    </div>
  );
}

/** 放置在牌桌边缘的单个座位区块。显示名称、筹码量、按钮、待行动光环、状态和牌。 */
function SeatPod(props: {
  seat: SeatVM;
  label: string;
  xPct: number;
  yPct: number;
}): React.JSX.Element {
  const { seat, label } = props;
  return (
    <div
      aria-current={seat.isToAct ? 'true' : undefined}
      style={{
        position: 'absolute',
        left: `${props.xPct}%`,
        top: `${props.yPct}%`,
        transform: 'translate(-50%, -50%)',
        width: 132,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <SeatCards seat={seat} />
      <div
        style={{
          width: '100%',
          textAlign: 'center',
          borderRadius: 10,
          padding: '5px 6px',
          background: seat.isHero
            ? 'linear-gradient(180deg,#1c4a2e,#13301f)'
            : 'linear-gradient(180deg,#2a2a2e,#191919)',
          border: seat.isToAct ? '2px solid #ffd24d' : '1px solid rgba(255,255,255,0.18)',
          boxShadow: seat.isToAct
            ? '0 0 0 3px rgba(255,210,77,0.35), 0 0 14px rgba(255,210,77,0.5)'
            : '0 2px 6px rgba(0,0,0,0.5)',
          opacity: seat.folded ? 0.45 : 1,
          color: '#fff',
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 96 }}>
            {label}
          </span>
          {seat.isButton && (
            <span
              aria-label="dealer button"
              style={{
                display: 'inline-flex',
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#fff',
                color: '#111',
                fontSize: 9,
                fontWeight: 800,
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #aaa',
              }}
            >
              D
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 2 }}>
          <span aria-label="chip stack" style={{ color: '#ffd24d', fontWeight: 700 }}>
            {seat.stack}
          </span>
          {seat.folded && <span style={{ color: '#e88' }}>· folded</span>}
          {seat.allIn && <span style={{ color: '#8ce' }}>· all-in</span>}
        </div>
      </div>
      {seat.committedThisRound > 0 && (
        <div style={{ marginTop: 2 }}>
          <ChipStack amount={seat.committedThisRound} color="#2e74c4" />
        </div>
      )}
    </div>
  );
}

/**
 * 拟真的牌桌：深色背景上的绿色绒面椭圆，座位呈扇形分布在牌桌边缘，
 * 底池和公共牌位于中央。`seatLabel` 覆盖每个座位的名称（联网
 * 对局中的对手 id）。英雄（hero）锚定在底部中央。
 */
export function PokerTable(props: {
  vm: TableViewModel;
  seatLabel?: (seat: SeatVM) => string;
}): React.JSX.Element {
  const { vm } = props;
  const label = props.seatLabel ?? ((s: SeatVM) => (s.isHero ? 'You' : 'Bot'));
  const order = vm.seats.map((s) => s.seat);
  const positions = seatPositions({ count: vm.seats.length, heroSeat: vm.heroSeat, seatOrder: order });
  const posBySeat = new Map(positions.map((p) => [p.seat, p]));

  return (
    <div
      role="group"
      aria-label="poker table"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 820,
        margin: '0 auto',
        aspectRatio: '16 / 10',
        background: 'radial-gradient(ellipse at center, #0d1117 0%, #05070b 100%)',
        borderRadius: 24,
        padding: 8,
      }}
    >
      {/* 绒面椭圆和牌桌边缘 */}
      <div
        style={{
          position: 'absolute',
          inset: '9%',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at 50% 38%, #2f9e57 0%, #1f7d42 55%, #145c30 100%)',
          border: '14px solid #5b3a1f',
          boxShadow:
            'inset 0 0 40px rgba(0,0,0,0.55), 0 0 0 3px #3a2412, 0 10px 30px rgba(0,0,0,0.6)',
        }}
      >
        {/* 中央：底池在上，公共牌在下 */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            width: '70%',
          }}
        >
          <PotDisplay pots={vm.pots} total={vm.totalPot} />
          <Board board={vm.board} />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 1 }}>
            {vm.phase}
          </div>
        </div>
      </div>

      {/* 牌桌边缘的座位区块 */}
      {vm.seats.map((s) => {
        const p = posBySeat.get(s.seat);
        if (!p) return null;
        return <SeatPod key={s.seat} seat={s} label={label(s)} xPct={p.xPct} yPct={p.yPct} />;
      })}
    </div>
  );
}

/**
 * 旧版的扁平座位列表——为向后兼容而保留（同时作为响应式回退方案）。各界面现在
 * 渲染 <PokerTable>；保留此组件以免旧的调用点/测试失效。
 */
export function SeatRing(props: {
  seats: readonly SeatVM[];
  seatLabel?: (seat: SeatVM) => string;
}): React.JSX.Element {
  const label = props.seatLabel ?? ((s: SeatVM) => (s.isHero ? '(you)' : '(bot)'));
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {props.seats.map((s) => (
        <div
          key={s.seat}
          aria-current={s.isToAct ? 'true' : undefined}
          style={{
            border: s.isToAct ? '2px solid #ffd24d' : '1px solid #555',
            borderRadius: 8,
            padding: 8,
            minWidth: 150,
            opacity: s.folded ? 0.5 : 1,
            background: s.isHero ? '#13301f' : '#1a1a1a',
          }}
        >
          <div style={{ fontWeight: 700 }}>
            Seat {s.seat} {label(s)} {s.isButton ? '(D)' : ''}
          </div>
          <div>Stack: {s.stack}</div>
          <div>In front: {s.committedThisRound}</div>
          {s.folded && <div style={{ color: '#e88' }}>folded</div>}
          {s.allIn && <div style={{ color: '#8ce' }}>all-in</div>}
          <div style={{ display: 'flex' }}>
            {s.isHero && s.holeCards.length > 0
              ? s.holeCards.map((c) => <CardChip key={c.code} card={c} />)
              : [0, 1].map((i) => <CardBack key={i} size="sm" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TimerBanner(props: { timer: TimerVM }): React.JSX.Element {
  // 展示后果/默认行为文本（core §11.4）——从不隐藏。
  return (
    <Banner tone="info">
      <span aria-live="polite">{props.timer.consequenceText}</span>
    </Banner>
  );
}

export interface ActionBarProps {
  readonly vm: ActionBarVM;
  readonly heroSeat: number;
  readonly betAmount: number;
  readonly onBetAmountChange: (n: number) => void;
  readonly onAction: (choice: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount: number) => void;
  /** 当前底池总额，仅用于标注按底池比例的快捷按钮（金额仍会钳制到
   * 引擎的合法范围内——合法性绝不在 UI 中计算）。 */
  readonly pot?: number;
}

export function ActionBar(props: ActionBarProps): React.JSX.Element {
  const { vm, betAmount, onBetAmountChange, onAction } = props;
  if (!vm.isHeroTurn) {
    return (
      <div role="group" aria-label="actions" style={{ color: '#999', padding: 8 }}>
        Not your turn — controls disabled.
      </div>
    );
  }
  const legal = vm.legal;
  const range = sizerRange(legal);
  const toCall = legal.call ? legal.call.amount : 0;
  const quicks = quickButtons({ range, pot: props.pot ?? 0, toCall });

  const btn: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 14,
    fontWeight: 700,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.2)',
    cursor: 'pointer',
    color: '#fff',
  };

  return (
    <div
      role="group"
      aria-label="actions"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        flexWrap: 'wrap',
        background: 'linear-gradient(180deg,#23262e,#15171c)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12,
        padding: 12,
      }}
    >
      {legal.fold && (
        <button type="button" onClick={() => onAction('fold', 0)} style={{ ...btn, background: '#7a2222' }}>
          Fold
        </button>
      )}
      {legal.check && (
        <button type="button" onClick={() => onAction('check', 0)} style={{ ...btn, background: '#2e6b3e' }}>
          Check
        </button>
      )}
      {legal.call && (
        <button
          type="button"
          onClick={() => onAction('call', legal.call!.amount)}
          style={{ ...btn, background: '#2e6b3e' }}
        >
          Call {legal.call.amount}
        </button>
      )}

      {range.available && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'rgba(0,0,0,0.25)',
            borderRadius: 10,
            padding: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {quicks.map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => onBetAmountChange(q.amount)}
                style={{ ...btn, background: '#34495e', padding: '4px 8px', fontSize: 12 }}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label htmlFor="bet-slider" style={{ color: '#bbb', fontSize: 12 }}>
              Size
            </label>
            <input
              id="bet-slider"
              type="range"
              min={range.min}
              max={range.max}
              value={clampToRange(betAmount, range)}
              onChange={(e) => onBetAmountChange(clampToRange(Number(e.target.value), range))}
              aria-label="bet size slider"
              style={{ flex: 1, minWidth: 120 }}
            />
            <input
              id="bet-sizer"
              type="number"
              min={range.min}
              max={range.max}
              value={betAmount}
              onChange={(e) => onBetAmountChange(clampToRange(Number(e.target.value), range))}
              aria-label="bet size"
              style={{ width: 84 }}
            />
            <small style={{ color: '#aaa' }}>
              ({range.min}–{range.max})
            </small>
          </div>
          <div>
            {legal.bet && (
              <button
                type="button"
                onClick={() => onAction('bet', clampToRange(betAmount, range))}
                style={{ ...btn, background: '#b5701b', width: '100%' }}
              >
                Bet {clampToRange(betAmount, range)}
              </button>
            )}
            {legal.raise && (
              <button
                type="button"
                onClick={() => onAction('raise', clampToRange(betAmount, range))}
                style={{ ...btn, background: '#b5701b', width: '100%' }}
              >
                Raise to {clampToRange(betAmount, range)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 为向后兼容保留 HandViewer 导出（用于渲染单个座位的牌）。 */
export function HandViewer(props: { seat: SeatVM }): React.JSX.Element {
  return <SeatCards seat={props.seat} />;
}
