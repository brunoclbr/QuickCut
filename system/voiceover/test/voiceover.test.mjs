// Mocked ElevenLabs SDK and in-memory key store: no network, no Keychain, no credits.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createVoiceover, translate } from '../service.mjs';
import { findTags, spokenText, wordsFromAlignment } from '../alignment.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = 'sk_test_0123456789abcdefghijklmnopqrstuv';
const VOICE = 'Voice1234567890abcd';
const SCRIPT = '[warm, steady] Hello, world — it\'s "fine". [whispers] Really?';
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000, 7)]);

// Character alignment for a script: 50 ms per character, tags included (as ElevenLabs returns the input text).
function alignmentFor(text, step = 0.05) {
  const characters = [...text];
  return { characters, characterStartTimesSeconds: characters.map((_, i) => i * step), characterEndTimesSeconds: characters.map((_, i) => (i + 1) * step) };
}
const apiError = (statusCode, status, message = '') => Object.assign(new Error(`Status code: ${statusCode}`), { statusCode, body: { detail: { status, message } } });

function fakeSdk(overrides = {}) {
  const calls = [];
  class ElevenLabsClient {
    constructor(options) { calls.push({ ctor: options }); this.options = options; }
    get user() { return { get: async () => { calls.push({ user: this.options.apiKey }); if (overrides.user) return overrides.user(); return { firstName: 'Ada', xiApiKeyPreview: 'sk_t...uv', subscription: { tier: 'creator', characterCount: 1000, characterLimit: 100000 } }; } }; }
    get voices() { return {
      search: async q => { calls.push({ search: q }); if (overrides.search) return overrides.search(q); return { voices: [{ voiceId: VOICE, name: 'Calm Narrator', category: 'premade', labels: { gender: 'male', accent: 'british' }, description: 'Warm and calm' }] }; },
      get: async id => ({ voiceId: id, name: 'Calm Narrator' }),
    }; }
    get models() { return { list: async () => [{ modelId: 'eleven_v4', tokenCostFactor: 1 }] }; }
    get textToDialogue() { return { convertWithTimestamps: async request => {
      calls.push({ generate: request });
      if (overrides.generate) return overrides.generate(request);
      return { audioBase64: mp3.toString('base64'), alignment: alignmentFor(request.inputs[0].text), normalizedAlignment: alignmentFor(request.inputs[0].text), voiceSegments: [] };
    } }; }
  }
  return { sdk: { ElevenLabsClient }, calls };
}
function memoryStore(initial = null) {
  let key = initial;
  return { has: async () => Boolean(key), get: async () => key, set: async k => { key = k; }, delete: async () => { key = null; }, peek: () => key };
}
async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voiceover-test-'));
  await fs.mkdir(path.join(root, 'workspace/projects/main/demo/composition'), { recursive: true });
  await fs.mkdir(path.join(root, 'workspace/preferences'), { recursive: true });
  return root;
}
const setup = async ({ key = KEY, ...overrides } = {}) => {
  const root = await workspace(); const store = memoryStore(key); const { sdk, calls } = fakeSdk(overrides);
  return { root, store, calls, vo: createVoiceover({ root, store, sdk, probe: async () => 3.2 }) };
};
async function allFiles(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...await allFiles(p)); else out.push(p); }
  return out;
}
async function assertNoSecret(root) {
  for (const file of await allFiles(root)) assert.ok(!(await fs.readFile(file)).includes(KEY), `key leaked into ${path.relative(root, file)}`);
}

test('tags are found and removed from spoken text', () => {
  assert.deepEqual(findTags(SCRIPT), ['[warm, steady]', '[whispers]']);
  assert.equal(spokenText(SCRIPT), 'Hello, world — it\'s "fine". Really?');
});

test('character alignment becomes words: tags excluded, punctuation kept, real timings', () => {
  const { words, warnings } = wordsFromAlignment(alignmentFor(SCRIPT));
  assert.deepEqual(words.map(w => w.text), ['Hello,', 'world —', 'it\'s', '"fine".', 'Really?']);
  assert.deepEqual(warnings, []);
  const hello = SCRIPT.indexOf('Hello');
  assert.equal(words[0].start, hello * 0.05);
  assert.equal(words[0].end, Math.round((hello + 6) * 0.05 * 1000) / 1000);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].end - 1e-9, 'ordered without overlap');
});

test('alignment without tags in the character list also works', () => {
  const { words } = wordsFromAlignment(alignmentFor(spokenText(SCRIPT)));
  assert.equal(words.length, 5);
});

test('timings are validated: out of order, beyond the audio, missing', () => {
  const a = { characters: ['a', ' ', 'b', ' ', 'c'], character_start_times_seconds: [0, 0.1, 0.5, 0.6, 0.4], character_end_times_seconds: [0.2, 0.2, 0.6, 0.6, 9] };
  const { words, warnings } = wordsFromAlignment(a, { duration: 1 });
  assert.equal(words[2].start, 0.5); assert.equal(words[2].end, 1);
  assert.equal(warnings.length, 2);
  const missing = wordsFromAlignment(undefined);
  assert.deepEqual(missing.words, []); assert.match(missing.warnings[0], /no usable timing/);
  assert.deepEqual(wordsFromAlignment({ characters: ['a'], character_start_times_seconds: [], character_end_times_seconds: [] }).words, []);
});

test('connect validates without paying, stores the key only in the store, never returns it', async () => {
  const { root, store, calls, vo } = await setup({ key: null });
  await assert.rejects(vo.connect('not a key'), e => e.code === 'invalid_key');
  assert.equal(calls.length, 0, 'malformed key never reaches ElevenLabs');
  const status = await vo.connect(`  ${KEY}\n`);
  assert.equal(store.peek(), KEY);
  assert.equal(status.connected, true); assert.equal(status.account.name, 'Ada');
  assert.deepEqual({ ...status.checks, speechVerifiedAt: undefined }, { authenticated: true, accountRead: true, voicesRead: true, speech: 'not_yet', speechVerifiedAt: undefined });
  assert.ok(!JSON.stringify(status).includes(KEY) && !JSON.stringify(status).includes('sk_t...'));
  assert.ok(!calls.some(c => c.generate), 'no paid call during connect');
  assert.equal(calls.find(c => c.ctor).ctor.maxRetries, 0);
  await assertNoSecret(root);
});

test('connect rejects a key ElevenLabs refuses and keeps nothing', async () => {
  const { store, vo } = await setup({ key: null, user: () => { throw apiError(401, 'invalid_api_key', 'Invalid API key'); } });
  await assert.rejects(vo.connect(KEY), e => e.code === 'invalid_key' && !e.message.includes(KEY));
  assert.equal(store.peek(), null);
  assert.equal((await vo.status()).connected, false);
});

test('a key limited to speech still connects, marked as not able to read the account', async () => {
  const limited = () => { throw apiError(401, 'missing_permissions', 'The API key is missing the permission user_read'); };
  const { vo } = await setup({ key: null, user: limited, search: limited });
  const status = await vo.connect(KEY);
  assert.equal(status.checks.accountRead, false); assert.equal(status.checks.voicesRead, false); assert.equal(status.account, null);
});

test('disconnect removes the key and the connection record', async () => {
  const { root, store, vo } = await setup({ key: null });
  await vo.connect(KEY);
  const status = await vo.disconnect();
  assert.equal(store.peek(), null); assert.equal(status.connected, false);
  await assert.rejects(fs.access(path.join(root, 'system/voiceover/.connection.json')));
});

test('generation needs approval, then writes a complete take with the requested voice and model', async () => {
  const { root, calls, vo } = await setup();
  await assert.rejects(vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE }), e => e.code === 'not_approved' && e.exit === 3);
  assert.ok(!calls.some(c => c.generate), 'nothing generated without approval');
  const take = await vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, stability: '0.4', approved: true });
  const request = calls.find(c => c.generate).generate;
  assert.deepEqual(request.inputs, [{ text: SCRIPT, voiceId: VOICE }]);
  assert.equal(request.modelId, 'eleven_v4'); assert.deepEqual(request.settings, { stability: 0.4 });
  assert.equal(take.take, 'take-001'); assert.equal(take.reused, false); assert.equal(take.duration, 3.2);
  const dir = path.join(root, 'workspace/projects/main/demo/voiceover/take-001');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['alignment.json', 'audio.mp3', 'script.txt', 'spoken.txt', 'take.json', 'words.json']);
  assert.equal((await fs.readFile(path.join(dir, 'script.txt'), 'utf8')).trim(), SCRIPT);
  const words = JSON.parse(await fs.readFile(path.join(dir, 'words.json'), 'utf8'));
  assert.ok(words.words.every(w => !w.text.includes('[') && !/whispers/.test(w.text)));
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'take.json'), 'utf8'));
  assert.deepEqual(meta.tags, ['[warm, steady]', '[whispers]']); assert.equal(meta.voice.id, VOICE);
  await assertNoSecret(root);
});

test('identical requests reuse the take; a new take never overwrites the old one', async () => {
  const { root, calls, vo } = await setup();
  await vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, approved: true });
  const before = await fs.readFile(path.join(root, 'workspace/projects/main/demo/voiceover/take-001/audio.mp3'));
  const again = await vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE });
  assert.equal(again.reused, true); assert.equal(again.take, 'take-001');
  assert.equal(calls.filter(c => c.generate).length, 1, 'reuse costs nothing');
  await assert.rejects(vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, newTake: true }), e => e.code === 'not_approved');
  const second = await vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, newTake: true, approved: true });
  assert.equal(second.take, 'take-002');
  assert.deepEqual(await fs.readFile(path.join(root, 'workspace/projects/main/demo/voiceover/take-001/audio.mp3')), before);
  assert.equal((await vo.takes('demo')).length, 2);
});

test('missing alignment keeps the paid audio but invents no caption timing', async () => {
  const { root, vo } = await setup({ generate: () => ({ audioBase64: mp3.toString('base64'), voiceSegments: [] }) });
  const take = await vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, approved: true });
  assert.equal(take.files.words, null); assert.equal(take.alignmentSource, null); assert.match(take.warnings[0], /no usable timing/);
  await assert.rejects(fs.access(path.join(root, 'workspace/projects/main/demo/voiceover/take-001/words.json')));
  await assert.rejects(vo.use({ project: 'demo', take: 'take-001' }), /no caption timings/);
});

test('ElevenLabs failures become clear errors and leave no partial take', async () => {
  const cases = [[apiError(401, 'quota_exceeded'), 'quota'], [apiError(401, 'missing_permissions', 'missing text_to_speech'), 'missing_permission'], [apiError(429, 'too_many_concurrent_requests'), 'rate_limited'], [apiError(404, 'voice_not_found'), 'voice'], [Object.assign(new Error('timeout'), { name: 'ElevenLabsTimeoutError' }), 'uncertain']];
  for (const [error, code] of cases) {
    const { root, vo } = await setup({ generate: () => { throw error; } });
    await assert.rejects(vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, approved: true }), e => e.code === code);
    assert.deepEqual(await fs.readdir(path.join(root, 'workspace/projects/main/demo')).then(d => d.filter(n => n === 'voiceover')), []);
  }
  const bad = await setup({ generate: () => ({ audioBase64: Buffer.from('nope').toString('base64') }) });
  await assert.rejects(bad.vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, approved: true }), e => e.code === 'bad_response');
  const leaky = translate(apiError(400, 'x', `bad key ${KEY}`), { secret: KEY });
  assert.ok(!leaky.message.includes(KEY));
});

test('not connected, bad projects and unsafe folders are refused', async () => {
  const { vo } = await setup({ key: null });
  await assert.rejects(vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, approved: true }), e => e.code === 'not_connected' && e.exit === 4);
  const ok = await setup();
  for (const project of ['../demo', 'demo/../../x', '', 'missing']) await assert.rejects(ok.vo.generate({ project, script: SCRIPT, voiceId: VOICE, approved: true }), e => ['usage', 'path'].includes(e.code));
  await assert.rejects(ok.vo.generate({ project: 'demo', script: '[only a tag]', voiceId: VOICE }), e => e.code === 'usage');
  await assert.rejects(ok.vo.generate({ project: 'demo', script: 'x'.repeat(2001), voiceId: VOICE }), e => e.code === 'too_long');
  await ok.vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, approved: true });
  await assert.rejects(ok.vo.use({ project: 'demo', take: 'take-001', composition: '../../outside' }), e => e.code === 'path');
});

test('use copies the take into the composition and prints the HTML to paste', async () => {
  const { root, vo } = await setup();
  await vo.generate({ project: 'demo', script: SCRIPT, voiceId: VOICE, approved: true });
  const r = await vo.use({ project: 'demo', take: 'take-001' });
  const folder = path.join(root, 'workspace/projects/main/demo/composition/assets/voiceover');
  assert.deepEqual((await fs.readdir(folder)).sort(), ['captions.js', 'take-001.mp3', 'take-001.words.js']);
  assert.match(r.html, /HFCaptions\.mount/); assert.match(r.html, /data-duration="3.200"/);
  const sandbox = { window: {} }; vm.runInNewContext(await fs.readFile(path.join(folder, 'take-001.words.js'), 'utf8'), sandbox);
  assert.equal(sandbox.window.HFVoiceover['take-001'].words.length, 5);
});

test('estimate is free and reports characters, credits and cache hits', async () => {
  const { calls, vo } = await setup();
  const e = await vo.estimate({ project: 'demo', script: SCRIPT, voiceId: VOICE });
  assert.equal(e.characters, SCRIPT.length); assert.equal(e.credits, SCRIPT.length); assert.equal(e.remaining, 99000); assert.equal(e.cached, null);
  assert.ok(!calls.some(c => c.generate));
});

test('caption phrases break on pauses, sentence ends and length', () => {
  const sandbox = { globalThis: {} }; sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(path.join(here, '../../assets/hf/captions.js'), 'utf8'), sandbox);
  const w = (text, start, end) => ({ text, start, end });
  const words = [w('One', 0, 0.2), w('two.', 0.2, 0.4), w('Three', 0.5, 0.7), w('four', 0.7, 0.9), w('five', 2, 2.2), ...'a b c d e f g'.split(' ').map((t, i) => w(t, 3 + i * 0.1, 3.05 + i * 0.1))];
  const groups = sandbox.HFCaptions.phrases(words, {});
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map(g => g.map(x => x.text).join(' ')))), ['One two.', 'Three four', 'five', 'a b c d e f', 'g']);
});
