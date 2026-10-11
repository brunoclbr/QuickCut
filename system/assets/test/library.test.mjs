import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { context, setup, search, use, validate, validateFile, importFile, defaultRoot } from '../library.mjs';

const run = promisify(execFile);
const lottie = JSON.stringify({ v: '5.7.4', fr: 30, ip: 0, op: 30, w: 100, h: 100, layers: [] });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-lib-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of ['system/assets/hf', 'system/assets/editorial/sounds', 'system/assets/originals/lottie', 'system/assets/vendor', 'home/.claude/skills/media-use/audio/assets/sfx', 'downloads', 'project']) await fs.mkdir(path.join(root, dir), { recursive: true });
  await fs.copyFile(path.join(defaultRoot, 'system/assets/catalog.json'), path.join(root, 'system/assets/catalog.json'));
  await fs.copyFile(path.join(defaultRoot, 'system/assets/hf/motion.js'), path.join(root, 'system/assets/hf/motion.js'));
  await fs.copyFile(path.join(defaultRoot, 'system/assets/originals/lottie/success-check.json'), path.join(root, 'system/assets/originals/lottie/success-check.json'));
  await fs.copyFile(path.join(defaultRoot, 'system/assets/editorial/editorial.js'), path.join(root, 'system/assets/editorial/editorial.js'));
  await fs.writeFile(path.join(root, 'system/assets/editorial/sounds/sound-cues.json'), '{"cues":[]}');
  for (const f of ['gsap.min.js', 'lottie.min.js']) await fs.writeFile(path.join(root, 'system/assets/vendor', f), '// stub');
  // A tiny real MP3 so audio validation decodes it.
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.3', '-q:a', '9', path.join(root, 'home/.claude/skills/media-use/audio/assets/sfx/pop.mp3')]);
  await fs.writeFile(path.join(root, 'home/.claude/skills/media-use/audio/assets/sfx/CREDITS.md'), 'Pixabay');
  return { root, ctx: context({ root, home: path.join(root, 'home'), downloads: path.join(root, 'downloads'), log: () => {} }) };
}
async function zip(dir, name, files) {
  const src = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-src-'));
  for (const [rel, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(src, rel)), { recursive: true }); await fs.writeFile(path.join(src, rel), content); }
  await run('zip', ['-q', '-r', path.join(dir, name), '.'], { cwd: src });
  await fs.rm(src, { recursive: true, force: true });
}

test('validates only formats HyperFrames can render deterministically', async t => {
  const { root } = await fixture(t);
  const file = (name, content) => fs.writeFile(path.join(root, name), content).then(() => path.join(root, name));
  assert.equal(await validateFile(await file('a.json', lottie)), null);
  assert.match(await validateFile(await file('b.json', '{"hello":1}')), /not a Lottie/);
  assert.equal(await validateFile(await file('c.svg', svg)), null);
  assert.match(await validateFile(await file('d.svg', '<svg onload="alert(1)"></svg>')), /script/);
  assert.match(await validateFile(await file('e.gif', 'GIF89a')), /unsupported/);
  assert.match(await validateFile(await file('f.png', 'nope')), /not a PNG/);
});

test('setup installs local sources once and is idempotent', async t => {
  const { root, ctx } = await fixture(t);
  const first = await setup(ctx, { only: 'pixabay' });
  assert.equal(first.pixabay.status, 'installed');
  assert.ok(await fs.stat(path.join(root, 'workspace/assets/sounds/pixabay/pop.mp3')));
  assert.equal((await setup(ctx, { only: 'pixabay' })).pixabay.status, 'unchanged');
  await fs.rm(path.join(root, 'workspace/assets/sounds/pixabay/pop.mp3'));
  assert.match((await validate(ctx)).errors.join('\n'), /pixabay: installed files changed or missing/);
  assert.equal((await setup(ctx, { only: 'pixabay' })).pixabay.status, 'installed', 'a missing file triggers repair');
  assert.equal((await setup(ctx, { only: 'original' })).original.status, 'installed');
});

test('imports a manual pack from Downloads, keeps compatible files and skips the rest', async t => {
  const { root, ctx } = await fixture(t);
  assert.equal((await setup(ctx, { only: 'open-stickers' }))['open-stickers'].status, 'missing');
  await zip(path.join(root, 'downloads'), 'Open Stickers.zip', { 'Open Stickers/Technologies/blob-1.svg': svg, 'Open Stickers/PNG/blob-1.png': 'png', 'Open Stickers/Figma/file.fig': 'x', 'Open Stickers/broken.svg': '<svg onload="x()"></svg>' });
  const r = (await setup(ctx, { only: 'open-stickers' }))['open-stickers'];
  assert.deepEqual([r.status, r.added], ['installed', 1]);
  const found = await search(ctx, ['blob']);
  assert.equal(found.results[0].installed, true);
  assert.match(found.results[0].license, /local only/);
  assert.equal((await setup(ctx, { only: 'open-stickers' }))['open-stickers'].status, 'unchanged');
});

test('refuses archives with unsafe paths', async t => {
  const { root, ctx } = await fixture(t);
  const src = await fs.mkdtemp(path.join(os.tmpdir(), 'evil-'));
  await fs.mkdir(path.join(src, 'a'), { recursive: true });
  await fs.writeFile(path.join(src, 'evil.json'), lottie);
  await run('zip', ['-q', path.join(root, 'downloads/open-stickers-evil.zip'), '../evil.json'], { cwd: path.join(src, 'a') });
  await fs.rm(src, { recursive: true, force: true });
  const r = (await setup(ctx, { only: 'open-stickers' }))['open-stickers'];
  assert.equal(r.status, 'error');
  assert.match(r.error, /unsafe path/);
});

test('imports a single LottieFiles file with provenance and copies chosen assets into a composition', async t => {
  const { root, ctx } = await fixture(t);
  await setup(ctx, { only: 'original' }); await setup(ctx, { only: 'pixabay' });
  await fs.writeFile(path.join(root, 'downloads/bell.json'), lottie);
  const entry = await importFile(ctx, path.join(root, 'downloads/bell.json'), { source: 'lottiefiles', url: 'https://lottiefiles.com/x', creator: 'Someone', tags: ['notification'] });
  assert.equal(entry.creator, 'Someone'); assert.ok(entry.tags.includes('notification'));
  const result = await use(ctx, ['original-success-check', 'sfx-pop', entry.id], path.join(root, 'project'), { at: 2 });
  for (const rel of ['motion.js', 'lottie.min.js', 'gsap.min.js', 'animations/lottie/original/success-check.json', 'sounds/pixabay/pop.mp3']) assert.ok(await fs.stat(path.join(root, 'project/assets/library', rel)), rel);
  assert.match(result.snippets.join('\n'), /data-no-timeline data-start="2"/);
  assert.match(result.snippets.join('\n'), /<audio id="sfx-pop-2"/);
  assert.deepEqual((await validate(ctx)).errors, []);
});

test('editorial toolkit: patterns are searchable, use copies editorial.js, and only sound files install', async t => {
  const { root, ctx } = await fixture(t);
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=2000:duration=0.15', path.join(root, 'system/assets/editorial/sounds/tactile-click.wav')]);
  const r = (await setup(ctx, { only: 'editorial-sounds' }))['editorial-sounds'];
  assert.deepEqual([r.status, r.added], ['installed', 1], 'sound-cues.json is metadata, not an asset');
  const found = await search(ctx, ['screenshot', 'proof']);
  assert.equal(found.results[0].id, 'editorial-proof');
  assert.equal(found.results[0].category, 'motion');
  assert.equal((await search(ctx, ['click'], { category: 'sound', onlyInstalled: true })).results[0].id, 'sfx-editorial-tactile-click');
  const result = await use(ctx, ['editorial-proof', 'sfx-editorial-tactile-click'], path.join(root, 'project'), { at: 2 });
  assert.ok(await fs.stat(path.join(root, 'project/assets/library/editorial.js')));
  assert.ok(result.scripts.includes('<script src="assets/library/editorial.js"></script>'));
  const html = result.snippets.join('\n');
  assert.match(html, /<div id="editorial-proof-host" class="clip" data-start="2"/);
  assert.match(html, /HFEditorial.proofIn\(tl, "#editorial-proof", 2\); HFEditorial.proofOut\(tl, "#editorial-proof", 4.1\);/);
  assert.match(html, /data-volume="0.126"/, 'toolkit gain (-18 dB) instead of the generic 0.35');
  await setup(ctx, { only: 'original' });
  const plain = await use(ctx, ['original-success-check'], path.join(root, 'project'), { at: 0 });
  assert.ok(!plain.scripts.some(s => s.includes('editorial.js')), 'compositions only load the toolkit when they use it');
});
