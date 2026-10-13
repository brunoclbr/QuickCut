import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { Edit, ambience, narration } from '../compose.mjs';

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../hf/edit.js', import.meta.url), 'utf8'), context);
const { HFEdit: h } = context.window;
class MockTimeline {
  constructor() { this.calls = []; }
  set(...x) { this.calls.push(['set', ...x]); return this; }
  fromTo(...x) { this.calls.push(['fromTo', ...x]); return this; }
}
const el = (attrs = {}, kids = {}) => ({ nodeType: 1, attrs, hasAttribute: k => k in attrs, querySelectorAll: sel => kids[sel] || [] });

test('punch never crops the keep box', () => {
  const frame = { w: 1080, h: 1920 };
  // Anchored near the top: the box reaching y=55 limits the scale.
  const s = h.safeScale(1.2, { x: 652, y: 894 }, { x: 300, y: 55, w: 420, h: 1060 }, frame);
  assert.ok(s < 1.07 && s > 1.05, String(s));
  // The kept box stays inside the frame at that scale.
  assert.ok(894 - (894 - 55) * s >= -1e-9);
  assert.equal(h.safeScale(1.08, { x: 540, y: 960 }, null, frame), 1.08);
  const t = new MockTimeline(), cam = el();
  assert.ok(Math.abs(h.punch(t, [cam], 2, { scale: 1.08, in: 0.5, hold: 1, out: 0.3 }) - 3.8) < 1e-9);
  const tweens = t.calls.filter(c => c[0] === 'fromTo');
  assert.deepEqual(tweens.map(c => [c[4], c[2].scale, c[3].scale]), [[2, 1, 1.08], [3.5, 1.08, 1]]);
});

test('title reveals number, rule and one-line text, then exits through the mask', () => {
  const num = el(), rule = el(), text = el();
  const title = el({}, { '.t-num': [num], '.t-rule': [rule], '.t-text': [text] });
  const t = new MockTimeline();
  assert.ok(Math.abs(h.titleIn(t, title, 3, { rule: 0.4, rise: 0.5, stagger: 0.08 }) - 3.58) < 1e-9);
  const textIn = t.calls.find(c => c[0] === 'fromTo' && c[1][0] === text);
  assert.deepEqual([textIn[2].yPercent, textIn[3].yPercent, textIn[4]], [105, 0, 3.08]);
  assert.ok(Math.abs(h.titleOut(t, title, 6, { duration: 0.3 }) - 6.3) < 1e-9);
  assert.ok(t.calls.some(c => c[1] === title && c[3].autoAlpha === 0 && Math.abs(c[4] - 6.3) < 1e-9), 'hidden after its exit');
});

test('cards wipe with masks and refuse timed clips', () => {
  const t = new MockTimeline(), card = el();
  assert.equal(h.cardIn(t, card, 1.8, { from: 'bottom', duration: 0.4 }), 2.2);
  assert.equal(h.cardOut(t, card, 3, { to: 'top', duration: 0.4 }), 3.4);
  assert.match(t.calls.find(c => c[0] === 'fromTo')[2].clipPath, /^inset\(100%/);
  assert.throws(() => h.cardIn(t, el({ 'data-start': '0' }), 1), /timed HyperFrames clip/);
  assert.throws(() => h.cardIn(t, card, 1, { from: 'diagonal' }), /top\/bottom/);
});

test('Edit solves anchored in-points, rates and freezes', () => {
  const e = new Edit();
  e.shot('a', { from: 10, dur: 1 });
  e.gap('card', 1);
  const m = e.shot('m', { anchor: { src: 20, at: 3.5 }, to: 20 });
  assert.deepEqual([m.start, m.end, m.from], [2, 3.5, 18.5]);
  e.freeze('f', { src: 20, file: 'f.mp4', dur: 0.5 });
  const fast = e.shot('fast', { from: 20, to: 22, rate: 2.5 });
  assert.ok(Math.abs(fast.end - fast.start - 0.8) < 1e-9);
  assert.equal(e.at('fast', 21), 4.4);
  assert.equal(e.duration, 4.8);
  assert.match(e.videos(), /data-playback-rate="2.5"/);
  assert.throws(() => new Edit().shot('x', { anchor: { src: 5, at: 0 }, to: 4 }), /non-positive/);
});

test('ambience stays continuous and keeps one sound in sync; narration moves its words', () => {
  const a = ambience({ duration: 17, sync: { src: 35, at: 16.9 }, points: [[15, 0.3]] });
  assert.match(a, /data-start="0" data-duration="17" data-media-start="18.1"/);
  assert.match(a, /"t":15,"v":0.3/);
  const n = narration({ take: 'v', file: 'x.mp3', words: [{ text: 'a', start: 1, end: 1.2 }, { text: 'b', start: 6, end: 6.3 }], segments: [{ from: 0, to: 5, shift: 0 }, { from: 5, to: 9, shift: 0.8 }] });
  assert.deepEqual(n.words.map(w => w.start), [1, 6.8]);
  assert.equal((n.audio.match(/<audio/g) || []).length, 2);
});
