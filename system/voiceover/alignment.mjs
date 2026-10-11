// Turns ElevenLabs character timings into caption words. Timings always come from the alignment itself;
// nothing here estimates timing from text length or reading speed.

// Eleven v4 delivery directions are written in square brackets, e.g. [whispers] or [warm, slow].
const tag = /\[[^[\]\n]{1,120}\]/g;
export const findTags = script => script.match(tag) || [];
export const spokenText = script => script.replace(tag, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
const hasLetters = text => /[\p{L}\p{N}]/u.test(text);
const round = n => Math.round(n * 1000) / 1000;

// alignment: { characters[], character_start_times_seconds[], character_end_times_seconds[] } (API or SDK casing).
export function wordsFromAlignment(alignment, { duration } = {}) {
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds ?? alignment?.characterStartTimesSeconds;
  const ends = alignment?.character_end_times_seconds ?? alignment?.characterEndTimesSeconds;
  if (!Array.isArray(chars) || !chars.length || !Array.isArray(starts) || !Array.isArray(ends) || starts.length !== chars.length || ends.length !== chars.length) {
    return { words: [], warnings: ['ElevenLabs returned no usable timing data, so captions cannot be synced from this take.'] };
  }
  const warnings = [];
  const words = [];
  let depth = 0, current = null, prefix = '', badTimes = 0;
  const flush = () => {
    if (!current) return;
    if (hasLetters(current.text)) { current.text = prefix + current.text; prefix = ''; words.push(current); }
    else if (words.length) words.at(-1).text += (/^[—–-]/.test(current.text) ? ' ' : '') + current.text; // a lone "—" or "…" stays with the word before it
    else prefix += current.text;
    current = null;
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '[') { flush(); depth++; continue; }
    if (c === ']') { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    if (/^\s*$/.test(c)) { flush(); continue; }
    const s = Number(starts[i]), e = Number(ends[i]);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 0) { badTimes++; if (current) current.text += c; continue; }
    if (!current) current = { text: '', start: s, end: e };
    current.text += c;
    current.end = Math.max(current.end, e);
  }
  flush();
  if (badTimes) warnings.push(`${badTimes} characters had no valid timing and were merged into their word.`);

  let reordered = 0, clamped = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.end < w.start) w.end = w.start;
    const prev = words[i - 1];
    if (prev && w.start < prev.start) { reordered++; w.start = prev.start; w.end = Math.max(w.end, w.start); }
    if (prev && prev.end > w.start) prev.end = w.start; // tiny overlaps between neighbours
    if (Number.isFinite(duration) && w.end > duration + 0.05) { clamped++; w.end = duration; w.start = Math.min(w.start, duration); }
  }
  if (reordered) warnings.push(`${reordered} words started before the previous word and were moved to keep captions in order.`);
  if (clamped) warnings.push(`${clamped} words ended after the audio and were trimmed to its length.`);
  return { words: words.map(w => ({ text: w.text, start: round(w.start), end: round(w.end) })), warnings };
}

// Checks the aligned words say what the script says (ElevenLabs may normalise numbers etc.).
export function compareWords(words, script) {
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
  const expected = norm(spokenText(script)), got = norm(words.map(w => w.text).join(' '));
  if (expected.join(' ') === got.join(' ')) return null;
  return `Caption words differ slightly from the script (${got.length} aligned vs ${expected.length} written). Check the words file before rendering.`;
}
