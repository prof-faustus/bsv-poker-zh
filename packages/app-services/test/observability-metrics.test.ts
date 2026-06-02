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
