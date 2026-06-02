import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Metrics, Tracer } from '../src/observability.ts';

test('metrics: counters, gauges, and histogram summaries (REQ-APP-121)', () => {
  const m = new Metrics();
  m.inc('service.restarts');
  m.inc('service.restarts', 2);
  m.setGauge('service.health', 1);
  for (const v of [10, 30, 20, 50, 40]) m.observe('action.latency.ms', v);
  const s = m.snapshot();
  assert.equal(s.counters['service.restarts'], 3);
  assert.equal(s.gauges['service.health'], 1);
  assert.deepEqual(s.histograms['action.latency.ms'], { count: 5, min: 10, max: 50, p50: 30 });
});

test('tracing: one trace per player action spans app-services → SDK → both send paths (REQ-APP-122)', () => {
  const t = new Tracer();
  const span = t.start('player-action:raise');
  t.event(span, 'app-services.action');
  t.event(span, 'sdk.sign');
  t.event(span, 'send.speed');
  t.event(span, 'send.canonical');
  t.end(span);
  assert.equal(t.spans.length, 1);
  assert.deepEqual(span.events.map((e) => e.stage), ['app-services.action', 'sdk.sign', 'send.speed', 'send.canonical']);
  assert.ok(span.endedAt !== undefined, 'span is closed');
});

import { Logger, MemorySink as MS, diagnosticBundle, Metrics as Mx, Tracer as Tr } from '../src/observability.ts';

test('diagnostic bundle aggregates logs+metrics+traces and inherits redaction (REQ-APP-123)', () => {
  const sink = new MS();
  new Logger('custody', sink, 'debug').info('derive', { priv: 'ff'.repeat(32), gid: 'a1' });
  const m = new Mx(); m.inc('restarts');
  const t = new Tr(); const s = t.start('action'); t.event(s, 'sign'); t.end(s);
  const b = diagnosticBundle(sink, m, t);
  assert.equal(b.logs.length, 1);
  assert.equal(b.metrics.counters['restarts'], 1);
  assert.equal(b.traces.length, 1);
  assert.ok(!JSON.stringify(b).includes('ffffffff'), 'no key material in the exported bundle');
});
