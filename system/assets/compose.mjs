// Build-time helpers for HyperFrames edits of real footage: shot timing, movement-matched cuts, HDR freeze frames,
// continuous ambience, re-spaced narration and sound cues synced through the asset library.
// Import from a composition build script (see workspace/projects/<project>/<video>/work/build-composition-*.mjs):
//   import { Edit, freezeClip, matchSheet, cue, narration } from '<repo>/system/assets/compose.mjs';
// Browser-side motion lives in system/assets/hf/edit.js (HFEdit) and hf/annotate.js (HFAnnotate).
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
export const r = n => Math.round(n * 1000) / 1000;

/* A sequence of shots laid end to end. Each shot is a source range at a constant rate, a freeze (one source frame
   held), or a graphic gap (no footage, e.g. a full-screen card).
   - anchor: { src, at } makes source time `src` land on composition time `at` (a lift on its word); the in-point is solved.
   - Movement-matched cut: end the outgoing shot on a pose (`to`) and start the next shot on the same pose (`from`);
     check both frames with matchSheet() before trusting it. */
export class Edit {
  constructor({ src = 'assets/source.MOV', fps = 30 } = {}) { this.src = src; this.fps = fps; this.items = []; this.t = 0; }
  shot(id, { from, to, dur, rate = 1, anchor, src = this.src, track = 0 } = {}) {
    const start = this.t;
    if (anchor) from = anchor.src - (anchor.at - start) * rate;
    if (from === undefined) throw new Error(`shot ${id}: needs from or anchor`);
    if (dur === undefined) { if (to === undefined) throw new Error(`shot ${id}: needs to or dur`); dur = (to - from) / rate; }
    if (dur <= 0) throw new Error(`shot ${id}: non-positive duration (anchor too early?)`);
    const item = { kind: 'shot', id, start: r(start), end: r(start + dur), from: r(from), to: r(from + dur * rate), rate, src, track };
    this.items.push(item); this.t = start + dur; return item;
  }
  freeze(id, { src, file, dur, track = 1 }) {
    const item = { kind: 'freeze', id, start: r(this.t), end: r(this.t + dur), from: r(src), to: r(src), rate: 0, src: file, track };
    this.items.push(item); this.t += dur; return item;
  }
  gap(id, dur) { const item = { kind: 'gap', id, start: r(this.t), end: r(this.t + dur) }; this.items.push(item); this.t += dur; return item; }
  get(id) { const s = this.items.find(i => i.id === id); if (!s) throw new Error(`no shot ${id}`); return s; }
  /* Composition time at which source time `src` is shown in shot `id`. */
  at(id, src) { const s = this.get(id); if (s.kind !== 'shot') return s.start; return r(s.start + (src - s.from) / s.rate); }
  get duration() { return r(this.t); }
  /* <video> clips (muted: sound comes from the ambience bed, so cuts never chop the room sound). */
  videos({ cls = 'clip' } = {}) {
    return this.items.filter(i => i.kind !== 'gap').map(i => `  <video id="v-${i.id}" class="${cls}" src="${i.src}" data-start="${i.start}" data-duration="${r(i.end - i.start)}" data-media-start="${i.kind === 'freeze' ? 0 : i.from}"${i.rate !== 1 && i.rate ? ` data-playback-rate="${i.rate}"` : ''} data-track-index="${i.track}" muted playsinline></video>`).join('\n');
  }
}

/* One continuous room/ambience track under the whole edit, so picture cuts never chop music or room tone.
   sync: { src, at } keeps one real sound in sync (e.g. the bar landing). Volume points are [compTime, volume]. */
export function ambience({ src, file = 'assets/source.MOV', duration, sync, volume = 0.08, points = [], track = 10, id = 'ambience' }) {
  const offset = sync ? sync.src - sync.at : src;
  if (offset < 0) throw new Error('ambience: source would start before 0 s');
  const lane = points.length ? ` data-automation='${JSON.stringify({ version: 1, lanes: [{ target: 'volume', points: [{ t: 0, v: volume }, ...points.map(([t, v]) => ({ t: r(t), v }))] }] })}'` : '';
  return `  <audio id="${id}" src="${file}" data-start="0" data-duration="${r(duration)}" data-media-start="${r(offset)}" data-track-index="${track}" data-volume="${volume}"${lane}></audio>`;
}

/* Narration from one take split at its pauses and re-spaced. segments: [{ from, to, shift }] in take seconds.
   Returns the audio clips and the word list moved with its audio (for HFCaptions). Short fades avoid clicks at splits. */
export function narration({ take, file, words, segments, track = 5, fade = 0.015 }) {
  const audio = segments.map((s, i) => {
    const dur = r(s.to - s.from), lane = { version: 1, lanes: [{ target: 'volume', points: [{ t: 0, v: 0 }, { t: fade, v: 1 }, { t: r(dur - fade), v: 1 }, { t: dur, v: 0 }] }] };
    return `  <audio id="${take}-${i + 1}" src="${file}" data-start="${r(s.from + s.shift)}" data-duration="${dur}" data-media-start="${s.from}" data-track-index="${track + (i % 2)}" data-volume="1" data-automation='${JSON.stringify(lane)}'></audio>`;
  }).join('\n');
  const moved = words && words.map(w => { const s = segments.find(v => w.start >= v.from && w.start < v.to) || segments[segments.length - 1]; return { ...w, start: r(w.start + s.shift), end: r(w.end + s.shift) }; });
  return { audio, words: moved, shiftOf: t => (segments.find(v => t >= v.from && t < v.to) || segments[segments.length - 1]).shift };
}

/* Freeze frame that keeps HDR: one source frame encoded as a short HEVC Main10 clip with the source's colour tags
   (a PNG would be SDR and visibly shift against the live footage). */
export async function freezeClip({ source, src, out, dur = 1.2, ffmpeg = 'ffmpeg' }) {
  await fs.mkdir(path.dirname(out), { recursive: true });
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer,color_primaries,color_space,r_frame_rate', '-of', 'json', source])).streams[0];
  const hdr = /arib-std-b67|smpte2084/.test(probe.color_transfer || '');
  const fps = probe.r_frame_rate || '30/1';
  const args = ['-v', 'error', '-y', '-ss', String(src), '-i', source, '-map', '0:v:0', '-an', '-vf', `trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${dur},format=${hdr ? 'yuv420p10le' : 'yuv420p'}`, '-r', fps];
  if (hdr) args.push('-c:v', 'libx265', '-preset', 'slow', '-crf', '6', '-tag:v', 'hvc1', '-x265-params', `colorprim=${probe.color_primaries}:transfer=${probe.color_transfer}:colormatrix=${probe.color_space}:range=limited`, '-color_primaries', probe.color_primaries, '-color_trc', probe.color_transfer, '-colorspace', probe.color_space, '-color_range', 'tv');
  else args.push('-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p');
  execFileSync(ffmpeg, [...args, out]);
  return out;
}

/* Side-by-side frames of a proposed movement-matched cut (outgoing last frame | incoming first frame), for review. */
export function matchSheet({ source, out, cuts, ffmpeg = 'ffmpeg', height = 640 }) {
  const tm = 'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv,format=rgb24';
  const inputs = cuts.flatMap(([a, b]) => [a, b]).flatMap(t => ['-ss', String(t), '-i', source]);
  const n = cuts.length * 2;
  const chain = Array.from({ length: n }, (_, i) => `[${i}:v]trim=end_frame=1,${tm},scale=-2:${height}[f${i}]`).join(';') + ';' + Array.from({ length: n }, (_, i) => `[f${i}]`).join('') + `hstack=inputs=${n}`;
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', chain, '-frames:v', '1', out]);
  return out;
}

/* A sound cue that lands exactly on a visual beat: resolves the library entry (file, volume) and starts the file early
   by its measured lead-in, the same way `library.mjs use` does. Use the same `at` you give the motion.
   Copy the files into the composition with `library.mjs use <id> --project <dir>` first. */
let lib;
export async function cue(id, at, { volume, track = 20, gain = 1 } = {}) {
  lib ||= await import('./library.mjs');
  const ctx = lib.context({ log: () => {} });
  const e = await lib.resolve(ctx, id);
  if (e.category !== 'sound') throw new Error(`cue: ${id} is not a sound`);
  const state = await lib.load(ctx);
  const file = path.join(ctx.root, state.catalog.root, e.path);
  const onset = await lib.audioOnset(file);
  const start = Math.max(0, r(at - onset));
  return `  <audio id="${id.replace(/^sfx-/, '')}-${String(at).replace('.', '_')}" src="assets/library/${e.path}" data-start="${start}" data-duration="${e.duration_seconds ?? 1}" data-track-index="${track}" data-volume="${r((volume ?? e.volume ?? 0.35) * gain)}"></audio>`;
}
