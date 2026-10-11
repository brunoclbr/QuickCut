// Seek-safe GSAP motion presets for HyperFrames compositions.
// Every preset adds explicit fromTo tweens to the composition's paused timeline at an absolute time,
// so any frame renders correctly whether played in order or seeked to directly. Each returns its end time.
// Smooth settles are the default; bounceIn/elasticIn are for deliberately playful moments only.
(function () {
  const out = { immediateRender: false };
  const offsets = { left: { x: -1 }, right: { x: 1 }, up: { y: -1 }, down: { y: 1 } };
  const end = (at, d) => at + d;

  const HFMotion = {
    popIn(tl, target, at, { duration = 0.45, rise = 16, ease = 'power3.out' } = {}) {
      tl.fromTo(target, { scale: 0, opacity: 0, y: rise }, { scale: 1, opacity: 1, y: 0, duration, ease }, at);
      return end(at, duration);
    },
    popOut(tl, target, at, { duration = 0.3, ease = 'power2.in' } = {}) {
      tl.fromTo(target, { scale: 1, opacity: 1 }, { scale: 0, opacity: 0, duration, ease, ...out }, at);
      return end(at, duration);
    },
    fadeIn(tl, target, at, { duration = 0.4, ease = 'power1.out' } = {}) {
      tl.fromTo(target, { opacity: 0 }, { opacity: 1, duration, ease }, at);
      return end(at, duration);
    },
    fadeOut(tl, target, at, { duration = 0.4, ease = 'power1.in' } = {}) {
      tl.fromTo(target, { opacity: 1 }, { opacity: 0, duration, ease, ...out }, at);
      return end(at, duration);
    },
    slideIn(tl, target, at, { from = 'right', distance = 160, duration = 0.5, ease = 'power3.out' } = {}) {
      const o = offsets[from];
      tl.fromTo(target, { x: (o.x || 0) * distance, y: (o.y || 0) * distance, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration, ease }, at);
      return end(at, duration);
    },
    slideOut(tl, target, at, { to = 'left', distance = 160, duration = 0.4, ease = 'power2.in' } = {}) {
      const o = offsets[to];
      tl.fromTo(target, { x: 0, y: 0, opacity: 1 }, { x: (o.x || 0) * distance, y: (o.y || 0) * distance, opacity: 0, duration, ease, ...out }, at);
      return end(at, duration);
    },
    scaleIn(tl, target, at, { from = 0.85, duration = 0.5, ease = 'power3.out' } = {}) {
      tl.fromTo(target, { scale: from, opacity: 0 }, { scale: 1, opacity: 1, duration, ease }, at);
      return end(at, duration);
    },
    rotateIn(tl, target, at, { from = -12, duration = 0.5, ease = 'power3.out' } = {}) {
      tl.fromTo(target, { rotation: from, scale: 0.9, opacity: 0 }, { rotation: 0, scale: 1, opacity: 1, duration, ease }, at);
      return end(at, duration);
    },
    pulse(tl, target, at, { count = 2, amount = 0.08, duration = 0.5 } = {}) {
      for (let i = 0; i < count; i++) {
        const t = at + i * duration;
        tl.fromTo(target, { scale: 1 }, { scale: 1 + amount, duration: duration / 2, ease: 'sine.out', ...out }, t);
        tl.fromTo(target, { scale: 1 + amount }, { scale: 1, duration: duration / 2, ease: 'sine.in', ...out }, t + duration / 2);
      }
      return end(at, count * duration);
    },
    shake(tl, target, at, { intensity = 10, count = 4, duration = 0.4 } = {}) {
      const n = count * 2;
      const xs = [0, ...Array.from({ length: n - 1 }, (_, i) => (i % 2 ? -1 : 1) * intensity * (1 - i / n)), 0];
      const step = duration / n;
      for (let i = 0; i < n; i++) tl.fromTo(target, { x: xs[i] }, { x: xs[i + 1], duration: step, ease: 'sine.inOut', ...out }, at + i * step);
      return end(at, duration);
    },
    highlight(tl, target, at, { scale = 1.06, hold = 0.6, duration = 0.25 } = {}) {
      tl.fromTo(target, { scale: 1 }, { scale, duration, ease: 'power2.out', ...out }, at);
      tl.fromTo(target, { scale }, { scale: 1, duration, ease: 'power2.inOut', ...out }, at + duration + hold);
      return end(at, duration * 2 + hold);
    },
    // Playful register only: overshoot reads as cartoonish in calm, professional pieces.
    bounceIn(tl, target, at, { duration = 0.6, overshoot = 1.7 } = {}) {
      tl.fromTo(target, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration, ease: `back.out(${overshoot})` }, at);
      return end(at, duration);
    },
    elasticIn(tl, target, at, { duration = 0.9 } = {}) {
      tl.fromTo(target, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration, ease: 'elastic.out(1, 0.5)' }, at);
      return end(at, duration);
    },
  };
  window.HFMotion = HFMotion;
})();
