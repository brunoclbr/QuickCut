import http from 'node:http';
import net from 'node:net';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { context as libraryContext, status as libraryStatus } from '../assets/library.mjs';
import { createVoiceover } from '../voiceover/service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultRoot = path.resolve(here, '../..');
const publicRoot = path.join(here, 'public');
const run = promisify(execFile);
const projectName = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/;
const mediaTypes = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
export const dropFolder = 'workspace/drop-videos-here';
export const finishedFolder = 'workspace/finished-videos';
const fail = (status, message) => Object.assign(new Error(message), { status });
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
export function mediaRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) throw fail(416, 'Invalid media range');
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw fail(416, 'Media range outside file');
  return { start, end };
}
export async function safePath(root, file, { missing = false } = {}) {
  if (typeof file !== 'string' || file.includes('\\') || file.includes('\0') || file.split('/').some(part => !part || part.startsWith('.'))) throw fail(403, 'Invalid file path');
  if (!(file.startsWith('workspace/') || file.startsWith('system/')) && !['AGENTS.md', 'README.md'].includes(file)) throw fail(403, 'File outside the editing workspace');
  const base = await fs.realpath(root);
  const target = path.resolve(base, file);
  if (!inside(base, target)) throw fail(403, 'File outside the editing workspace');
  // Real-path checks prevent a symlink from exposing or overwriting files elsewhere.
  const scope = file.startsWith('workspace/') ? path.join(base, 'workspace') : file.startsWith('system/') ? path.join(base, 'system') : base;
  const realScope = await fs.realpath(scope);
  if (!inside(base, realScope) || realScope !== scope) throw fail(403, 'Workspace root must not be a symlink');
  try {
    const real = await fs.realpath(target);
    if (!inside(realScope, real)) throw fail(403, 'Symlink outside permitted folder');
    return real;
  } catch (error) {
    if (error.code !== 'ENOENT' || !missing) throw error;
    const parent = await fs.realpath(path.dirname(target));
    if (!inside(realScope, parent)) throw fail(403, 'Symlink outside permitted folder');
    return path.join(parent, path.basename(target));
  }
}
async function document(root, file) {
  if (typeof file !== 'string') throw fail(400, 'A document path is required');
  if (!file.endsWith('.md')) throw fail(403, 'Only Markdown documents can be read here');
  let content = '';
  try { const resolved = await safePath(root, file); if ((await fs.stat(resolved)).size > 1024 * 1024) throw fail(413, 'Document exceeds 1 MB'); content = await fs.readFile(resolved, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await safePath(root, file, { missing: true }); }
  return { path: file, content };
}
async function entries(root, file) {
  try { return await fs.readdir(await safePath(root, file), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function folderExists(root, folder) {
  try { return (await fs.stat(await safePath(root, folder))).isDirectory(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function mediaFiles(root, folder) {
  const files = [];
  for (const entry of await entries(root, folder)) {
    if (!entry.isFile() || !mediaTypes[path.extname(entry.name).toLowerCase()]) continue;
    const file = `${folder}/${entry.name}`;
    const stat = await fs.stat(await safePath(root, file));
    files.push({ name: entry.name, path: file, bytes: stat.size, modified: stat.mtime.toISOString() });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
function approvedOn(text) {
  const records = [...text.matchAll(/^## Approved version\nDraft: [^\n]+\nApproved by the owner on ([^\n]+?) after /gm)];
  return records.length ? records.at(-1)[1].trim() : null;
}
function approvedDraft(text) {
  const records = [...text.matchAll(/^## Approved version\nDraft: (drafts\/[^\n]+)$/gm)];
  if (records.length) return records.at(-1)[1];
  return /^Filename: (drafts\/[^\n]+\.mp4) — full-video draft accepted as final/m.exec(text)?.[1] || null;
}
// Disk use of a folder in bytes (du, read-only); null when it cannot be measured.
async function folderBytes(root, folder) {
  try { const { stdout } = await run('du', ['-sk', await safePath(root, folder)], { timeout: 8000 }); const kb = Number(stdout.split(/\s/)[0]); return Number.isFinite(kb) ? kb * 1024 : null; }
  catch { return null; }
}
// The workspace's name: the "Name:" line of workspace/preferences/workspace.md (one brand or client per copy of this folder).
async function workspaceInfo(root) {
  const file = 'workspace/preferences/workspace.md';
  const { content } = await document(root, file);
  return { file, exists: Boolean(content), name: /^Name:[ \t]*(.+)$/m.exec(content)?.[1].trim() || null };
}
// Workspace -> projects -> videos: workspace/projects/<project>/<video>/. A project folder may hold a project.md ("Name:", "About:").
async function projectGroups(root) {
  const result = [];
  for (const entry of await entries(root, 'workspace/projects')) {
    if (!entry.isDirectory() || !projectName.test(entry.name)) continue;
    const folder = `workspace/projects/${entry.name}`;
    const meta = (await document(root, `${folder}/project.md`)).content;
    result.push({ name: entry.name, folder, title: /^Name:[ \t]*(.+)$/m.exec(meta)?.[1].trim() || entry.name, about: /^About:[ \t]*(.+)$/m.exec(meta)?.[1].trim() || '' });
  }
  return result.sort((a, b) => a.title.localeCompare(b.title));
}
async function videos(root, groups) {
  const result = [];
  for (const group of groups) for (const entry of await entries(root, group.folder)) {
    if (!entry.isDirectory() || !projectName.test(entry.name)) continue;
    const folder = `${group.folder}/${entry.name}`;
    const feedback = await document(root, `${folder}/feedback.md`);
    const files = await entries(root, folder);
    const drafts = (await mediaFiles(root, `${folder}/drafts`)).filter(d => /\.(mp4|mov|m4v|webm)$/i.test(d.name));   // videos only (drafts/audio holds the voice + effects WAVs)
    const approved = approvedDraft(feedback.content);
    result.push({ name: entry.name, project: group.name, projectTitle: group.title, folder, drafts, sourceExists: await folderExists(root, `${folder}/source`), source: await mediaFiles(root, `${folder}/source`), approved: drafts.some(d => `${folder}/${approved}` === d.path) ? `${folder}/${approved}` : null, approvedOn: approvedOn(feedback.content), poster: files.some(e => e.isFile() && e.name === 'poster.jpg') ? `${folder}/poster.jpg` : null, plan: files.some(e => e.isFile() && e.name === 'plan.md') ? `${folder}/plan.md` : null, bytes: await folderBytes(root, folder) });
  }
  return result.sort((a, b) => a.projectTitle.localeCompare(b.projectTitle) || a.name.localeCompare(b.name));
}
// Finished videos live in workspace/finished-videos/<project>/ (files directly in finished-videos/ are listed too, without a project).
async function finishedFiles(root) {
  const result = (await mediaFiles(root, finishedFolder)).map(f => ({ ...f, project: '' }));
  for (const entry of await entries(root, finishedFolder)) if (entry.isDirectory() && projectName.test(entry.name)) result.push(...(await mediaFiles(root, `${finishedFolder}/${entry.name}`)).map(f => ({ ...f, project: entry.name })));
  return result;
}
async function assets(root, folder = 'workspace/assets', depth = 0) {
  const result = [];
  for (const entry of await entries(root, folder)) {
    if (entry.name.startsWith('.') || entry.name === 'models') continue;
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory() && depth < 2) result.push(...await assets(root, file, depth + 1));
    else if (entry.isFile() && (mediaTypes[path.extname(entry.name).toLowerCase()] || /\.(ttf|otf|md)$/i.test(entry.name))) result.push({ name: entry.name, path: file, type: path.extname(entry.name).slice(1), preview: Boolean(mediaTypes[path.extname(entry.name).toLowerCase()]) });
  }
  return result.slice(0, 300);
}
// Summary of the asset library, or null when it has never been set up or cannot be read.
async function library(root) {
  try {
    const s = await libraryStatus(libraryContext({ root, log: () => {} }));
    return { available: s.available, catalogued: s.catalogued, sources: s.rows.map(({ id, acquisition, installed, files, url }) => ({ id, acquisition, installed, files, url })) };
  } catch { return null; }
}
// Installed assets grouped for the overview: sounds and music listed (with their source folder), the rest counted.
async function walkFiles(root, folder, test, depth, out, cap = 20000) {
  for (const entry of await entries(root, folder)) {
    if (out.length >= cap || entry.name.startsWith('.')) continue;
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory() && depth > 0) await walkFiles(root, file, test, depth - 1, out, cap);
    else if (entry.isFile() && test(entry.name)) out.push(file);
  }
  return out;
}
async function assetOverview(root) {
  const audio = name => /\.(wav|mp3|m4a|ogg)$/i.test(name);
  const item = file => ({ name: path.basename(file), path: file, source: file.split('/')[3] });
  return {
    sounds: (await walkFiles(root, 'workspace/assets/sounds', audio, 1, [], 500)).map(item),
    music: (await walkFiles(root, 'workspace/assets/music', audio, 1, [], 200)).map(file => ({ name: path.basename(file), path: file })),
    fonts: (await walkFiles(root, 'workspace/assets/fonts', name => /\.(ttf|otf)$/i.test(name), 1, [], 100)).map(item),
    counts: {
      icons: (await walkFiles(root, 'workspace/assets/icons', name => /\.svg$/i.test(name), 4, [])).length,
      animations: (await walkFiles(root, 'workspace/assets/animations', name => /\.json$/i.test(name), 3, [])).length,
      illustrations: (await walkFiles(root, 'workspace/assets/illustrations', name => /\.(svg|png)$/i.test(name), 5, [])).length,
    },
  };
}
// When this copy of the repo last changed (from git's own log file; no git command is run). Null outside a git checkout.
async function repoInfo(root) {
  try {
    const log = (await fs.readFile(path.join(root, '.git', 'logs', 'HEAD'), 'utf8')).trim().split('\n').at(-1);
    const seconds = Number(/ (\d{9,}) [+-]\d{4}\t/.exec(log)?.[1]);
    const head = (await fs.readFile(path.join(root, '.git', 'HEAD'), 'utf8')).trim();
    return { lastChanged: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null, branch: /^ref: refs\/heads\/(.+)$/.exec(head)?.[1] || null };
  } catch { return null; }
}
// Show a file in Finder (macOS). Opens a window; changes nothing.
async function revealInFinder(file) {
  if (process.platform !== 'darwin') throw fail(501, 'Show in Finder works on macOS only');
  await run('open', ['-R', file], { timeout: 4000 });
}
// Third owner-approved exception (2026-10-28): approving a draft from the companion. It does exactly what AGENTS.md asks the AI app
// to do on approval: appends the approval record to the video's feedback.md (append only), copies the draft to finished-videos/
// (replacing that version's previous finished copy) and makes the small poster. It never renders, edits or deletes anything.
const finishedVersions = { '': '', vertical: '-vertical', square: '-square', youtube: '-youtube' };
async function makePoster(from, to) {
  const candidates = ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg'];
  const filters = ['zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,scale=360:-2,format=yuvj420p', 'scale=360:-2'];
  for (const bin of candidates) for (const vf of filters) {
    try { await run(bin, ['-v', 'error', '-y', '-ss', '0.8', '-i', from, '-frames:v', '1', '-vf', vf, '-q:v', '4', to], { timeout: 30000 }); return true; } catch { /* try the next */ }
  }
  return false;
}
async function approveDraft(root, { project, video, draft, version = '' }) {
  if (typeof project !== 'string' || !projectName.test(project) || typeof video !== 'string' || !projectName.test(video)) throw fail(400, 'Unknown video');
  if (typeof draft !== 'string' || !/^drafts\/[^/]+\.(mp4|mov|m4v|webm)$/i.test(draft)) throw fail(400, 'Pick one of this video’s drafts');
  if (!(version in finishedVersions)) throw fail(400, 'Unknown version');
  const folder = `workspace/projects/${project}/${video}`;
  const source = await safePath(root, `${folder}/${draft}`);
  if (!(await fs.stat(source)).isFile()) throw fail(404, 'Draft not found');
  const finished = await entries(root, `${finishedFolder}/${project}`);
  const names = finished.filter(e => e.isFile()).map(e => e.name);
  const mine = names.filter(n => new RegExp(`^${video.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-vertical|-square|-youtube)?\\.mp4$`).test(n));
  const hasVariants = mine.some(n => /-(vertical|square|youtube)\.mp4$/.test(n));
  if (version === '' && hasVariants) throw fail(409, 'This video has several versions. Pick which one this draft replaces.');
  if (version !== '' && mine.includes(`${video}.mp4`)) throw fail(409, `${video}.mp4 exists without a version name. Ask your AI app to rename it (-vertical or -square) first.`);
  const target = `${finishedFolder}/${project}/${video}${finishedVersions[version]}.mp4`;
  const feedbackFile = await safePath(root, `${folder}/feedback.md`, { missing: true });
  const date = new Date().toLocaleDateString('en-CA');
  const existing = await fs.readFile(feedbackFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const record = `${existing && !existing.endsWith('\n') ? '\n' : ''}\n## Approved version\nDraft: ${draft}\nApproved by the owner on ${date} after a full review.\nApproved in the companion app; copied to ${target.replace('workspace/', '')}.\n`;
  // copy first (to a temp name, then rename), record second: a failed copy leaves no approval behind
  await fs.mkdir(path.join(await safePath(root, finishedFolder), project), { recursive: true });
  const destination = await safePath(root, target, { missing: true });
  const temp = `${destination}.tmp-${process.pid}`;
  try { await fs.copyFile(source, temp); await fs.rename(temp, destination); } catch (error) { await fs.rm(temp, { force: true }); throw error; }
  await fs.appendFile(feedbackFile, record);
  const poster = await makePoster(source, await safePath(root, `${folder}/poster.jpg`, { missing: true }));
  return { ok: true, finished: target, poster, date };
}
async function readJsonBody(req, limit = 4096) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'Request too large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw fail(400, 'Invalid request'); }
}
async function probe(command, args) {
  try { const { stdout, stderr } = await run(command, args, { timeout: 4000, maxBuffer: 65536 }); return { detected: true, version: (stdout || stderr).trim().split('\n')[0] }; }
  catch { return { detected: false, version: 'Not detected on this process PATH' }; }
}
export function createApp({ root = defaultRoot, voiceover = createVoiceover({ root }), reveal = revealInFinder } = {}) {
  let connecting = false;
  const voiceoverStatus = async () => { try { return await voiceover.status(); } catch { return null; } };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const port = server.address()?.port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host)) throw fail(403, 'Localhost requests only');
      const origin = req.headers.origin;
      if (origin && !hosts.some(host => origin === `http://${host}`)) throw fail(403, 'Cross-origin requests are not allowed');
      const url = new URL(req.url, 'http://localhost');
      // Exception to read-only (owner-approved): saving or removing the ElevenLabs key, so the key
      // never passes through the AI app. Same-origin JSON only; the key goes to the macOS Keychain and is never sent back.
      const credential = { '/api/voiceover/connect': 'connect', '/api/voiceover/disconnect': 'disconnect' }[url.pathname];
      if (req.method === 'POST' && credential) {
        if (!origin || !['same-origin', undefined].includes(req.headers['sec-fetch-site'])) throw fail(403, 'Only this page can change the ElevenLabs connection');
        if (!/^application\/json(;|$)/.test(req.headers['content-type'] || '')) throw fail(415, 'Expected JSON');
        const body = await readJsonBody(req);
        if (connecting) throw fail(429, 'Already checking a key. Wait a moment.');
        connecting = true;
        try { return json(200, credential === 'connect' ? await voiceover.connect(body.apiKey) : await voiceover.disconnect()); }
        finally { connecting = false; }
      }
      // Second owner-approved exception (2026-10-13): Show in Finder. It opens a Finder window on a file inside workspace/
      // and changes nothing. Same-origin JSON only, like the key endpoints.
      if (req.method === 'POST' && url.pathname === '/api/reveal') {
        if (!origin || !['same-origin', undefined].includes(req.headers['sec-fetch-site'])) throw fail(403, 'Only this page can open Finder');
        if (!/^application\/json(;|$)/.test(req.headers['content-type'] || '')) throw fail(415, 'Expected JSON');
        const body = await readJsonBody(req);
        if (typeof body.path !== 'string' || !body.path.startsWith('workspace/')) throw fail(403, 'Only files in workspace/ can be shown');
        await reveal(await safePath(root, body.path));
        return json(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/approve') {
        if (!origin || !['same-origin', undefined].includes(req.headers['sec-fetch-site'])) throw fail(403, 'Only this page can approve a draft');
        if (!/^application\/json(;|$)/.test(req.headers['content-type'] || '')) throw fail(415, 'Expected JSON');
        return json(200, await approveDraft(root, await readJsonBody(req)));
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'This companion is read-only. Ask Codex to make changes.');
      if (url.pathname === '/api/health') return json(200, { app: 'local-editing-companion', root: await fs.realpath(root) });
      if (url.pathname === '/api/state') {
        const docs = ['workspace/preferences/editing-guide.md', 'workspace/preferences/editing-rules.md', 'workspace/assets/asset-index.md', 'system/setup/setup-notes.md', 'system/prompts.md'];
        const movedNotes = (await entries(root, dropFolder)).filter(e => e.isFile() && / moved to .+\.txt$/.test(e.name)).map(e => e.name.slice(0, -4)).sort();
        const groups = await projectGroups(root);
        return json(200, { root, workspace: await workspaceInfo(root), platform: process.platform, projectsFolder: 'workspace/projects', projectsFolderExists: await folderExists(root, 'workspace/projects'), library: await library(root), dropFolder, dropFolderExists: await folderExists(root, dropFolder), newVideos: await mediaFiles(root, dropFolder), movedNotes, finishedFolder, finishedVideos: await finishedFiles(root), voiceover: await voiceoverStatus(), projects: groups, videos: await videos(root, groups), assets: await assets(root), assetOverview: await assetOverview(root), repo: await repoInfo(root), documents: docs });
      }
      if (url.pathname === '/api/tools') return json(200, { node: process.version, ffmpeg: await probe('ffmpeg', ['-version']), whisper: await probe('whisper-cli', ['--help']), note: 'Detection only. A playable test and Codex review are still required to complete setup.' });
      if (url.pathname === '/api/document') return json(200, await document(root, url.searchParams.get('path')));
      if (url.pathname === '/media') {
        const file = url.searchParams.get('path');
        if (!file?.startsWith('workspace/')) throw fail(403, 'Media must be in workspace');
        const type = mediaTypes[path.extname(file).toLowerCase()];
        if (!type) throw fail(403, 'Unsupported media type');
        const resolved = await safePath(root, file); const stat = await fs.stat(resolved);
        if (!stat.isFile()) throw fail(404, 'Media file not found');
        let range;
        try { range = mediaRange(req.headers.range, stat.size); } catch (error) { res.setHeader('Content-Range', `bytes */${stat.size}`); throw error; }
        const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': range ? range.end - range.start + 1 : stat.size };
        if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
        res.writeHead(range ? 206 : 200, headers);
        if (req.method === 'HEAD') return res.end();
        const stream = createReadStream(resolved, range || {});
        stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
      }
      const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
      if (staticFiles[url.pathname]) {
        const [file, type] = staticFiles[url.pathname]; res.writeHead(200, { 'Content-Type': type }); res.end(await fs.readFile(path.join(publicRoot, file))); return;
      }
      const brandFonts = { '/brand-mono.ttf': 'workspace/assets/fonts/ibm-plex-mono/IBMPlexMono-Medium.ttf', '/brand-mono-bold.ttf': 'workspace/assets/fonts/ibm-plex-mono/IBMPlexMono-Bold.ttf', '/brand-sans.ttf': 'workspace/assets/fonts/ibm-plex-sans/IBMPlexSans-variable.ttf', '/brand-mincho.ttf': 'workspace/assets/fonts/shippori-mincho/ShipporiMincho-Medium.ttf' };
      if (brandFonts[url.pathname]) { const font = await fs.readFile(await safePath(root, brandFonts[url.pathname])); res.writeHead(200, { 'Content-Type': 'font/ttf' }); res.end(font); return; }
      if (url.pathname === '/inter.ttf') { const font = await fs.readFile(await safePath(root, 'workspace/assets/fonts/inter/Inter-variable.ttf')); res.writeHead(200, { 'Content-Type': 'font/ttf' }); res.end(font); return; }
      throw fail(404, 'Not found');
    } catch (error) {
      if (res.headersSent) return res.destroy();
      json(error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.status ? error.message : error.code === 'ENOENT' ? 'File not found' : 'Could not access the local workspace' });
    }
  });
  return server;
}
async function ipv6InUse(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '::1', port });
    let settled = false;
    const done = used => { if (settled) return; settled = true; socket.destroy(); resolve(used); };
    socket.setTimeout(200, () => done(false));
    socket.once('connect', () => done(true)); socket.once('error', () => done(false));
  });
}
export async function start({ root = defaultRoot, port = 3000 } = {}) {
  for (let candidate = port; candidate < port + 20; candidate++) {
    // macOS can allow an IPv4-specific listener beside another project's IPv6 listener.
    if (await ipv6InUse(candidate)) continue;
    const server = createApp({ root });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(candidate, '127.0.0.1', resolve); });
      return { server, url: `http://127.0.0.1:${server.address().port}` };
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('No free local port found. Set PORT to another starting port.');
}
export async function preferredPort() {
  let config = {};
  try { config = JSON.parse(await fs.readFile(path.join(here, 'config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.PORT ?? config.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65515) throw new Error('Invalid preferred port');
  return port;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await start({ port: await preferredPort() });
  console.log(`Editing companion: ${url}`);
}
