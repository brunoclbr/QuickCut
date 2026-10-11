import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const content = fs.readFileSync(new URL('../editorial.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(content, context);
const { HFEditorial: h } = context.window;
class MockTimeline {
  constructor() { this.calls = []; }
  set(...a) { this.calls.push(['set', ...a]); return this; }
  fromTo(...a) { this.calls.push(['fromTo', ...a]); return this; }
}
test('public API exposes all editorial choreography', () => {
  for (const name of ['proofIn','proofOut','pipIn','wipeIn','focusIn','focusOut','stepsIn','comparisonReveal','matchExpand','drawLine']) assert.equal(typeof h[name], 'function', name);
});
test('timings are absolute and seek-safe GSAP methods used', () => {
  const t = new MockTimeline();
  assert.equal(h.proofIn(t, '#proof', 2, { duration: .5 }), 2.5);
  assert.equal(h.proofOut(t, '#proof', 4, { duration: .2 }), 4.2);
  assert.equal(h.pipIn(t, '#camera', 5), 5.52);
  assert.equal(h.wipeIn(t, '#scene', 7), 7.42);
  assert.ok(Math.abs(h.focusIn(t, '#dim', '#outline', 10) - 10.29) < 1e-8);
  assert.ok(Math.abs(h.focusOut(t, '#dim', '#outline', 12) - 12.22) < 1e-8);
  assert.ok(Math.abs(h.stepsIn(t, ['#a','#b','#c'], 15, { interval: .4, duration: .3 }) - 16.1) < 1e-8);
  assert.equal(h.comparisonReveal(t, '#after', '#divider', 20), 20.68);
  assert.ok(t.calls.length > 20);
  for (const call of t.calls) assert.ok(['set','fromTo'].includes(call[0]));
});
test('rejects invalid timelines, timing, and wipe directions', () => {
  assert.throws(() => h.proofIn(null, '#proof', 0), /GSAP timeline/);
  assert.throws(() => h.proofIn(new MockTimeline(), '#proof', -1), /nonnegative/);
  assert.throws(() => h.wipeIn(new MockTimeline(), '#proof', 0, { direction: 'diagonal' }), /Direction/);
});
test('match expansion uses matching actual screen element rectangles', () => {
  const a = { getBoundingClientRect: () => ({left: 100,top: 100,width: 250,height: 200}) };
  const b = { getBoundingClientRect: () => ({left: 0,top: 0,width: 1000,height: 1600}) };
  const t = new MockTimeline();
  assert.equal(h.matchExpand(t,a,b,2.3),2.86);
  const from = t.calls.find(c => c[0] === 'fromTo' && c[1] === b);
  assert.equal(from[2].scaleX,.25);
  assert.equal(from[2].scaleY,.125);
});
test('refuses timed HyperFrames clips as targets (the framework owns their visibility)', () => {
  const el = (attrs, id) => ({ nodeType: 1, id, hasAttribute: a => attrs.includes(a) });
  const clip = el(['data-start'], 'proof-clip'), child = el([], 'proof');
  const document = { querySelectorAll: s => (s === '#proof-clip' ? [clip] : s === '#proof' ? [child] : []) };
  const ctx = { window: {}, document };
  vm.runInNewContext(content, ctx);
  const e = ctx.window.HFEditorial;
  assert.throws(() => e.proofIn(new MockTimeline(), '#proof-clip', 1), /timed HyperFrames clip/);
  assert.throws(() => e.proofOut(new MockTimeline(), clip, 2), /timed HyperFrames clip/);
  assert.throws(() => e.focusIn(new MockTimeline(), '#proof', '#proof-clip', 1), /timed HyperFrames clip/);
  assert.equal(e.proofIn(new MockTimeline(), '#proof', 1), 1.46);
});
test('initial hidden state is set outside the timeline when GSAP is loaded, so frame 0 is right', () => {
  const sets = [];
  const ctx = { window: { gsap: { set: (target, vars) => sets.push([target, vars]) } } };
  vm.runInNewContext(content, ctx);
  const t = new MockTimeline();
  ctx.window.HFEditorial.proofIn(t, '#proof', 2);
  assert.deepEqual(sets.map(([target, vars]) => [target, vars.autoAlpha]), [['#proof', 0]]);
  assert.ok(!t.calls.some(c => c[0] === 'set' && c[3] === 0), 'no zero-length set at position 0');
});
