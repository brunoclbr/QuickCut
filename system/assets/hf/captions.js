/* HFCaptions: phrase captions with word highlighting, driven by real word timings
   ({ text, start, end } in seconds, e.g. from system/voiceover). Seek-safe: everything is placed on the
   paused HyperFrames timeline with tl.set / tl.fromTo, nothing runs on its own.

   HFCaptions.mount(tl, "#captions", words, {
     offset: 0,             // seconds added to every timing (= the narration audio's data-start)
     maxWords: 6, maxChars: 32, pauseBreak: 0.45,   // when to start a new phrase
     linger: 0.3,           // keep the last phrase on screen this long after its last word
     mode: "phrase",        // "phrase": whole phrase shows at once; "word": words appear as spoken
     highlight: "color",    // "color": the spoken word turns --hfc-active; "box": box behind it (--hfc-box); false: none
     emphasis: [],          // words (case-insensitive) or word indexes to colour with the accent
     entrance: "fade",      // "fade" | "rise" | "pop" | "none"
   });

   Style without touching timings: set CSS variables on the container, e.g.
   #captions { --hfc-font: "Inter"; --hfc-size: 56px; --hfc-color: #fff; --hfc-active: #3b82f6;
               --hfc-accent: #ff7a1a; --hfc-bottom: 17.7%; --hfc-width: 80%; --hfc-weight: 600;
               --hfc-shadow: 0 1px 3px rgba(0,0,0,.45), 0 0 14px rgba(0,0,0,.22); }
   Bright footage: add a soft dark fade behind the caption area (off by default), e.g.
   #captions { --hfc-scrim: radial-gradient(closest-side, rgba(0,0,0,.4), rgba(0,0,0,0)); } */
(function (root) {
  var defaults = { offset: 0, maxWords: 6, maxChars: 32, pauseBreak: 0.45, linger: 0.3, mode: 'phrase', highlight: 'color', emphasis: [], entrance: 'fade' };
  var css = '.hfc-root{position:absolute;left:50%;bottom:var(--hfc-bottom,17.7%);width:var(--hfc-width,80%);transform:translateX(-50%);pointer-events:none}' +
    '.hfc-root::before{content:"";position:absolute;left:-12%;right:-12%;bottom:-1.6em;height:4.4em;background:var(--hfc-scrim,none)}' +
    '.hfc-phrase{position:absolute;left:0;right:0;bottom:0;text-align:center;visibility:hidden;opacity:0;font-family:var(--hfc-font,Inter,"Helvetica Neue",Arial,sans-serif);font-weight:var(--hfc-weight,600);font-size:var(--hfc-size,56px);line-height:1.25;color:var(--hfc-color,#fff);text-shadow:var(--hfc-shadow,0 1px 3px rgba(0,0,0,.45),0 0 14px rgba(0,0,0,.22))}' +
    '.hfc-word{position:relative;display:inline-block;padding:0 .12em;margin:0 -.06em;white-space:nowrap}' +
    '.hfc-bg{position:absolute;inset:-.02em 0;border-radius:var(--hfc-radius,.18em);background:var(--hfc-box,#3b82f6);opacity:0}' +
    '.hfc-text{position:relative}.hfc-accent .hfc-text{color:var(--hfc-accent,#ff7a1a)}';

  function clean(t) { return String(t).toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''); }
  function endsSentence(t) { return /[.!?…]["'”’)]*$/.test(t); }

  function phrases(words, options) {
    var o = Object.assign({}, defaults, options), groups = [], current = [], chars = 0;
    words.forEach(function (w, i) {
      var prev = words[i - 1];
      var full = current.length >= o.maxWords || (current.length && chars + 1 + w.text.length > o.maxChars);
      var pause = prev && w.start - prev.end > o.pauseBreak;
      if (current.length && (full || pause || endsSentence(prev.text))) { groups.push(current); current = []; chars = 0; }
      current.push(Object.assign({ index: i }, w)); chars += (chars ? 1 : 0) + w.text.length;
    });
    if (current.length) groups.push(current);
    return groups;
  }

  function mount(tl, container, words, options) {
    var o = Object.assign({}, defaults, options);
    var host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) throw new Error('HFCaptions: container not found');
    if (!Array.isArray(words) || !words.length) throw new Error('HFCaptions: no word timings');
    if (!document.getElementById('hfc-style')) { var style = document.createElement('style'); style.id = 'hfc-style'; style.textContent = css; document.head.appendChild(style); }
    var box = document.createElement('div'); box.className = 'hfc-root'; host.appendChild(box);
    var accent = {}; (o.emphasis || []).forEach(function (e) { accent[typeof e === 'number' ? '#' + e : clean(e)] = true; });
    var groups = phrases(words, o), last = 0;
    var highlight = o.highlight === true ? 'color' : o.highlight;
    var active = getComputedStyle(box).getPropertyValue('--hfc-active').trim() || '#3b82f6';
    groups.forEach(function (g, gi) {
      var p = document.createElement('div'); p.className = 'hfc-phrase'; box.appendChild(p);
      var start = g[0].start + o.offset;
      var next = groups[gi + 1];
      var end = Math.min(next ? next[0].start : Infinity, g[g.length - 1].end + o.linger) + o.offset;
      g.forEach(function (w, wi) {
        var span = document.createElement('span'); span.className = 'hfc-word' + (accent['#' + w.index] || accent[clean(w.text)] ? ' hfc-accent' : '');
        var bg = document.createElement('span'); bg.className = 'hfc-bg';
        var text = document.createElement('span'); text.className = 'hfc-text'; text.textContent = w.text;
        span.appendChild(bg); span.appendChild(text); p.appendChild(span); p.appendChild(document.createTextNode(' '));
        var wordStart = w.start + o.offset, wordEnd = g[wi + 1] ? g[wi + 1].start + o.offset : Math.min(end, w.end + o.offset + 0.15);
        if (highlight === 'box') { tl.set(bg, { opacity: 1 }, wordStart); tl.set(bg, { opacity: 0 }, Math.max(wordStart, wordEnd)); }
        if (highlight === 'color') { var base = getComputedStyle(text).color; tl.set(text, { color: active }, wordStart); tl.set(text, { color: base }, Math.max(wordStart, wordEnd)); }
        if (o.mode === 'word' && wi > 0) { tl.set(span, { autoAlpha: 0 }, 0); tl.set(span, { autoAlpha: 1 }, wordStart); }
      });
      tl.set(p, { autoAlpha: 0 }, 0);
      var from = o.entrance === 'rise' ? { autoAlpha: 0, y: 14 } : o.entrance === 'pop' ? { autoAlpha: 0, scale: 0.92 } : { autoAlpha: 0 };
      var to = o.entrance === 'rise' ? { autoAlpha: 1, y: 0 } : o.entrance === 'pop' ? { autoAlpha: 1, scale: 1 } : { autoAlpha: 1 };
      if (o.entrance === 'none') tl.set(p, { autoAlpha: 1 }, start);
      else tl.fromTo(p, from, Object.assign(to, { duration: Math.min(0.16, Math.max(0.01, end - start)), ease: 'power2.out', immediateRender: false }), start);
      tl.set(p, { autoAlpha: 0 }, end);
      last = Math.max(last, end);
    });
    return { phrases: groups.length, end: last };
  }

  root.HFCaptions = { mount: mount, phrases: phrases, defaults: defaults };
})(typeof window !== 'undefined' ? window : globalThis);
