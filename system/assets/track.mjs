#!/usr/bin/env node
// Measures where a round, dark object (a barbell plate seen face-on) is in every frame, for HFAnnotate.trailIn.
// Rotation-invariant: it scores a dark disc against a lighter ring around it, searching near the previous position
// (constant-velocity prediction). Coordinates are display pixels of the video as HyperFrames shows it (rotation applied).
//
//   node system/assets/track.mjs --video <file> --from <s> --to <s> --x <px> --y <px> --radius <px> [--out points.json]
//
// --x/--y: the object's centre in the first frame (read it off a frame); --radius: its radius in px.
// Output: { video, from, to, radius, points: [{ t, x, y, score }] } with t in source seconds.
// Always verify on frames before use (draw the points; see system/assets/README.md). Where the object is hidden or the
// score collapses, cut the range there; never fill gaps with invented positions (hand-read keyframes are fine).
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return out;
}

function probe(video) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:stream_side_data=rotation', '-of', 'json', video]));
  const s = j.streams[0], rot = Math.abs(Number(s.side_data_list?.find(d => 'rotation' in d)?.rotation || 0)) % 180;
  const [n, d] = s.r_frame_rate.split('/').map(Number);
  return { width: rot ? s.height : s.width, height: rot ? s.width : s.height, fps: n / d };
}

export function track({ video, from, to, x, y, radius, scale = 0.5, window = 68, inertia = 0.8, distancePenalty = 0.25 }) {
  const info = probe(video), W = Math.round(info.width * scale), H = Math.round(info.height * scale), fps = info.fps;
  const frames = Math.max(1, Math.round((to - from) * fps));
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-i', video, '-frames:v', String(frames), '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: W * H * (frames + 2) });
  const R = radius * scale, e = Math.ceil(R * 1.35), win = Math.round(window * scale);
  const score = (f, cx, cy) => {
    let din = 0, nin = 0, dout = 0, nout = 0;
    for (let dy = -e; dy <= e; dy += 2) for (let dx = -e; dx <= e; dx += 2) {
      const X = Math.round(cx + dx), Y = Math.round(cy + dy); if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const d = Math.hypot(dx, dy), v = f[Y * W + X];
      if (d <= R * 0.95 && d > R * 0.3) { din += v; nin++; } else if (d > R * 1.12 && d <= R * 1.35) { dout += v; nout++; }
    }
    return nin && nout ? dout / nout - din / nin : -999;
  };
  let px = x * scale, py = y * scale, vx = 0, vy = 0;
  const points = [];
  for (let i = 0; i < raw.length / (W * H); i++) {
    const f = raw.subarray(i * W * H, (i + 1) * W * H), ex = px + vx, ey = py + vy;
    let best = { s: -Infinity };
    for (let dy = -win; dy <= win; dy += 2) for (let dx = -win; dx <= win; dx += 2) {
      const s = score(f, ex + dx, ey + dy) - distancePenalty * Math.hypot(dx, dy);
      if (s > best.s) best = { x: ex + dx, y: ey + dy, s };
    }
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const s = score(f, best.x + dx, best.y + dy) - distancePenalty * Math.hypot(best.x + dx - ex, best.y + dy - ey);
      if (s > best.s) best = { x: best.x + dx, y: best.y + dy, s };
    }
    vx = (best.x - px) * inertia; vy = (best.y - py) * inertia; px = best.x; py = best.y;
    points.push({ t: +(from + i / fps).toFixed(3), x: Math.round(px / scale), y: Math.round(py / scale), score: +score(f, px, py).toFixed(1) });
  }
  return { video, from, to, radius, points };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  for (const k of ['video', 'from', 'to', 'x', 'y', 'radius']) if (a[k] === undefined) { console.error(`Missing --${k}. Usage: node system/assets/track.mjs --video <file> --from <s> --to <s> --x <px> --y <px> --radius <px> [--out points.json]`); process.exit(2); }
  const result = track({ video: a.video, from: +a.from, to: +a.to, x: +a.x, y: +a.y, radius: +a.radius });
  const json = JSON.stringify(result, null, 1);
  if (a.out) { await fs.writeFile(a.out, json + '\n'); console.log(`Wrote ${result.points.length} points to ${a.out}`); } else console.log(json);
}
