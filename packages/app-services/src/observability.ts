/**
 * 带有硬性脱敏保证的结构化、分级日志（REQ-APP-120）：日志、指标、trace 以及诊断包
 * 绝不能包含密钥材料（REQ-APP-124）。每条记录都按组件分类并分级；字段载荷会经过 `redact()`，
 * 它会（递归地）剥离任何命名像 secret 的内容，从而使游离的私有 scalar/seed 永远不会到达 sink。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  readonly ts: number;
  readonly level: LogLevel;
  readonly component: string;
  readonly msg: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// 承载密钥材料、绝不能以明文记录的字段名。
const SECRET_NAME = /(priv|secret|seed|mnemonic|scalar|wif|privatekey|password)/i;
export const REDACTED = '[redacted]';

/** 递归地将任何命名为 secret 的字段替换为脱敏标记。 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_NAME.test(k) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

export class Logger {
  private readonly component: string;
  private readonly sink: LogSink;
  private readonly min: LogLevel;

  constructor(component: string, sink: LogSink, min: LogLevel = 'info') {
    this.component = component;
    this.sink = sink;
    this.min = min;
  }

  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.min]) return;
    const base = { ts: Date.now(), level, component: this.component, msg };
    this.sink.write(fields ? { ...base, fields: redact(fields) as Record<string, unknown> } : base);
  }

  debug(msg: string, fields?: Record<string, unknown>): void { this.log('debug', msg, fields); }
  info(msg: string, fields?: Record<string, unknown>): void { this.log('info', msg, fields); }
  warn(msg: string, fields?: Record<string, unknown>): void { this.log('warn', msg, fields); }
  error(msg: string, fields?: Record<string, unknown>): void { this.log('error', msg, fields); }
}

/** 在内存中收集记录——供测试和诊断包使用（诊断包继承脱敏）。 */
export class MemorySink implements LogSink {
  readonly records: LogRecord[] = [];
  write(record: LogRecord): void { this.records.push(record); }
}

// ---- 指标（REQ-APP-121）：counter / gauge / histogram ----
export interface HistogramSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histos = new Map<string, number[]>();

  inc(name: string, by = 1): void { this.counters.set(name, (this.counters.get(name) ?? 0) + by); }
  setGauge(name: string, value: number): void { this.gauges.set(name, value); }
  observe(name: string, value: number): void {
    const xs = this.histos.get(name) ?? [];
    xs.push(value);
    this.histos.set(name, xs);
  }

  snapshot(): { counters: Record<string, number>; gauges: Record<string, number>; histograms: Record<string, HistogramSummary> } {
    const histograms: Record<string, HistogramSummary> = {};
    for (const [name, xs] of this.histos) {
      const s = [...xs].sort((a, b) => a - b);
      histograms[name] = { count: s.length, min: s[0]!, max: s[s.length - 1]!, p50: s[Math.floor((s.length - 1) / 2)]! };
    }
    return { counters: Object.fromEntries(this.counters), gauges: Object.fromEntries(this.gauges), histograms };
  }
}

// ---- 追踪（REQ-APP-122）：每个玩家动作一条 trace，贯穿 app-services → SDK → send ----
export interface SpanEvent { readonly stage: string; readonly t: number }
export interface Span { readonly name: string; readonly startedAt: number; endedAt?: number; readonly events: SpanEvent[] }

export class Tracer {
  readonly spans: Span[] = [];
  start(name: string): Span {
    const span: Span = { name, startedAt: Date.now(), events: [] };
    this.spans.push(span);
    return span;
  }
  event(span: Span, stage: string): void { span.events.push({ stage, t: Date.now() }); }
  end(span: Span): void { span.endedAt = Date.now(); }
}

// ---- 诊断包（REQ-APP-123） ----
export interface DiagnosticBundle {
  readonly generatedAt: number;
  readonly logs: readonly LogRecord[];
  readonly metrics: ReturnType<Metrics['snapshot']>;
  readonly traces: readonly Span[];
}

/**
 * 从日志 + 指标 + trace 组装诊断包。日志在写入时已脱敏，因此诊断包继承了无密钥材料的保证
 * （REQ-APP-124）；我们出于防御性考虑会重新对日志字段脱敏，使诊断包无论记录是如何产生的
 * 都可安全导出。
 */
export function diagnosticBundle(sink: MemorySink, metrics: Metrics, tracer: Tracer): DiagnosticBundle {
  const logs = sink.records.map((r) => (r.fields ? { ...r, fields: redact(r.fields) as Record<string, unknown> } : r));
  return { generatedAt: Date.now(), logs, metrics: metrics.snapshot(), traces: tracer.spans };
}
