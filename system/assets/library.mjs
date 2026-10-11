#!/usr/bin/env node
// Local asset library for HyperFrames compositions. See system/assets/README.md.
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultRoot = path.resolve(here, '../..');
const LOCK = 'workspace/assets/.library-lock.json';
const LOCAL = 'workspace/assets/library-local.json';
const COMPATIBLE = { json: 'lottie', svg: 'svg', png: 'png', mp3: 'mp3', wav: 'wav' };

const exists = p => fs.access(p).then(() => true, () => false);
const readJSON = async (p, fallback) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; } };
const writeJSON = (p, data) => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, JSON.stringify(data, null, 2) + '\n'));
const slug = s => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/^mixkit-/, '').replace(/-\d+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safeSegment = s => s.replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^\.+/, '');
const sha256 = file => new Promise((resolve, reject) => { const h = createHash('sha256'); createReadStream(file).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))); });

export function context({ root = defaultRoot, home = os.homedir(), downloads, log = console.log } = {}) {
  return { root, home, downloads: downloads || path.join(home, 'Downloads'), log };
}
const abs = (ctx, rel) => path.join(ctx.root, rel);
const assetAbs = (ctx, catalog, rel) => path.join(ctx.root, catalog.root, rel);

export async function load(ctx) {
  const catalog = await readJSON(abs(ctx, 'system/assets/catalog.json'));
  const lock = await readJSON(abs(ctx, LOCK), { sources: {} });
  const local = await readJSON(abs(ctx, LOCAL), { assets: [] });
  return { catalog, lock, local, entries: [...catalog.assets, ...local.assets] };
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...await walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

// Returns null when valid, otherwise a reason. Only formats HyperFrames can render deterministically pass.
export async function validateFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const kind = COMPATIBLE[ext];
  if (!kind) return `unsupported format .${ext}`;
  const buf = await fs.readFile(file);
  if (!buf.length) return 'empty file';
  if (kind === 'lottie') {
    let j; try { j = JSON.parse(buf.toString('utf8')); } catch { return 'invalid JSON'; }
    if (!(j.fr > 0 && j.op > j.ip && j.w > 0 && j.h > 0 && Array.isArray(j.layers))) return 'not a Lottie animation (missing fr/ip/op/w/h/layers)';
    for (const a of j.assets || []) if (a.p && !String(a.p).startsWith('data:') && !(await exists(path.join(path.dirname(file), a.u || '', a.p)))) return `references missing image ${a.u || ''}${a.p}`;
    return null;
  }
  if (kind === 'svg') {
    const text = buf.toString('utf8');
    if (!/<svg[\s>]/i.test(text)) return 'no <svg> root';
    if (/<script|\son[a-z]+\s*=|javascript:/i.test(text)) return 'contains script or event handlers';
    return null;
  }
  if (kind === 'png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? null : 'not a PNG';
  const duration = await audioDuration(file);
  return duration > 0 ? null : 'audio could not be decoded';
}
async function audioDuration(file) {
  try { const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]); return Number(stdout.trim()) || 0; }
  catch { const head = (await fs.readFile(file)).subarray(0, 12); return head.toString('latin1', 0, 4) === 'RIFF' || head.toString('latin1', 0, 3) === 'ID3' || head[0] === 0xff ? 1 : 0; }
}
// Seconds of near-silence before the sound's audible attack (30 dB under its peak), so cues can start early and land on the beat.
export async function audioOnset(file) {
  try {
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec((await run('ffmpeg', ['-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])).stderr)?.[1]);
    if (!Number.isFinite(peak)) return 0;
    const { stderr } = await run('ffmpeg', ['-v', 'info', '-i', file, '-af', `silencedetect=n=${peak - 30}dB:d=0.01`, '-f', 'null', '-']);
    const start = /silence_start: (-?[\d.e-]+)/.exec(stderr), end = /silence_end: ([\d.]+)/.exec(stderr);
    return start && Number(start[1]) <= 0.001 && end ? Math.round(Number(end[1]) * 1000) / 1000 : 0;
  } catch { return 0; }
}
async function lottieDuration(file) { const j = JSON.parse(await fs.readFile(file, 'utf8')); return Math.round((j.op - j.ip) / j.fr * 1000) / 1000; }

async function record(ctx, files) {
  const out = {};
  for (const file of files) { const st = await fs.stat(abs(ctx, file)); out[file] = { bytes: st.size, sha256: await sha256(abs(ctx, file)) }; }
  return out;
}
async function intact(ctx, entry, { deep = false } = {}) {
  if (!entry?.files) return false;
  for (const [file, meta] of Object.entries(entry.files)) {
    const st = await fs.stat(abs(ctx, file)).catch(() => null);
    if (!st || st.size !== meta.bytes) return false;
    if (deep && (await sha256(abs(ctx, file))) !== meta.sha256) return false;
  }
  return true;
}
async function copyInto(ctx, from, toRel) {
  const target = abs(ctx, toRel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(from, target);
  return toRel;
}

async function installNpm(ctx, src) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-npm-'));
  try {
    const { stdout } = await run('npm', ['pack', `${src.package}@${src.version}`, '--pack-destination', tmp, '--json', '--silent'], { maxBuffer: 1 << 24 });
    const tarball = path.join(tmp, JSON.parse(stdout)[0].filename);
    await run('tar', ['-xzf', tarball, '-C', tmp]);
    const pkg = path.join(tmp, 'package');
    const written = [];
    for (const [from, to] of Object.entries(src.files || {})) written.push(await copyInto(ctx, path.join(pkg, from), `${src.install_to}/${to}`));
    for (const [from, to] of Object.entries(src.dirs || {})) for (const file of await walk(path.join(pkg, from))) written.push(await copyInto(ctx, path.join(pkg, from, file), `${src.install_to}/${to}/${file}`));
    return written;
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}
async function installLocalSkill(ctx, src) {
  for (const candidate of src.candidates) {
    const dir = candidate.replace(/^~/, ctx.home);
    if (!(await exists(dir))) continue;
    const written = [];
    for (const file of await walk(dir)) if (/\.(mp3|wav)$/i.test(file) || /^CREDITS\.md$/i.test(file)) written.push(await copyInto(ctx, path.join(dir, file), `${src.install_to}/${file}`));
    return written;
  }
  throw new Error(`HyperFrames media-use skill not found (looked in ${src.candidates.join(', ')}). Install HyperFrames skills first.`);
}
async function installRepo(ctx, src) {
  const written = [];
  for (const file of await walk(abs(ctx, src.from))) {
    if (src.formats && !src.formats.includes(path.extname(file).slice(1).toLowerCase())) continue;
    const reason = await validateFile(abs(ctx, `${src.from}/${file}`));
    if (reason) throw new Error(`${src.from}/${file}: ${reason}`);
    written.push(await copyInto(ctx, abs(ctx, `${src.from}/${file}`), `${src.install_to}/${path.basename(file)}`));
  }
  return written;
}

async function safeExtract(archive, dest) {
  const { stdout } = await run('unzip', ['-Z1', archive], { maxBuffer: 1 << 26 });
  for (const name of stdout.split('\n').filter(Boolean)) if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`unsafe path in archive: ${name}`);
  await run('unzip', ['-q', '-o', archive, '-d', dest], { maxBuffer: 1 << 26 });
  const zips = (await walk(dest)).filter(f => f.toLowerCase().endsWith('.zip'));
  for (const inner of zips) await safeExtract(path.join(dest, inner), path.join(dest, inner.replace(/\.zip$/i, '')));
}

function entryFor(source, rel, catalog, extra = {}) {
  const ext = path.extname(rel).slice(1).toLowerCase();
  const words = rel.split('/').slice(0, -1).map(slug).filter(Boolean);
  const base = slug(path.basename(rel));
  const category = COMPATIBLE[ext] === 'lottie' ? 'animation' : ['mp3', 'wav'].includes(ext) ? 'sound' : 'illustration';
  return { id: `${source}-${base}`, name: base.replace(/-/g, ' '), category, format: COMPATIBLE[ext], source,
    path: rel, tags: [...new Set([...base.split('-'), ...words])].filter(w => w.length > 1), description: `${catalog.sources[source].name}: ${base.replace(/-/g, ' ')}`, recommended_usage: [], ...extra };
}
async function register(ctx, state, entries) {
  const ids = new Set(state.entries.map(e => e.id));
  for (const entry of entries) {
    if (state.local.assets.some(e => e.path === entry.path && e.source === entry.source)) continue;
    let id = entry.id, n = 2;
    while (ids.has(id)) id = `${entry.id}-${n++}`;
    ids.add(id);
    const e = { ...entry, id, added_by: 'import' };
    state.local.assets.push(e); state.entries.push(e);
  }
  await writeJSON(abs(ctx, LOCAL), state.local);
}
async function describe(ctx, state, src, rel) {
  const file = assetAbs(ctx, state.catalog, rel);
  if (['mp3', 'wav'].includes(path.extname(rel).slice(1).toLowerCase())) return { duration_seconds: Math.round(await audioDuration(file) * 100) / 100 };
  if (rel.endsWith('.json')) return { duration_seconds: await lottieDuration(file) };
  return {};
}

async function installManual(ctx, state, id, src) {
  if (!src.match) return { status: 'manual', note: 'imported one file at a time with `import`' };
  const re = new RegExp(src.match, 'i');
  const found = (await fs.readdir(ctx.downloads).catch(() => [])).filter(n => re.test(n));
  if (!found.length) return { status: 'missing' };
  const lockEntry = state.lock.sources[id] || { files: {}, archives: {} };
  const rootRel = state.catalog.root + '/';
  const added = [], skipped = [];
  for (const name of found) {
    const file = path.join(ctx.downloads, name);
    const digest = await sha256(file);
    if (lockEntry.archives?.[digest] && await intact(ctx, { files: Object.fromEntries(Object.entries(lockEntry.files).filter(([, m]) => m.from === digest)) })) continue;
    const candidates = [];
    let tmp;
    try {
      if (name.toLowerCase().endsWith('.zip')) {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-zip-'));
        await safeExtract(file, tmp);
        for (const rel of await walk(tmp)) candidates.push({ from: path.join(tmp, rel), rel });
      } else candidates.push({ from: file, rel: name });
      for (const { from, rel } of candidates) {
        const ext = path.extname(rel).slice(1).toLowerCase();
        if (src.keep && !src.keep.includes(ext)) { skipped.push(rel); continue; }
        const reason = await validateFile(from);
        if (reason) { skipped.push(`${rel} (${reason})`); continue; }
        const target = `${src.install_to}/${rel.split('/').map(safeSegment).join('/')}`;
        await copyInto(ctx, from, target);
        lockEntry.files[target] = { ...(await record(ctx, [target]))[target], from: digest };
        added.push(target.slice(rootRel.length));
      }
    } finally { if (tmp) await fs.rm(tmp, { recursive: true, force: true }); }
    lockEntry.archives = { ...lockEntry.archives, [digest]: name };
  }
  lockEntry.installed_at = new Date().toISOString();
  state.lock.sources[id] = lockEntry;
  const entries = [];
  for (const rel of added) entries.push(entryFor(id, rel.slice(src.install_to.length - rootRel.length + 1), state.catalog, { path: rel, ...(await describe(ctx, state, src, rel)), ...mixkitMeta(state.catalog, id, rel) }));
  await register(ctx, state, entries);
  return { status: added.length ? 'installed' : 'unchanged', added: added.length, skipped: skipped.length };
}
function mixkitMeta(catalog, id, rel) {
  if (id !== 'mixkit') return {};
  const item = catalog.manual_shopping_list.mixkit.find(m => slug(m.title) === slug(path.basename(rel)));
  return item ? { name: item.title, tags: [...new Set([item.category, ...slug(item.title).split('-')])], description: `Mixkit: ${item.title}`, source_url: item.page } : {};
}

export async function setup(ctx, { force = false, only } = {}) {
  const state = await load(ctx);
  const report = {};
  for (const [id, src] of Object.entries(state.catalog.sources)) {
    if (only && id !== only) continue;
    try {
      if (src.acquisition === 'manual') { report[id] = await installManual(ctx, state, id, src); continue; }
      const prev = state.lock.sources[id];
      if (!force && prev && prev.version === (src.version || null) && await intact(ctx, prev)) { report[id] = { status: 'unchanged' }; continue; }
      const written = src.acquisition === 'npm' ? await installNpm(ctx, src) : src.acquisition === 'local-skill' ? await installLocalSkill(ctx, src) : await installRepo(ctx, src);
      state.lock.sources[id] = { version: src.version || null, installed_at: new Date().toISOString(), files: await record(ctx, written) };
      report[id] = { status: 'installed', added: written.length };
    } catch (error) { report[id] = { status: 'error', error: error.message.split('\n')[0] }; }
  }
  await writeJSON(abs(ctx, LOCK), state.lock);
  return report;
}

export async function importFile(ctx, file, { source = 'lottiefiles', url, creator, name, tags = [], license } = {}) {
  const state = await load(ctx);
  const src = state.catalog.sources[source];
  if (!src) throw new Error(`unknown source ${source}`);
  const reason = await validateFile(file);
  if (reason) throw new Error(`${file}: ${reason}`);
  const target = `${src.install_to}/${safeSegment(path.basename(file))}`;
  await copyInto(ctx, file, target);
  const lockEntry = state.lock.sources[source] || { files: {} };
  Object.assign(lockEntry.files, await record(ctx, [target]));
  state.lock.sources[source] = lockEntry;
  await writeJSON(abs(ctx, LOCK), state.lock);
  const rel = target.slice(state.catalog.root.length + 1);
  const entry = entryFor(source, path.basename(rel), state.catalog, { path: rel, ...(await describe(ctx, state, src, rel)) });
  if (name) entry.name = name;
  entry.tags = [...new Set([...entry.tags, ...tags])];
  Object.assign(entry, url && { source_url: url }, creator && { creator }, license && { license });
  if (!url || !creator) entry.provenance_missing = true;
  await register(ctx, state, [entry]);
  return state.entries.at(-1);
}

export async function installed(ctx, state, entry) { return exists(assetAbs(ctx, state.catalog, entry.path)); }

export async function search(ctx, words, { category, format, source, onlyInstalled = false, limit = 15 } = {}) {
  const state = await load(ctx);
  const terms = words.map(w => w.toLowerCase()).filter(Boolean);
  const results = [];
  for (const e of state.entries) {
    if ((category && e.category !== category) || (format && e.format !== format) || (source && e.source !== source)) continue;
    const hay = [e.name, e.description, ...(e.recommended_usage || [])].join(' ').toLowerCase();
    let score = terms.reduce((s, t) => s + (e.tags?.includes(t) ? 3 : 0) + (e.id.includes(t) ? 2 : 0) + (hay.includes(t) ? 1 : 0), 0);
    if (terms.length && !score) continue;
    if (score && e.source.startsWith('editorial-')) score += 0.5; // the owner's toolkit wins ties
    const ok = await installed(ctx, state, e);
    if (onlyInstalled && !ok) continue;
    results.push({ ...e, score, installed: ok, license: licenseSummary(state.catalog.sources[e.source]) });
  }
  if ((!category || category === 'motion') && (!format || format === 'js') && (!source || source === 'editorial')) {
    for (const m of state.catalog.motion || []) {
      const hay = [m.name, m.description, m.when].join(' ').toLowerCase();
      const score = terms.reduce((s, t) => s + (m.tags?.includes(t) ? 3 : 0) + (m.id.includes(t) ? 2 : 0) + (hay.includes(t) ? 1 : 0), 0);
      if (terms.length && !score) continue;
      // Ranked above files on a tie: the owner's toolkit has priority for editorial moves.
      results.push({ ...m, category: 'motion', format: 'js', source: 'editorial', score: score + 0.5, installed: true, license: 'original toolkit code (system/assets/editorial)' });
    }
  }
  results.sort((a, b) => b.score - a.score || Number(b.installed) - Number(a.installed) || a.id.localeCompare(b.id));
  const icons = [];
  const iconRoot = assetAbs(ctx, state.catalog, 'icons/phosphor/regular');
  if (terms.length && (!category || category === 'icon') && (!format || format === 'svg') && (!source || source === 'phosphor')) {
    for (const f of (await fs.readdir(iconRoot).catch(() => [])).sort()) if (terms.some(t => f.replace('.svg', '').split('-').includes(t))) icons.push(`phosphor:regular/${f.replace('.svg', '')}`);
  }
  return { results: results.slice(0, limit), icons: icons.slice(0, 12), total: results.length };
}
function licenseSummary(src) {
  if (!src) return 'unknown source';
  return [src.license, src.commercial_videos ? 'ok in published videos' : 'NOT for published videos', src.redistributable === true ? 'redistributable' : 'local only'].join(' · ');
}

// Resolves an id or a phosphor:<weight>/<name> reference to an entry.
export async function resolve(ctx, ref, state) {
  state ||= await load(ctx);
  const icon = /^phosphor:(regular|bold|fill|duotone)\/([a-z0-9-]+)$/.exec(ref);
  const variant = /^(icon-[a-z0-9-]+)@(bold|fill|duotone)$/.exec(ref);
  if (variant) { const base = state.entries.find(e => e.id === variant[1]); if (base) return { ...base, id: `${base.id}-${variant[2]}`, path: base.path.replace(/\/regular\/(.+)\.svg$/, `/${variant[2]}/$1-${variant[2]}.svg`) }; }
  if (icon) return { id: `phosphor-${icon[2]}${icon[1] === 'regular' ? '' : '-' + icon[1]}`, name: icon[2], category: 'icon', format: 'svg', source: 'phosphor', path: `icons/phosphor/${icon[1]}/${icon[2]}${icon[1] === 'regular' ? '' : '-' + icon[1]}.svg`, tags: icon[2].split('-') };
  const motion = (state.catalog.motion || []).find(m => m.id === ref);
  if (motion) return { ...motion, category: 'motion', format: 'js', source: 'editorial' };
  const entry = state.entries.find(e => e.id === ref);
  if (!entry) throw new Error(`no asset with id ${ref} (try: search)`);
  return entry;
}

export async function use(ctx, refs, project, { at = 0, track: baseTrack = 5 } = {}) {
  const state = await load(ctx);
  const dir = path.resolve(project);
  if (!(await exists(dir))) throw new Error(`project folder not found: ${dir}`);
  const lib = path.join(dir, 'assets/library');
  const snippets = [];
  const copy = async (from, rel) => { await fs.mkdir(path.dirname(path.join(lib, rel)), { recursive: true }); await fs.copyFile(from, path.join(lib, rel)); };
  await copy(abs(ctx, 'system/assets/hf/motion.js'), 'motion.js');
  let needsLottie = false, needsEditorial = false;
  for (const [i, ref] of refs.entries()) {
    const track = baseTrack + i;
    const e = await resolve(ctx, ref, state);
    if (e.category === 'motion') {
      needsEditorial = true;
      const target = '#' + e.id, exit = Math.round((at + e.hold) * 1000) / 1000;
      const calls = e.timeline.replaceAll('{target}', target).replaceAll('{at}', at).replaceAll('{exit}', exit);
      snippets.push(`<!-- ${e.name}: ${e.when} Real media only. HyperFrames owns the clip's visibility, so HFEditorial animates the child. See system/assets/editorial/RECIPES.md -->
<div id="${e.id}-host" class="clip" data-start="${at}" data-duration="${Math.round((exit - at + 0.5) * 1000) / 1000}" data-track-index="${track}" style="position:absolute; inset:0;">
${e.html.replaceAll('{id}', e.id)}
</div>
<!-- timeline: ${calls} -->`);
      continue;
    }
    const from = assetAbs(ctx, state.catalog, e.path);
    if (!(await exists(from))) throw new Error(`${e.id} is not installed (${e.path}). Run: node system/assets/library.mjs setup`);
    await copy(from, e.path);
    const src = `assets/library/${e.path}`;
    const id = e.id.replace(/[^a-z0-9-]/gi, '-');
    if (e.format === 'lottie') {
      needsLottie = true;
      const d = e.duration_seconds || 2;
      snippets.push(`<!-- ${e.name}: the host's data-start is the Lottie's frame 0 (HyperFrames offsets it); loop:false holds the last frame -->
<div id="${id}-host" class="clip" data-composition-id="${id}" data-no-timeline data-start="${at}" data-duration="${d}" data-track-index="${track}" style="position:absolute; left:390px; top:700px; width:300px; height:300px;">
  <div id="${id}" style="width:100%; height:100%;"></div>
</div>
<script>
  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(lottie.loadAnimation({ container: document.getElementById("${id}"), renderer: "svg", loop: false, autoplay: false, path: "${src}" }));
</script>`);
    } else if (e.category === 'sound') {
      const onset = await audioOnset(from);
      const start = Math.max(0, Math.round((at - onset) * 1000) / 1000);
      snippets.push(`<!-- ${e.name}: audible ${onset}s into the file, so it starts at ${start} to hit the beat at ${at}; sits under the voice -->
<audio id="${id}-${String(at).replace('.', '_')}" src="${src}" data-start="${start}" data-duration="${e.duration_seconds ?? 1}" data-track-index="${track}" data-volume="${e.volume ?? 0.35}"></audio>`);
    } else {
      const svg = e.format === 'svg' && (await fs.stat(from)).size < 30000 ? (await fs.readFile(from, 'utf8')).trim().replace(/<svg\b/, `<svg id="${id}" style="width:100%; height:100%; color:#ffffff;"`) : null;
      const inner = svg ? `  ${svg}` : `  <img id="${id}" src="${src}" alt="" style="width:100%; height:100%; object-fit:contain;">`;
      snippets.push(`<!-- ${e.name}${svg ? ' (inline so CSS color sets its colour)' : ''}: animate the inner element, never the timed wrapper's size -->
<div id="${id}-host" class="clip" data-start="${at}" data-duration="2" data-track-index="${track}" style="position:absolute; left:420px; top:700px; width:240px; height:240px;">
${inner}
</div>
<!-- timeline: HFMotion.popIn(tl, "#${id}", ${at}); -->`);
    }
  }
  if (needsLottie) await copy(abs(ctx, 'system/assets/vendor/lottie.min.js'), 'lottie.min.js');
  if (needsEditorial) await copy(abs(ctx, 'system/assets/editorial/editorial.js'), 'editorial.js');
  const hasGsap = await exists(path.join(dir, 'gsap.min.js'));
  if (!hasGsap) await copy(abs(ctx, 'system/assets/vendor/gsap.min.js'), 'gsap.min.js');
  const scripts = [!hasGsap && `<script src="assets/library/gsap.min.js"></script>`, `<script src="assets/library/motion.js"></script>`, needsEditorial && `<script src="assets/library/editorial.js"></script>`, needsLottie && `<script src="assets/library/lottie.min.js"></script>`].filter(Boolean);
  return { copied_to: path.relative(process.cwd(), lib), scripts, snippets };
}

export async function validate(ctx, { deep = false } = {}) {
  const state = await load(ctx);
  const errors = [], warnings = [];
  const seen = new Set();
  for (const e of state.entries) {
    if (seen.has(e.id)) errors.push(`duplicate id ${e.id}`);
    seen.add(e.id);
    if (!state.catalog.sources[e.source]) errors.push(`${e.id}: unknown source ${e.source}`);
    if (!e.path || path.isAbsolute(e.path) || e.path.split('/').includes('..')) { errors.push(`${e.id}: unsafe path`); continue; }
    const file = assetAbs(ctx, state.catalog, e.path);
    if (!(await exists(file))) { (e.added_by === 'import' ? errors : warnings).push(`${e.id}: not installed (${e.path})`); continue; }
    const reason = await validateFile(file);
    if (reason) errors.push(`${e.id}: ${reason}`);
    if (e.provenance_missing) warnings.push(`${e.id}: source URL or creator not recorded`);
  }
  for (const [id, entry] of Object.entries(state.lock.sources)) if (!(await intact(ctx, entry, { deep }))) errors.push(`${id}: installed files changed or missing — run setup --force --source ${id}`);
  for (const file of ['system/assets/vendor/lottie.min.js', 'system/assets/vendor/gsap.min.js']) if (!(await exists(abs(ctx, file)))) warnings.push(`${file} missing — run setup`);
  return { errors, warnings, entries: state.entries.length };
}

export async function status(ctx) {
  const state = await load(ctx);
  const rows = [];
  for (const [id, src] of Object.entries(state.catalog.sources)) {
    const lockEntry = state.lock.sources[id];
    const count = lockEntry ? Object.keys(lockEntry.files || {}).length : 0;
    rows.push({ id, acquisition: src.acquisition, installed: count > 0, files: count, url: src.url, manual_steps: src.manual_steps });
  }
  let available = 0;
  for (const e of state.entries) if (await installed(ctx, state, e)) available++;
  return { rows, catalogued: state.entries.length, available, shopping: state.catalog.manual_shopping_list };
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true); }
    else out._.push(a);
  }
  return out;
}
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const a = args(rest);
  const ctx = context({ downloads: a.from });
  const json = data => console.log(JSON.stringify(data, null, 2));
  if (command === 'setup' || command === 'update') {
    const report = await setup(ctx, { force: command === 'update' || a.force === true, only: a.source });
    for (const [id, r] of Object.entries(report)) console.log(`${id.padEnd(20)} ${r.status}${r.added ? ` (+${r.added})` : ''}${r.skipped ? `, skipped ${r.skipped} incompatible` : ''}${r.error ? ` — ${r.error}` : ''}`);
    const missing = Object.entries(report).filter(([, r]) => r.status === 'missing');
    if (missing.length) console.log(`\nManual downloads not found in ${ctx.downloads}: ${missing.map(([id]) => id).join(', ')}. Run "status" for links.`);
    if (Object.values(report).some(r => r.status === 'error')) process.exitCode = 1;
  } else if (command === 'status') {
    const s = await status(ctx);
    for (const r of s.rows) console.log(`${r.id.padEnd(20)} ${r.installed ? `installed (${r.files} files)` : r.acquisition === 'manual' ? 'not yet imported — manual download' : 'not installed — run setup'}`);
    console.log(`\n${s.available} of ${s.catalogued} catalogued assets are installed. Phosphor icons are also usable by name.`);
    const manual = s.rows.filter(r => !r.installed && r.acquisition === 'manual');
    if (manual.length) {
      console.log('\nManual downloads (save into Downloads, then run setup again):');
      for (const r of manual) console.log(`- ${r.id}: ${r.url}\n  ${r.manual_steps}`);
      if (manual.some(r => r.id === 'mixkit')) console.log(`  Mixkit picks: ${s.shopping.mixkit.map(m => m.title).join('; ')}`);
      if (manual.some(r => r.id === 'lottiefiles')) console.log(`  LottieFiles wish list: ${s.shopping.lottiefiles.join('; ')}`);
    }
  } else if (command === 'search') {
    const r = await search(ctx, a._, { category: a.category, format: a.format, source: a.source, onlyInstalled: a.installed === true, limit: Number(a.limit) || 15 });
    if (a.json) return json(r);
    for (const e of r.results) console.log(`${e.installed ? '✓' : '·'} ${e.id.padEnd(28)} ${String(e.format).padEnd(7)} ${e.duration_seconds ? `${e.duration_seconds}s`.padEnd(7) : ''.padEnd(7)} ${e.description}\n    ${e.license}`);
    if (r.icons.length) console.log(`Icons: ${r.icons.join(', ')} (also bold/fill/duotone)`);
    if (!r.results.length && !r.icons.length) console.log('No matches. Try broader words, or "status" to see what is installed.');
  } else if (command === 'show') {
    const state = await load(ctx);
    const e = await resolve(ctx, a._[0], state);
    if (e.category === 'motion') return json({ ...e, script: 'system/assets/editorial/editorial.js', recipes: 'system/assets/editorial/RECIPES.md' });
    const file = assetAbs(ctx, state.catalog, e.path), ok = await installed(ctx, state, e);
    json({ ...e, installed: ok, file, ...(ok && e.category === 'sound' && { onset_seconds: await audioOnset(file) }), source_info: state.catalog.sources[e.source] });
  } else if (command === 'use') {
    if (!a.project) throw new Error('use <id...> --project <composition folder> [--at seconds] [--track n]');
    const r = await use(ctx, a._, a.project, { at: Number(a.at) || 0, track: Number(a.track) || 5 });
    console.log(`Copied into ${r.copied_to}. Add to <head> (one track per element; adjust positions and times):\n${r.scripts.join('\n')}\n\n${r.snippets.join('\n\n')}`);
  } else if (command === 'import') {
    const e = await importFile(ctx, a._[0], { source: a.source, url: a.url, creator: a.creator, name: a.name, tags: a.tags ? String(a.tags).split(',') : [] });
    console.log(`Imported ${e.id} → ${e.path}${e.provenance_missing ? '\nWarning: record --url and --creator for provenance.' : ''}`);
  } else if (command === 'validate') {
    const r = await validate(ctx, { deep: a.deep === true });
    for (const w of r.warnings) console.log(`warning: ${w}`);
    for (const e of r.errors) console.log(`error: ${e}`);
    console.log(`${r.entries} entries checked: ${r.errors.length} errors, ${r.warnings.length} warnings.`);
    if (r.errors.length) process.exitCode = 1;
  } else {
    console.log(`Asset library for HyperFrames compositions.
  setup [--from DIR] [--source ID]   install or repair (idempotent; scans DIR, default ~/Downloads, for manual packs)
  update [--source ID]               re-download automatic sources on purpose
  status                             what is installed and what needs a manual download
  search <words> [--category motion|sound|animation|illustration|icon] [--format lottie|svg|png|mp3|wav|js] [--installed] [--json]
  show <id>                          full entry, license and local path
  use <id|phosphor:regular/name|editorial-pattern>... --project <dir> [--at s] [--track n]   copy into a composition and print snippets
  import <file> --source lottiefiles --url <page> --creator <name> [--name] [--tags a,b]
  validate [--deep]                  check catalogue, files, formats and checksums`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
