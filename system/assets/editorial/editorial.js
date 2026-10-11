/* HFEditorial — original, seek-safe choreography for HyperFrames + GSAP 3.
   Browser global: HFEditorial. No dependencies beyond GSAP, no generated footage.
   All timings absolute seconds. Animations belong on HyperFrames' paused timeline.
   Put each visual inside a normal HyperFrames clip (data-start/data-duration) and pass a CHILD of that clip:
   HyperFrames owns a clip's visibility, and these fades write visibility (autoAlpha).
*/
(function (root) {
  'use strict';
  function ensureTimeline(tl) { if (!tl || typeof tl.fromTo !== 'function' || typeof tl.set !== 'function') throw new TypeError('HFEditorial expects a GSAP timeline'); }
  function time(at) { if (!Number.isFinite(at) || at < 0) throw new RangeError('at must be a nonnegative number of seconds'); return at; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function dirVector(direction, distance) {
    switch (direction) { case 'left': return { x: -distance, y: 0 }; case 'right': return { x: distance, y: 0 }; case 'top': return { x: 0, y: -distance }; case 'bottom': return { x: 0, y: distance }; default: throw new Error('Direction must be left/right/top/bottom'); }
  }
  const invisible = { autoAlpha: 0 };
  const visible = { autoAlpha: 1 };
  /* `hyperframes check` only lints inline scripts, so the clip rule is enforced here. */
  function nodes(target) {
    if (typeof document === 'undefined' || target == null) return [];
    if (Array.isArray(target)) return target.flatMap(nodes);
    if (typeof target === 'string') return Array.from(document.querySelectorAll(target));
    if (target.nodeType) return [target];
    return typeof target.length === 'number' ? Array.from(target) : [];
  }
  function notClip(target) {
    for (const el of nodes(target)) if (el && el.hasAttribute && (el.hasAttribute('data-start') || el.hasAttribute('data-composition-id'))) throw new Error('HFEditorial: ' + (el.id ? '#' + el.id : 'target') + ' is a timed HyperFrames clip; animate a child element inside it instead');
    return target;
  }
  /* Initial hidden state goes outside the timeline: a zero-length tl.set at 0 does not render while the playhead sits at 0. */
  function hide(tl, target, extra) {
    notClip(target); const vars = Object.assign({}, invisible, extra);
    if (root.gsap && typeof root.gsap.set === 'function') root.gsap.set(target, vars); else tl.set(target, vars, 0);
  }
  const HFEditorial = {
    /* Floating genuine screenshot or diagram. Lasts until separately exited. */
    proofIn(tl, target, at, { direction = 'bottom', distance = 50, scale = .94, duration = .46 } = {}) {
      ensureTimeline(tl); time(at); const { x, y } = dirVector(direction, distance);
      hide(tl, target);
      tl.fromTo(target, { x, y, scale, autoAlpha: 0, rotation: 0 }, { x: 0, y: 0, scale: 1, autoAlpha: 1, duration, ease: 'power3.out', immediateRender: false }, at);
      return at + duration;
    },
    proofOut(tl, target, at, { direction = 'top', distance = 18, duration = .28 } = {}) {
      ensureTimeline(tl); time(at); notClip(target); const { x, y } = dirVector(direction, distance);
      tl.fromTo(target, { x: 0, y: 0, scale: 1, autoAlpha: 1 }, { x, y, scale: .985, autoAlpha: 0, duration, ease: 'power2.in', immediateRender: false }, at);
      return at + duration;
    },
    /* Presenter video enters as a small, controlled second visual; no face retouching. */
    pipIn(tl, target, at, { direction = 'right', distance = 100, duration = .52, scale = .92 } = {}) {
      ensureTimeline(tl); time(at); const { x, y } = dirVector(direction, distance);
      hide(tl, target);
      tl.fromTo(target, { x, y, scale, autoAlpha: 0 }, { x: 0, y: 0, scale: 1, autoAlpha: 1, duration, ease: 'power3.out', immediateRender: false }, at);
      return at + duration;
    },
    /* Geometric reveal: mask opens left-to-right or top-to-bottom; no flashy wipe texture. */
    wipeIn(tl, target, at, { direction = 'left', duration = .42 } = {}) {
      ensureTimeline(tl); time(at);
      const from = { left: 'inset(0 100% 0 0)', right: 'inset(0 0 0 100%)', top: 'inset(0 0 100% 0)', bottom: 'inset(100% 0 0 0)' }[direction];
      if (!from) throw new Error('Direction must be left/right/top/bottom');
      hide(tl, target);
      tl.set(target, visible, at);
      tl.fromTo(target, { clipPath: from }, { clipPath: 'inset(0 0% 0 0)', duration, ease: 'power2.inOut', immediateRender: false }, at);
      return at + duration;
    },
    /* Actual UI click/focus: dim surrounding screen, reveal non-glowing outline. */
    focusIn(tl, dimLayer, focusOutline, at, { dim = .42, duration = .24 } = {}) {
      ensureTimeline(tl); time(at);
      hide(tl, [dimLayer, focusOutline]);
      tl.fromTo(dimLayer, { opacity: 0, visibility: 'hidden' }, { opacity: clamp(dim, 0, .72), visibility: 'visible', duration, ease: 'power1.out', immediateRender: false }, at);
      tl.fromTo(focusOutline, { autoAlpha: 0, scale: .985 }, { autoAlpha: 1, scale: 1, duration, ease: 'power2.out', immediateRender: false }, at + .05);
      return at + duration + .05;
    },
    focusOut(tl, dimLayer, focusOutline, at, { dim = .42, duration = .22 } = {}) {
      ensureTimeline(tl); time(at); notClip([dimLayer, focusOutline]);
      tl.fromTo(dimLayer, { opacity: clamp(dim, 0, .72), visibility: 'visible' }, { opacity: 0, visibility: 'hidden', duration, ease: 'power1.in', immediateRender: false }, at);
      tl.fromTo(focusOutline, { autoAlpha: 1 }, { autoAlpha: 0, duration, ease: 'power1.in', immediateRender: false }, at);
      return at + duration;
    },
    /* Reveal sequential real steps; not for arbitrary constant-rate decoration. */
    stepsIn(tl, targets, at, { interval = .44, duration = .3, rise = 12 } = {}) {
      ensureTimeline(tl); time(at); const nodes = Array.from(targets);
      nodes.forEach((node, i) => { hide(tl, node); tl.fromTo(node, { y: rise, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration, ease: 'power2.out', immediateRender: false }, at + i * interval); });
      return at + Math.max(0, nodes.length - 1) * interval + duration;
    },
    /* Before/after split: operate on a foreground panel only; comparison must be honest. */
    comparisonReveal(tl, foreground, divider, at, { duration = .68 } = {}) {
      ensureTimeline(tl); time(at);
      hide(tl, [foreground, divider]);
      tl.set(foreground, visible, at);
      tl.fromTo(foreground, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration, ease: 'power2.inOut', immediateRender: false }, at);
      tl.fromTo(divider, { autoAlpha: 0 }, { autoAlpha: 1, duration: .16, ease: 'power1.out', immediateRender: false }, at + Math.max(.02, duration - .16));
      return at + duration;
    },
    /* Match expansion of a real screenshot thumbnail into the same screenshot full frame.
       The transformed element must use a full-frame box; fromEl is the existing thumbnail.
       Do not use with unrelated imagery (would be a false match cut). */
    matchExpand(tl, thumbnail, fullFrame, at, { duration = .56, radius = 22 } = {}) {
      ensureTimeline(tl); time(at);
      const a = typeof thumbnail === 'string' ? document.querySelector(thumbnail) : thumbnail;
      const b = typeof fullFrame === 'string' ? document.querySelector(fullFrame) : fullFrame;
      if (!a || !b) throw new Error('matchExpand: thumbnail or full-frame node not found');
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      if (!ar.width || !ar.height || !br.width || !br.height) throw new Error('matchExpand: nonzero dimensions required');
      notClip(a); hide(tl, b, { transformOrigin: 'top left' });
      tl.fromTo(b,
        { autoAlpha: 1, x: ar.left - br.left, y: ar.top - br.top, scaleX: ar.width / br.width, scaleY: ar.height / br.height, borderRadius: radius },
        { autoAlpha: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: 0, duration, ease: 'power3.inOut', immediateRender: false }, at);
      tl.fromTo(a, { autoAlpha: 1 }, { autoAlpha: 0, duration: .08, immediateRender: false }, at + .06);
      return at + duration;
    },
    /* Connector path drawn at the instant it becomes instructive. */
    drawLine(tl, svgPath, at, { duration = .35 } = {}) {
      ensureTimeline(tl); time(at);
      const el = typeof svgPath === 'string' ? document.querySelector(svgPath) : svgPath;
      if (!el || typeof el.getTotalLength !== 'function') throw new Error('drawLine expects an SVG path');
      const length = el.getTotalLength();
      tl.set(el, { strokeDasharray: length, strokeDashoffset: length }, 0);
      tl.fromTo(el, { strokeDashoffset: length }, { strokeDashoffset: 0, duration, ease: 'power2.out', immediateRender: false }, at);
      return at + duration;
    },
  };
  root.HFEditorial = HFEditorial;
})(typeof window !== 'undefined' ? window : globalThis);
