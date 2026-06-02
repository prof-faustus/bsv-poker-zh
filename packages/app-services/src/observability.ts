/**
 * Structured, levelled logging (REQ-APP-120) with a hard redaction guarantee: logs, metrics, traces,
 * and diagnostic bundles MUST NOT contain key material (REQ-APP-124). Every record is per-component
 * and levelled; field payloads pass through `redact()`, which strips anything named like a secret
 * (recursively) so a stray private scalar/seed never reaches a sink.
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

// Field names that carry key material and MUST never be logged in the clear.
const SECRET_NAME = /(priv|secret|seed|mnemonic|scalar|wif|privatekey|password)/i;
export const REDACTED = '[redacted]';

/** Recursively replace any secret-named field with a redaction marker. */
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

/** Collects records in memory — used by tests and diagnostic bundles (which inherit redaction). */
export class MemorySink implements LogSink {
  readonly records: LogRecord[] = [];
  write(record: LogRecord): void { this.records.push(record); }
}

// ---- Metrics (REQ-APP-121): counters / gauges / histograms ----
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

// ---- Tracing (REQ-APP-122): one trace per player action across app-services → SDK → send ----
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
