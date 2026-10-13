import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../hf/annotate.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(code, context);
const { HFAnnotate: a } = context.window;

class MockTimeline {
  constructor() { this.calls = []; }
  set(...x) { this.calls.push(['set', ...x]); return this; }
  fromTo(...x) { this.calls.push(['fromTo', ...x]); return this; }
}
// Minimal SVG-like nodes: enough for lengths, attributes and part lookup.
function node(tag, attrs = {}, children = []) {
  return {
    nodeType: 1, tagName: tag, attrs: { ...attrs }, children, dataset: attrs['data-part'] ? { part: attrs['data-part'] } : {},
    getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }, hasAttribute(k) { return k in this.attrs; },
    getTotalLength() { return 100; },
    querySelectorAll(sel) {
      const all = []; const walk = n => n.children.forEach(c => { all.push(c); walk(c); }); walk(this);
      if (sel === '[data-part]') return all.filter(n => n.dataset.part);
      if (sel === 'circle') return all.filter(n => n.tagName === 'circle');
      return all.filter(n => sel.split(',').map(s => s.trim()).includes(n.tagName));
    },
    querySelector(sel) { const m = /data-part="([^"]+)"/.exec(sel); return this.querySelectorAll('[data-part]').find(n => n.dataset.part === m?.[1]) || null; },
  };
}
const sketch = () => node('svg', {}, [
  node('g', { 'data-part': 'body' }, [node('path', { stroke: '#fff' }), node('circle', { stroke: '#111', fill: '#fff' })]),
  node('g', { 'data-part': 'arrow' }, [node('path', { stroke: '#E7A461' })]),
]);

test('public API exposes the three components', () => {
  for (const name of ['sketchIn', 'sketchPart', 'sketchEmphasis', 'sketchOut', 'trailIn', 'trailOut', 'markerIn', 'markerOut']) assert.equal(typeof a[name], 'function', name);
});

test('sketch draws listed parts in order with absolute times and leaves other parts undrawn', () => {
  const t = new MockTimeline(), svg = sketch();
  const end = a.sketchIn(t, svg, 2, { order: ['body'], part: 0.2, overlap: 0.5 });
  assert.ok(Math.abs(end - 2.2) < 1e-9);
  const drawn = t.calls.filter(c => c[0] === 'fromTo' && c[3].strokeDashoffset === 0).map(c => c[1]);
  assert.ok(drawn.every(el => el.attrs.stroke !== '#E7A461'), 'the arrow waits for sketchPart');
  assert.equal(a.sketchPart(t, svg, 'arrow', 3, 0.5), 3.5);
  assert.ok(Math.abs(a.sketchEmphasis(t, svg, 4, { keep: ['arrow'], hold: 0.5, fade: 0.2 }) - 4.9) < 1e-9);
  assert.equal(a.sketchOut(t, svg, 6, { duration: 0.3 }), 6.3);
  // Without a page gsap the initial state falls back to sets at 0; every tween is an absolute fromTo.
  for (const c of t.calls) if (c[0] === 'set') assert.equal(c[3], 0); else { assert.equal(c[0], 'fromTo'); assert.equal(c[3].immediateRender, false); }
});

test('trail tip sits on every measured point at its time', () => {
  const t = new MockTimeline(), line = node('path'), dot = node('circle');
  const pts = [{ t: 1, x: 0, y: 0 }, { t: 1.5, x: 0, y: 30 }, { t: 2, x: 40, y: 30 }];
  assert.equal(a.trailIn(t, { paths: [line], head: dot }, pts, { smooth: 0 }), 2);
  assert.equal(line.attrs.d, 'M0.0 0.0 L0.0 30.0 L40.0 30.0');
  const segs = t.calls.filter(c => c[1][0] === line && c[0] === 'fromTo' && 'strokeDashoffset' in c[3] && c[3].duration > 0.01);
  assert.deepEqual(segs.map(c => [c[4], c[2].strokeDashoffset, c[3].strokeDashoffset, c[3].ease]), [[1, 70, 40, 'none'], [1.5, 40, 0, 'none']]);
  const moves = t.calls.filter(c => c[0] === 'fromTo' && c[1] === dot && 'x' in c[3]);
  assert.deepEqual(moves.map(c => [c[4], c[3].x, c[3].y]), [[1, 0, 30], [1.5, 40, 30]]);
  assert.ok(t.calls.some(c => c[0] === 'fromTo' && c[1] === dot && c[3].autoAlpha === 0 && c[4] === 2), 'head leaves where the measurements stop');
});

test('refuses invented trajectories, bad timing and timed clips', () => {
  assert.throws(() => a.trailIn(new MockTimeline(), { paths: [node('path')] }, [{ t: 1, x: 0, y: 0 }]), /two measured points/);
  assert.throws(() => a.sketchOut(new MockTimeline(), sketch(), -1), /nonnegative/);
  assert.throws(() => a.trailIn(null, { paths: [node('path')] }, []), /GSAP timeline/);
  assert.throws(() => a.markerIn(new MockTimeline(), { ring: node('circle', { 'data-start': '2', stroke: '#fff' }) }, 1), /timed HyperFrames clip/);
});

test('marker draws ring, then line, then label', () => {
  const t = new MockTimeline(), ring = node('circle', { stroke: '#3b82f6' }), lead = node('path', { stroke: '#fff' }), label = node('div');
  const end = a.markerIn(t, { ring, lead, label }, 5, { duration: 0.3 });
  const at = el => t.calls.find(c => c[0] === 'fromTo' && (c[1] === el || c[1][0] === el))[4];
  assert.ok(at(ring) < at(lead) && at(lead) < at(label));
  assert.ok(Math.abs(end - (5 + 0.21 + 0.18 + 0.3)) < 1e-9);
  assert.equal(a.markerOut(t, { ring, lead, label }, 7), 7.22);
});

test('a marker never starts leaving before it has finished appearing', () => {
  const t = new MockTimeline(), ring = node('circle', { stroke: '#3b82f6' }), label = node('div');
  const shown = a.markerIn(t, { ring, label }, 5, { duration: 0.3 });
  const end = a.markerOut(t, { ring, label }, 5.1, { duration: 0.2 });
  assert.ok(Math.abs(end - (shown + 0.2)) < 1e-9);
});
