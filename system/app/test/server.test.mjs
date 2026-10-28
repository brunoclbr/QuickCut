import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, mediaRange, start } from '../server.mjs';
import { createVoiceover } from '../../voiceover/service.mjs';

// Fake ElevenLabs account and key store: no network, no Keychain.
const KEY = 'sk_test_0123456789abcdefghijklmnopqrstuv';
function fakeVoiceover(root) {
  let stored = null;
  const store = { has: async () => Boolean(stored), get: async () => stored, set: async k => { stored = k; }, delete: async () => { stored = null; } };
  class ElevenLabsClient {
    constructor({ apiKey }) { this.apiKey = apiKey; }
    get user() { return { get: async () => { if (this.apiKey !== KEY) throw Object.assign(new Error('401'), { statusCode: 401, body: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } }); return { firstName: 'Ada', subscription: { tier: 'creator', characterCount: 10, characterLimit: 100 } }; } }; }
    get voices() { return { search: async () => ({ voices: [] }) }; }
  }
  return { store, voiceover: createVoiceover({ root, store, sdk: { ElevenLabsClient } }), stored: () => stored };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editing-companion-test-'));
  for (const folder of ['system/setup', 'workspace/preferences', 'workspace/assets', 'workspace/drop-videos-here', 'workspace/finished-videos', 'workspace/finished-videos/main', 'workspace/projects/main/sample/drafts', 'workspace/projects/main/sample/source', 'workspace/projects/main/nosource/drafts']) await fs.mkdir(path.join(root, folder), { recursive: true });
  for (const [file, text] of Object.entries({ 'AGENTS.md': 'Instructions', 'system/setup/setup-notes.md': 'Not yet verified', 'workspace/preferences/editing-guide.md': '# Guide\nOriginal preference\n', 'workspace/preferences/editing-rules.md': '# Rules', 'workspace/assets/asset-index.md': '# Assets', 'workspace/drop-videos-here/README.md': '# Drop here', 'workspace/drop-videos-here/my-take.mov': 'raw', 'workspace/drop-videos-here/old.mov → moved to old-project.txt': 'note', 'workspace/finished-videos/README.md': '# Finished', 'workspace/finished-videos/main/sample.mp4': 'final', 'workspace/projects/main/sample/brief.md': '# Brief', 'workspace/projects/main/sample/feedback.md': '# Feedback', 'workspace/projects/main/sample/drafts/draft-01.mp4': '0123456789' })) await fs.writeFile(path.join(root, file), text);
  const fake = fakeVoiceover(root);
  const server = createApp({ root, voiceover: fake.voiceover }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const state = await (await fetch(`${url}/api/state`)).json();
  const getDoc = file => fetch(`${url}/api/document?path=${encodeURIComponent(file)}`).then(r => r.json());
  return { root, url, state, getDoc, fake };
}
test('discovers actual project files and reads Markdown without changing it', async t => {
  const f = await fixture(t); const sample = f.state.videos.find(p => p.name === 'sample');
  assert.equal(sample.drafts.length, 1); assert.equal(sample.approved, null);
  assert.equal((await f.getDoc('workspace/preferences/editing-guide.md')).content, '# Guide\nOriginal preference\n');
});
test('lists the drop folder, moved-video notes, finished videos and tells a missing source/ folder apart from an empty one', async t => {
  const f = await fixture(t);
  assert.equal(f.state.dropFolder, 'workspace/drop-videos-here'); assert.equal(f.state.dropFolderExists, true);
  assert.deepEqual(f.state.newVideos.map(v => v.name), ['my-take.mov']);
  assert.deepEqual(f.state.movedNotes, ['old.mov → moved to old-project']);
  assert.equal(f.state.finishedFolder, 'workspace/finished-videos'); assert.deepEqual(f.state.finishedVideos.map(v => v.name), ['sample.mp4']);
  const byName = Object.fromEntries(f.state.videos.map(p => [p.name, p]));
  assert.equal(byName.sample.sourceExists, true); assert.equal(byName.sample.source.length, 0);
  assert.equal(byName.nosource.sourceExists, false);
  await fs.rm(path.join(f.root, 'workspace/drop-videos-here'), { recursive: true });
  const state = await (await fetch(`${f.url}/api/state`)).json();
  assert.equal(state.dropFolderExists, false); assert.deepEqual(state.newVideos, []);
});
test('is read-only: every write method is refused and nothing changes on disk', async t => {
  const f = await fixture(t), file = 'workspace/preferences/editing-guide.md';
  for (const [method, route] of [['POST', '/api/document'], ['PUT', '/api/document'], ['DELETE', `/media?path=${encodeURIComponent('workspace/projects/main/sample/drafts/draft-01.mp4')}`], ['POST', '/api/run']]) {
    const response = await fetch(`${f.url}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify({ path: file, content: 'x', project: "main", video: "sample", draft: 'workspace/projects/main/sample/drafts/draft-01.mp4' }) });
    assert.equal(response.status, 405, `${method} ${route}`);
  }
  assert.equal(await fs.readFile(path.join(f.root, file), 'utf8'), '# Guide\nOriginal preference\n');
  assert.equal(await fs.readFile(path.join(f.root, 'workspace/projects/main/sample/feedback.md'), 'utf8'), '# Feedback');
  assert.equal(await fs.readFile(path.join(f.root, 'workspace/projects/main/sample/drafts/draft-01.mp4'), 'utf8'), '0123456789');
  await assert.rejects(fs.access(path.join(f.root, 'workspace/.companion-backups')));
});
test('recognizes an approval that Codex recorded in feedback', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'workspace/projects/main/sample/feedback.md'), '# Feedback\n\n## Approved version\nDraft: drafts/draft-01.mp4\nApproved by the owner on 2026-10-09 after a full review.\n');
  const state = await (await fetch(`${f.url}/api/state`)).json();
  assert.equal(state.videos.find(p => p.name === 'sample').approved, 'workspace/projects/main/sample/drafts/draft-01.mp4');
  await fs.writeFile(path.join(f.root, 'workspace/projects/main/sample/feedback.md'), '## Approved version\nDraft: drafts/not-there.mp4\n');
  assert.equal((await (await fetch(`${f.url}/api/state`)).json()).videos.find(p => p.name === 'sample').approved, null);
});
test('rejects traversal, hidden files, absolute paths and symlink escapes', async t => {
  const f = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-companion-')); t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'secret.md'), 'Never expose');
  await fs.symlink(path.join(outside, 'secret.md'), path.join(f.root, 'workspace/preferences/escape.md'));
  for (const file of ['workspace/../AGENTS.md', 'workspace/preferences/../../AGENTS.md', 'workspace/.secret.md', '/etc/passwd.md', 'workspace\\preferences\\editing-guide.md', 'workspace/preferences/escape.md']) {
    assert.equal((await fetch(`${f.url}/api/document?path=${encodeURIComponent(file)}`)).status, 403, file);
  }
});
test('refuses foreign Host and Origin headers', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.url}/api/state`, { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = http.get(`${f.url}/api/state`, { headers: { Host: 'unrelated.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(status, 403);
});
test('streams untouched media with seekable ranges, HEAD and invalid-range handling', async t => {
  const f = await fixture(t); const route = `${f.url}/media?path=${encodeURIComponent('workspace/projects/main/sample/drafts/draft-01.mp4')}`;
  let response = await fetch(route, { headers: { Range: 'bytes=2-5' } }); assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await response.text(), '2345');
  response = await fetch(route, { headers: { Range: 'bytes=-3' } }); assert.equal(await response.text(), '789');
  response = await fetch(route, { method: 'HEAD' }); assert.equal(response.headers.get('content-length'), '10'); assert.equal(await response.text(), '');
  assert.equal((await fetch(route, { headers: { Range: 'bytes=90-' } })).status, 416);
  assert.equal((await fetch(`${f.url}/media?path=system/setup/setup-notes.md`)).status, 403);
});
test('serves only app static files and a restrictive content security policy', async t => {
  const f = await fixture(t); const response = await fetch(f.url);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await response.text(), /id="nav"/);
  assert.equal((await fetch(`${f.url}/server.mjs`)).status, 404);
});
test('range parser clamps upper bound and refuses multiple ranges', () => {
  assert.deepEqual(mediaRange('bytes=8-100', 10), { start: 8, end: 9 });
  for (const value of ['bytes=1-2,4-5', 'bytes=-0', 'bytes=-', 'bytes=5-2']) assert.throws(() => mediaRange(value, 10));
});
test('skips another project’s IPv6 listener even if an IPv4 bind would succeed', async t => {
  const first = http.createServer();
  await new Promise((resolve, reject) => { first.once('error', reject); first.listen(0, '::1', resolve); });
  const second = await start({ port: first.address().port });
  t.after(async () => { await new Promise(resolve => first.close(resolve)); await new Promise(resolve => second.server.close(resolve)); });
  assert.notEqual(first.address().port, second.server.address().port);
});
test('uses another local port rather than stopping an occupied service', async t => {
  const first = createApp(); await new Promise(resolve => first.listen(0, '127.0.0.1', resolve));
  const second = await start({ port: first.address().port });
  t.after(async () => { await new Promise(resolve => first.close(resolve)); await new Promise(resolve => second.server.close(resolve)); });
  assert.notEqual(first.address().port, second.server.address().port);
});
test('ElevenLabs key: the only write, same-origin JSON only, saved to the store and never sent back', async t => {
  const f = await fixture(t);
  assert.equal(f.state.voiceover.connected, false);
  const post = (route, body, headers = {}) => fetch(`${f.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.url, ...headers }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${f.url}/api/voiceover/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: KEY }) })).status, 403, 'no Origin');
  assert.equal((await post('/api/voiceover/connect', { apiKey: KEY }, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await post('/api/voiceover/connect', { apiKey: KEY }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('/api/voiceover/connect', { apiKey: KEY }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/voiceover/connect', { apiKey: 'x'.repeat(5000) })).status, 413);
  assert.equal(f.fake.stored(), null);

  const wrong = await post('/api/voiceover/connect', { apiKey: 'sk_wrong_0123456789abcdefghijkl' });
  assert.equal(wrong.status, 400); assert.match((await wrong.json()).error, /did not accept/);
  assert.equal(f.fake.stored(), null);

  const ok = await post('/api/voiceover/connect', { apiKey: KEY });
  const text = await ok.text();
  assert.equal(ok.status, 200); assert.ok(!text.includes(KEY)); assert.equal(JSON.parse(text).account.name, 'Ada');
  assert.equal(f.fake.stored(), KEY);
  const state = await (await fetch(`${f.url}/api/state`)).text();
  assert.ok(!state.includes(KEY)); assert.equal(JSON.parse(state).voiceover.connected, true);
  const files = await fs.readdir(f.root, { recursive: true });
  for (const file of files) { const p = path.join(f.root, file); if ((await fs.stat(p)).isFile()) assert.ok(!(await fs.readFile(p, 'utf8')).includes(KEY), file); }

  assert.equal((await post('/api/voiceover/disconnect', {})).status, 200);
  assert.equal(f.fake.stored(), null);
  assert.equal((await fetch(`${f.url}/api/voiceover/connect`, { method: 'PUT', headers: { Origin: f.url } })).status, 405);
});

test('Show in Finder: same-origin JSON only, workspace files only, and it changes nothing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editing-companion-reveal-'));
  for (const folder of ['workspace/finished-videos', 'workspace/finished-videos/main', 'system']) await fs.mkdir(path.join(root, folder), { recursive: true });
  await fs.writeFile(path.join(root, 'workspace/finished-videos/final.mp4'), 'final'); await fs.writeFile(path.join(root, 'system/x.md'), 'x');
  const revealed = [];
  const server = createApp({ root, voiceover: fakeVoiceover(root).voiceover, reveal: async file => { revealed.push(file); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const send = (body, headers = { Origin: url, 'Content-Type': 'application/json' }) => fetch(`${url}/api/reveal`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await send({ path: 'workspace/finished-videos/final.mp4' })).status, 200);
  assert.deepEqual(revealed, [await fs.realpath(path.join(root, 'workspace/finished-videos/final.mp4'))]);
  assert.equal((await send({ path: 'workspace/finished-videos/final.mp4' }, { 'Content-Type': 'application/json' })).status, 403, 'no Origin');
  assert.equal((await send({ path: 'workspace/finished-videos/final.mp4' }, { Origin: 'http://evil.example', 'Content-Type': 'application/json' })).status, 403, 'foreign Origin');
  assert.equal((await send({ path: 'workspace/finished-videos/final.mp4' }, { Origin: url, 'Content-Type': 'text/plain' })).status, 415);
  for (const bad of ['system/x.md', 'workspace/../system/x.md', '/etc/hosts', 'workspace/.hidden', 42]) assert.equal((await send({ path: bad })).status, 403, String(bad));
  assert.equal(revealed.length, 1);
  assert.equal(await fs.readFile(path.join(root, 'workspace/finished-videos/final.mp4'), 'utf8'), 'final');
});

test('state includes an asset overview grouped for the Setup page and no repo info outside git', async t => {
  const f = await fixture(t);
  for (const [file, text] of Object.entries({ 'workspace/assets/sounds/mixkit/Fast Whoosh.wav': 'w', 'workspace/assets/music/track.mp3': 'm', 'workspace/assets/fonts/inter/Inter.ttf': 'f', 'workspace/assets/icons/phosphor/regular/a.svg': '<svg/>' })) {
    await fs.mkdir(path.dirname(path.join(f.root, file)), { recursive: true }); await fs.writeFile(path.join(f.root, file), text);
  }
  const state = await (await fetch(`${f.url}/api/state`)).json();
  assert.deepEqual(state.assetOverview.sounds.map(s => [s.name, s.source]), [['Fast Whoosh.wav', 'mixkit']]);
  assert.deepEqual(state.assetOverview.music.map(m => m.name), ['track.mp3']);
  assert.deepEqual(state.assetOverview.fonts.map(m => m.name), ['Inter.ttf']);
  assert.equal(state.assetOverview.counts.icons, 1);
  assert.equal(state.repo, null);
});

test('state names the workspace from workspace.md, and reports each project’s poster and size', async t => {
  const f = await fixture(t);
  let state = await (await fetch(`${f.url}/api/state`)).json();
  assert.deepEqual(state.workspace, { file: 'workspace/preferences/workspace.md', exists: false, name: null }, 'unnamed until the AI app saves a name');
  await fs.writeFile(path.join(f.root, 'workspace/preferences/workspace.md'), '# This workspace\nName: Acme Studio\nSet up: 2026-10-28\n');
  await fs.writeFile(path.join(f.root, 'workspace/projects/main/sample/poster.jpg'), 'jpg');
  state = await (await fetch(`${f.url}/api/state`)).json();
  assert.equal(state.workspace.name, 'Acme Studio'); assert.equal(state.workspace.exists, true);
  const sample = state.videos.find(p => p.name === 'sample');
  assert.equal(sample.poster, 'workspace/projects/main/sample/poster.jpg'); assert.ok(sample.bytes > 0, 'folder size measured');
});

test('Approve: same-origin JSON only; appends the approval, copies the draft to finished-videos, replaces it later and never edits the draft', async t => {
  const f = await fixture(t);
  const call = (body, headers = { Origin: f.url, 'Content-Type': 'application/json' }) => fetch(`${f.url}/api/approve`, { method: 'POST', headers, body: JSON.stringify(body) });
  const draft = path.join(f.root, 'workspace/projects/main/sample/drafts/draft-01.mp4');
  assert.equal((await call({ project: "main", video: "sample", draft: 'drafts/draft-01.mp4' }, { 'Content-Type': 'application/json' })).status, 403, 'no Origin');
  assert.equal((await call({ project: "main", video: "sample", draft: 'drafts/draft-01.mp4' }, { Origin: 'http://evil.example', 'Content-Type': 'application/json' })).status, 403, 'foreign Origin');
  assert.equal((await call({ project: "main", video: "sample", draft: 'drafts/draft-01.mp4' }, { Origin: f.url, 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call({ project: "main", video: "sample", draft: '../../editing-guide.md' })).status, 400, 'only drafts/ videos');
  assert.equal((await call({ project: '../x', draft: 'drafts/draft-01.mp4' })).status, 400);
  assert.equal((await call({ project: "main", video: "sample", draft: 'drafts/missing.mp4' })).status, 404);
  assert.equal(await fs.readFile(path.join(f.root, 'workspace/projects/main/sample/feedback.md'), 'utf8'), '# Feedback', 'refused calls write nothing');
  const ok = await call({ project: "main", video: "sample", draft: 'drafts/draft-01.mp4' }); assert.equal(ok.status, 200);
  assert.equal(await fs.readFile(path.join(f.root, 'workspace/finished-videos/main/sample.mp4'), 'utf8'), '0123456789');
  const feedback = await fs.readFile(path.join(f.root, 'workspace/projects/main/sample/feedback.md'), 'utf8');
  assert.match(feedback, /^# Feedback\n\n## Approved version\nDraft: drafts\/draft-01\.mp4\nApproved by the owner on \d{4}-\d{2}-\d{2} after a full review\./);
  assert.equal(await fs.readFile(draft, 'utf8'), '0123456789', 'the draft itself is untouched');
  const state = await (await fetch(`${f.url}/api/state`)).json(); const sample = state.videos.find(p => p.name === 'sample');
  assert.equal(sample.approved, 'workspace/projects/main/sample/drafts/draft-01.mp4'); assert.match(sample.approvedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await call({ project: "main", video: "sample", draft: 'drafts/draft-01.mp4', version: 'youtube' })).status, 409, 'a versionless finished file must be renamed first');
});
