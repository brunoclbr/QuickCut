/* HFAnnotate: seek-safe annotation components for HyperFrames + GSAP 3, for real footage.
   Browser global: HFAnnotate. Times are absolute composition seconds on the paused timeline; each call returns its end time.
   Put the overlay inside a normal HyperFrames clip and pass CHILDREN of it (HyperFrames owns a clip's visibility).

   1. Sketch: hand-drawn reveal of an inline SVG drawing (progressive strokes, body parts in sequence).
      sketchIn(tl, svg, at, { order, part, overlap })  sketchEmphasis(tl, svg, at, { keep, dim, hold })  sketchOut(tl, svg, at)
      Parts are <g data-part="name"> groups inside the SVG; without groups the whole drawing is one part.
   2. Trail: a line that follows MEASURED positions (bar path, body travel). Never invent a trajectory: pass tracked or
      hand-read keyframes [{ t, x, y }] in composition time and px. trailIn(tl, { paths, head }, points)  trailOut(tl, { paths, head }, at)
   3. Marker: a positional marker (ring around a measured point, optional leader line and label).
      markerIn(tl, { ring, lead, label }, at)  markerOut(tl, { ring, lead, label }, at)
   4. Handoff: handoff(tl, outSvg, inSvg, at): one illustration retracts while the next draws (a section transition).
   5. Tracked callout: calloutIn(tl, { group, ring, lead, label }, at, { points }) / calloutOut: a marker that rides
      measured points via follow(tl, group, points).
*/
(function (root) {
  'use strict';
  const ease = { draw: 'power2.inOut', in: 'power2.out', out: 'power2.in' };
  function ensure(tl) { if (!tl || typeof tl.fromTo !== 'function') throw new TypeError('HFAnnotate expects a GSAP timeline'); }
  function time(at) { if (!Number.isFinite(at) || at < 0) throw new RangeError('at must be a nonnegative number of seconds'); return at; }
  function els(target, scope) {
    if (target == null) return [];
    if (typeof target === 'string') return Array.from((scope || document).querySelectorAll(target));
    if (Array.isArray(target)) return target.flatMap(t => els(t, scope));
    if (target.nodeType) return [target];
    return typeof target.length === 'number' ? Array.from(target) : [];
  }
  function notClip(list) {
    for (const el of list) if (el.hasAttribute && (el.hasAttribute('data-start') || el.hasAttribute('data-composition-id'))) throw new Error('HFAnnotate: ' + (el.id ? '#' + el.id : 'target') + ' is a timed HyperFrames clip; animate a child element inside it instead');
    return list;
  }
  /* Initial state outside the timeline: a zero-length tl.set at 0 does not render while the playhead sits at 0. */
  function initial(tl, list, vars) { if (root.gsap && root.gsap.set) root.gsap.set(list, vars); else tl.set(list, vars, 0); }
  const strokable = el => typeof el.getTotalLength === 'function' && el.getAttribute('stroke') && el.getAttribute('stroke') !== 'none';
  /* Strokes are normalised with pathLength="1", so dash maths never depends on measuring geometry at load (a hidden
     clip can report a zero length). Undrawn strokes park their dash entirely off the path: a round line cap would
     otherwise paint a dot where the dash ends, and some render paths ignore visibility on SVG children. */
  function norm(s) { if (s.setAttribute) s.setAttribute('pathLength', '1'); return s; }
  function park(tl, s) { norm(s); initial(tl, s, { strokeDasharray: '1 3', strokeDashoffset: 2 }); return 1; }
  function draw(tl, s, at, duration, easing) {
    tl.fromTo(s, { strokeDashoffset: 2 }, { strokeDashoffset: 1, duration: 0.001, immediateRender: false }, at);
    tl.fromTo(s, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration, ease: easing, immediateRender: false }, at + 0.001);
  }
  function partsOf(svg) {
    const groups = Array.from(svg.querySelectorAll('[data-part]'));
    return groups.length ? groups : [svg];
  }
  function strokesIn(node) { return Array.from(node.querySelectorAll('path, ellipse, circle, line, polyline, polygon, rect')).filter(strokable); }
  function fillsIn(node) { return Array.from(node.querySelectorAll('circle, ellipse, path')).filter(el => !strokable(el) || (el.getAttribute('fill') && el.getAttribute('fill') !== 'none')); }

  const HFAnnotate = {
    /* Draws a sketch part by part: every stroke of a part reveals along its own path, parts follow each other with a
       slight overlap, like a hand drawing. Filled dots (joints) fade in with their part. */
    sketchIn(tl, svg, at, { order, part = 0.24, overlap = 0.45, only } = {}) {
      ensure(tl); time(at); svg = els(svg)[0]; if (!svg) throw new Error('sketchIn: svg not found'); notClip([svg]);
      let parts = partsOf(svg);
      if (order) parts = order.map(name => svg.querySelector(`[data-part="${name}"]`)).filter(Boolean);
      if (only) parts = parts.filter(p => only.includes(p.dataset.part));
      initial(tl, svg, { autoAlpha: 1 });
      // Everything starts undrawn, including parts left for sketchPart (e.g. the arrow drawn with the movement).
      for (const s of strokesIn(svg)) park(tl, s);
      initial(tl, Array.from(svg.querySelectorAll('circle')).filter(c => c.getAttribute('fill') && c.getAttribute('fill') !== 'none'), { opacity: 0 });
      let t = at;
      for (const p of parts) {
        const strokes = strokesIn(p), fills = fillsIn(p).filter(f => !strokes.includes(f) || f.tagName === 'circle');
        for (const s of strokes) { park(tl, s); draw(tl, s, t, part, ease.draw); }
        const dots = fills.filter(f => f.tagName === 'circle');
        if (dots.length) { initial(tl, dots, { opacity: 0 }); tl.fromTo(dots, { opacity: 0 }, { opacity: 1, duration: part * 0.6, ease: ease.in, immediateRender: false }, t + part * 0.4); }
        t += part * (1 - overlap);
      }
      return t + part * overlap;
    },
    /* Draws one named part (e.g. the drawing's own arrow) over an exact window, so it can move WITH the footage. */
    sketchPart(tl, svg, name, at, duration, { easing = 'power1.inOut' } = {}) {
      ensure(tl); time(at); svg = els(svg)[0];
      const p = svg && svg.querySelector(`[data-part="${name}"]`); if (!p) throw new Error('sketchPart: no part ' + name);
      for (const s of strokesIn(p)) { park(tl, s); draw(tl, s, at, duration, easing); }
      return at + duration;
    },
    /* Emphasis without scaling or colour flashes: the named parts stay at full strength while the rest recedes, then everything returns. */
    sketchEmphasis(tl, svg, at, { keep = [], dim = 0.32, hold = 0.6, fade = 0.2 } = {}) {
      ensure(tl); time(at); svg = els(svg)[0];
      const rest = partsOf(svg).filter(p => !keep.includes(p.dataset.part));
      tl.fromTo(rest, { opacity: 1 }, { opacity: dim, duration: fade, ease: ease.in, immediateRender: false }, at);
      tl.fromTo(rest, { opacity: dim }, { opacity: 1, duration: fade, ease: ease.in, immediateRender: false }, at + fade + hold);
      return at + fade * 2 + hold;
    },
    /* Clean exit: every stroke retracts along its path in the drawing direction while the drawing fades. */
    sketchOut(tl, svg, at, { duration = 0.36 } = {}) {
      ensure(tl); time(at); svg = els(svg)[0];
      for (const s of strokesIn(svg)) { norm(s); tl.fromTo(s, { strokeDashoffset: 0 }, { strokeDashoffset: -2, duration, ease: ease.out, immediateRender: false }, at); }
      tl.fromTo(svg, { autoAlpha: 1 }, { autoAlpha: 0, duration, ease: ease.out, immediateRender: false }, at);
      return at + duration;
    },

    /* Trail through measured points. Every path in `paths` gets the same geometry (e.g. a dark edge under a light line);
       the line's tip sits exactly on each measured point at its time (linear between points), and `head` rides the tip. */
    trailIn(tl, { paths, head }, points, { smooth = 1, fadeHead = 0.12, rotateHead = false, keepHead = false } = {}) {
      ensure(tl); const list = notClip(els(paths)); const hd = els(head)[0];
      if (!list.length) throw new Error('trailIn: no path'); if (!Array.isArray(points) || points.length < 2) throw new Error('trailIn: needs at least two measured points');
      const pts = points.map((p, i) => {
        if (!smooth || i === 0 || i === points.length - 1) return { ...p };
        const a = points[i - 1], b = points[i + 1];
        return { t: p.t, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
      });
      pts.forEach(p => time(p.t));
      const d = 'M' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const L = Math.max(1, cum[cum.length - 1]);
      const P = 40;
      // The gap clears the path by P at both ends, so no round cap is painted before or after the line.
      for (const p of list) { p.setAttribute('d', d); initial(tl, p, { strokeDasharray: `${L} ${L + 2 * P}`, strokeDashoffset: L + P, autoAlpha: 1 }); }
      tl.fromTo(list, { strokeDashoffset: L + P }, { strokeDashoffset: L, duration: 0.001, immediateRender: false }, pts[0].t);
      const angle = i => Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x) * 180 / Math.PI;
      if (hd) {
        initial(tl, hd, { x: pts[0].x, y: pts[0].y, autoAlpha: 0, rotation: rotateHead ? angle(0) : 0, transformOrigin: '50% 50%' });
        tl.fromTo(hd, { autoAlpha: 0 }, { autoAlpha: 1, duration: fadeHead, ease: ease.in, immediateRender: false }, pts[0].t);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const dur = Math.max(0.001, pts[i + 1].t - pts[i].t);
        tl.fromTo(list, { strokeDashoffset: L - cum[i] }, { strokeDashoffset: L - cum[i + 1], duration: dur, ease: 'none', immediateRender: false }, pts[i].t);
        if (hd) {
          const from = { x: pts[i].x, y: pts[i].y }, to = { x: pts[i + 1].x, y: pts[i + 1].y, duration: dur, ease: 'none', immediateRender: false };
          if (rotateHead) { from.rotation = angle(i); to.rotation = angle(i); }
          tl.fromTo(hd, from, to, pts[i].t);
        }
      }
      // Measurements stop where the object can no longer be seen, so by default the head leaves there too.
      const last = pts[pts.length - 1].t;
      if (hd && !keepHead) tl.fromTo(hd, { autoAlpha: 1 }, { autoAlpha: 0, duration: fadeHead, ease: ease.out, immediateRender: false }, last);
      return last;
    },
    trailOut(tl, { paths, head }, at, { duration = 0.3 } = {}) {
      ensure(tl); time(at);
      const list = els(paths);
      tl.fromTo(list, { autoAlpha: 1 }, { autoAlpha: 0, duration, ease: ease.out, immediateRender: false }, at);
      return at + duration;
    },

    /* Positional marker: the ring draws around the measured point, then the leader line, then the label rises in. */
    markerIn(tl, { ring, lead, label }, at, { duration = 0.34, rise = 10, labelDuration = 0.3 } = {}) {
      ensure(tl); time(at);
      const r = notClip(els(ring)), l = notClip(els(lead)), lb = notClip(els(label));
      let t = at;
      for (const s of [...r, ...l]) { park(tl, s); initial(tl, s, { autoAlpha: 1 }); }
      if (r.length) { initial(tl, r, { scale: 0.9, transformOrigin: '50% 50%' }); r.forEach(s => draw(tl, s, t, duration, ease.in)); tl.fromTo(r, { scale: 0.9 }, { scale: 1, duration, ease: ease.in, immediateRender: false }, t); t += duration * 0.7; }
      if (l.length) { l.forEach(s => draw(tl, s, t, duration * 0.8, ease.draw)); t += duration * 0.6; }
      if (lb.length) { initial(tl, lb, { autoAlpha: 0, y: rise }); tl.fromTo(lb, { autoAlpha: 0, y: rise }, { autoAlpha: 1, y: 0, duration: labelDuration, ease: ease.in, immediateRender: false }, t); t += labelDuration; }
      for (const el of [...r, ...l, ...lb]) el.__hfShownAt = t;
      return t;
    },
    markerOut(tl, { ring, lead, label }, at, { duration = 0.22 } = {}) {
      ensure(tl); time(at);
      const list = [...els(ring), ...els(lead), ...els(label)];
      // Leaving before the entrance has finished would let the entrance win again afterwards: start the exit no earlier.
      const shown = Math.max(0, ...list.map(el => el.__hfShownAt || 0));
      if (shown > at) { if (root.console) console.warn(`HFAnnotate.markerOut: moved from ${at} to ${shown}, after the marker finished appearing`); at = shown; }
      tl.fromTo(list, { autoAlpha: 1 }, { autoAlpha: 0, duration, ease: ease.out, immediateRender: false }, at);
      return at + duration;
    },

    /* Illustration handoff: the outgoing drawing retracts while the incoming one draws in the same place, so the
       drawings themselves carry the transition between two sections. Returns when the incoming drawing is complete. */
    handoff(tl, outSvg, inSvg, at, { delay = 0.1, out = {}, inOpts = {} } = {}) {
      ensure(tl); time(at);
      HFAnnotate.sketchOut(tl, outSvg, at, out);
      return HFAnnotate.sketchIn(tl, inSvg, at + delay, inOpts);
    },
    /* Keeps an annotation group on measured positions [{ t, x, y }] (linear between points, held before and after). */
    follow(tl, target, points) {
      ensure(tl); const list = notClip(els(target));
      if (!Array.isArray(points) || !points.length) throw new Error('follow: needs measured points');
      points.forEach(p => time(p.t));
      initial(tl, list, { x: points[0].x, y: points[0].y });
      for (let i = 0; i < points.length - 1; i++) tl.fromTo(list, { x: points[i].x, y: points[i].y }, { x: points[i + 1].x, y: points[i + 1].y, duration: Math.max(0.001, points[i + 1].t - points[i].t), ease: 'none', immediateRender: false }, points[i].t);
      return points[points.length - 1].t;
    },
    /* Motion-tracked callout: a marker (ring, leader, label) drawn inside a <g> that rides measured points.
       Draw the ring, leader and label around 0,0 inside the group; pass points: null for a fixed position. */
    calloutIn(tl, { group, ring, lead, label }, at, { points, ...marker } = {}) {
      ensure(tl); time(at);
      if (points && group) HFAnnotate.follow(tl, group, points);
      return HFAnnotate.markerIn(tl, { ring, lead, label }, at, marker);
    },
    calloutOut(tl, parts, at, opts) { return HFAnnotate.markerOut(tl, parts, at, opts); },
  };
  root.HFAnnotate = HFAnnotate;
})(typeof window !== 'undefined' ? window : globalThis);
