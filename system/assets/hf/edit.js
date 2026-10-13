/* HFEdit: seek-safe editing moves for HyperFrames + GSAP 3: reframing, full-screen graphic cards, fly-to transitions and
   exercise/section titles. Browser global: HFEdit. Times are absolute composition seconds; each call returns its end time.
   Target CHILDREN of HyperFrames clips (or non-clip wrappers around them), never a timed clip itself.

   punch(tl, targets, at, { scale, anchor, keep, frame, in, hold, out })  controlled punch-in; never crops `keep`
   cardIn(tl, card, at, { from, duration }) / cardOut(tl, card, at, { to, duration })  full-screen card mask wipes
   flyTo(tl, el, at, { from, duration })  FLIP move: el sits at its final layout and arrives from `from` (x, y, scale)
   titleIn(tl, title, at, opts) / titleOut(tl, title, at, opts)  mask-reveal titles built as:
     <div class="t"><div class="t-top"><span class="t-num">01</span><i class="t-rule"></i></div><div class="t-mask"><div class="t-text">Muscle snatch</div></div></div>
     (.t-mask needs overflow:hidden; the text rises into view as one line, never letter by letter;
      mark .t-text with data-layout-allow-overflow so layout checks accept the masked travel)
*/
(function (root) {
  'use strict';
  function ensure(tl) { if (!tl || typeof tl.fromTo !== 'function') throw new TypeError('HFEdit expects a GSAP timeline'); }
  function time(at) { if (!Number.isFinite(at) || at < 0) throw new RangeError('at must be a nonnegative number of seconds'); return at; }
  function els(target, scope) {
    if (target == null) return [];
    if (typeof target === 'string') return Array.from((scope || document).querySelectorAll(target));
    if (Array.isArray(target)) return target.flatMap(t => els(t, scope));
    if (target.nodeType) return [target];
    return typeof target.length === 'number' ? Array.from(target) : [];
  }
  function notClip(list) {
    for (const el of list) if (el.hasAttribute && (el.hasAttribute('data-start') || el.hasAttribute('data-composition-id'))) throw new Error('HFEdit: ' + (el.id ? '#' + el.id : 'target') + ' is a timed HyperFrames clip; animate a wrapper or child instead');
    return list;
  }
  function initial(tl, list, vars) { if (root.gsap && root.gsap.set) root.gsap.set(list, vars); else tl.set(list, vars, 0); }
  const one = (sel, scope) => els(sel, scope)[0];

  /* Largest scale <= wanted that keeps the `keep` box fully inside the frame when scaling around `anchor`. */
  function safeScale(wanted, anchor, keep, frame) {
    if (!keep) return wanted;
    let s = wanted;
    const lim = (o, lo, hi, size) => {
      if (lo < o) s = Math.min(s, o / (o - lo));
      if (hi > o) s = Math.min(s, (size - o) / (hi - o));
    };
    lim(anchor.x, keep.x, keep.x + keep.w, frame.w);
    lim(anchor.y, keep.y, keep.y + keep.h, frame.h);
    return Math.max(1, s);
  }

  const HFEdit = {
    safeScale,
    /* Controlled punch-in on footage wrappers (and any annotation layer that must stay registered to the footage):
       eases in to `scale` around `anchor`, holds, eases back to 1. `keep` (px box) is never cropped. */
    punch(tl, targets, at, { scale = 1.08, anchor = { x: 540, y: 960 }, keep, frame = { w: 1080, h: 1920 }, in: inDur = 0.6, hold = 0.6, out = 0.35, ease = 'power2.inOut', back = true } = {}) {
      ensure(tl); time(at); const list = notClip(els(targets));
      const s = safeScale(scale, anchor, keep, frame);
      initial(tl, list, { transformOrigin: `${anchor.x}px ${anchor.y}px`, scale: 1 });
      tl.fromTo(list, { scale: 1 }, { scale: s, duration: inDur, ease, immediateRender: false }, at);
      if (!back) return at + inDur;
      tl.fromTo(list, { scale: s }, { scale: 1, duration: out, ease, immediateRender: false }, at + inDur + hold);
      return at + inDur + hold + out;
    },
    /* Full-screen graphic card: a mask wipe in from one edge (no texture, no flash). */
    cardIn(tl, card, at, { from = 'bottom', duration = 0.38, ease = 'power3.inOut' } = {}) {
      ensure(tl); time(at); const el = notClip(els(card));
      const start = { bottom: 'inset(100% 0% 0% 0%)', top: 'inset(0% 0% 100% 0%)', left: 'inset(0% 100% 0% 0%)', right: 'inset(0% 0% 0% 100%)' }[from];
      if (!start) throw new Error('from must be top/bottom/left/right');
      initial(tl, el, { clipPath: start, autoAlpha: 1 });
      tl.fromTo(el, { clipPath: start }, { clipPath: 'inset(0% 0% 0% 0%)', duration, ease, immediateRender: false }, at);
      return at + duration;
    },
    cardOut(tl, card, at, { to = 'top', duration = 0.42, ease = 'power3.inOut' } = {}) {
      ensure(tl); time(at); const el = notClip(els(card));
      const end = { top: 'inset(0% 0% 100% 0%)', bottom: 'inset(100% 0% 0% 0%)', left: 'inset(0% 100% 0% 0%)', right: 'inset(0% 0% 0% 100%)' }[to];
      if (!end) throw new Error('to must be top/bottom/left/right');
      tl.fromTo(el, { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: end, duration, ease, immediateRender: false }, at);
      return at + duration;
    },
    /* FLIP: `el` is laid out where it ends; it starts at `from` (offset px and scale, origin top-left) and travels home.
       Use it to carry an illustration from a graphic card into its place over the footage. */
    flyTo(tl, el, at, { from = { x: 0, y: 0, scale: 1 }, duration = 0.55, ease = 'power3.inOut' } = {}) {
      ensure(tl); time(at); const list = notClip(els(el));
      initial(tl, list, { x: from.x, y: from.y, scale: from.scale ?? 1, transformOrigin: '0 0' });
      tl.fromTo(list, { x: from.x, y: from.y, scale: from.scale ?? 1 }, { x: 0, y: 0, scale: 1, duration, ease, immediateRender: false }, at);
      return at + duration;
    },
    /* The offset that makes `el` (at its layout box) appear over `slot` (another element's box), for flyTo({ from }). */
    offsetTo(el, slot) {
      const a = one(el).getBoundingClientRect(), b = one(slot).getBoundingClientRect();
      return { x: b.left - a.left, y: b.top - a.top, scale: b.width / a.width };
    },
    /* Title reveal: the rule draws, the number slides in, the title rises out of its mask. */
    titleIn(tl, title, at, { rule = 0.4, rise = 0.5, stagger = 0.08, ease = 'power3.out' } = {}) {
      ensure(tl); time(at); const t = one(title); notClip([t]);
      const num = els('.t-num', t), line = els('.t-rule', t), text = els('.t-text', t);
      // Hidden until its reveal (a parked line outside its mask still counts as visible text to layout checks).
      initial(tl, t, { autoAlpha: 0 });
      tl.fromTo(t, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01, immediateRender: false }, at);
      initial(tl, line, { scaleX: 0, transformOrigin: '0% 50%' });
      initial(tl, num, { autoAlpha: 0, x: -14 });
      initial(tl, text, { yPercent: 105 });
      tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: rule, ease, immediateRender: false }, at);
      tl.fromTo(num, { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: rule, ease, immediateRender: false }, at);
      tl.fromTo(text, { yPercent: 105 }, { yPercent: 0, duration: rise, ease, immediateRender: false }, at + stagger);
      return at + stagger + rise;
    },
    /* Title exit: the title leaves upward through its mask, number and rule fade with it. */
    titleOut(tl, title, at, { duration = 0.32, ease = 'power2.in' } = {}) {
      ensure(tl); time(at); const t = one(title);
      const text = els('.t-text', t), rest = [...els('.t-num', t), ...els('.t-rule', t)];
      tl.fromTo(text, { yPercent: 0 }, { yPercent: -105, duration, ease, immediateRender: false }, at);
      tl.fromTo(rest, { autoAlpha: 1 }, { autoAlpha: 0, duration, ease, immediateRender: false }, at);
      tl.fromTo(t, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.01, immediateRender: false }, at + duration);
      return at + duration;
    },
  };
  root.HFEdit = HFEdit;
})(typeof window !== 'undefined' ? window : globalThis);
