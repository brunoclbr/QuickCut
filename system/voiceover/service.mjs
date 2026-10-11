// Shared ElevenLabs voiceover service, used by the CLI (voiceover.mjs) and the companion's Connect form.
// The AI app makes the creative choices; this file only talks to ElevenLabs and stores results.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { keychainStore, keyShape } from './keychain.mjs';
import { compareWords, findTags, spokenText, wordsFromAlignment } from './alignment.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
export const defaults = { model: 'eleven_v4', outputFormat: 'mp3_44100_128' };
export const maxCharacters = 2000; // Text to Dialogue limit per request
const connectionFile = 'system/voiceover/.connection.json';
const preferenceFile = 'workspace/preferences/voiceover.json';
const projectName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

// code → [HTTP status for the companion, CLI exit code]
const kinds = {
  usage: [400, 2], path: [400, 2], too_long: [400, 2], not_approved: [409, 3],
  not_connected: [409, 4], invalid_key: [400, 4], keychain: [500, 4],
  missing_permission: [403, 5], quota: [402, 5], voice: [404, 5], rate_limited: [429, 5], refused: [400, 5],
  uncertain: [504, 6], network: [502, 6], bad_response: [502, 6], sdk_missing: [503, 7],
};
export class VoiceoverError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; [this.status, this.exit] = kinds[code] || [500, 1]; Object.assign(this, extra); }
}
const fail = (code, message, extra) => { throw new VoiceoverError(code, message, extra); };

// Maps SDK/API failures to plain-language errors. `paid` marks requests that may have been billed.
export function translate(error, { paid = false, secret } = {}) {
  if (error instanceof VoiceoverError) return error;
  const status = error?.statusCode;
  const detail = error?.body?.detail;
  const code = typeof detail === 'object' ? detail?.status : undefined;
  const said = String((typeof detail === 'object' ? detail?.message : detail) || '').slice(0, 300);
  const clean = text => secret ? text.split(secret).join('[hidden]') : text;
  if (!status) {
    if (paid) return new VoiceoverError('uncertain', 'The request to ElevenLabs did not finish (no answer or a timeout). It may still have used credits. Check your ElevenLabs usage page before trying again; nothing was retried automatically.');
    return new VoiceoverError('network', 'Could not reach ElevenLabs. Check the internet connection and try again.');
  }
  if (status === 401 && (code === 'missing_permissions' || /permission/i.test(said))) return new VoiceoverError('missing_permission', `This API key is not allowed to do that${said ? ` (${clean(said)})` : ''}. Create a key with Text to Speech access, or edit the key's permissions on ElevenLabs.`);
  if (status === 401 && code === 'quota_exceeded') return new VoiceoverError('quota', 'Not enough ElevenLabs credits left for this script (or the key\'s own credit limit is reached). Nothing was generated.');
  if (status === 401) return new VoiceoverError('invalid_key', 'ElevenLabs did not accept this API key. Check it was copied completely, or create a new one.');
  if (code === 'quota_exceeded' || status === 402) return new VoiceoverError('quota', 'Not enough ElevenLabs credits left for this script. Nothing was generated.');
  if (code === 'voice_not_found' || status === 404) return new VoiceoverError('voice', 'This voice is not available to your ElevenLabs account. List the available voices and pick another.');
  if (status === 403) return new VoiceoverError('missing_permission', `ElevenLabs refused the request${said ? ` (${clean(said)})` : ''}. The key may be limited to other IP addresses or features.`);
  if (status === 429) return new VoiceoverError('rate_limited', 'ElevenLabs is busy or too many requests are running at once. Nothing was generated. Wait a minute, then ask again.');
  if (code === 'max_character_limit_exceeded') return new VoiceoverError('too_long', 'The script is too long for one request. Split it into shorter parts.');
  if (status >= 500) return new VoiceoverError(paid ? 'uncertain' : 'network', paid ? 'ElevenLabs had an internal error. Check your usage page before trying again; nothing was retried.' : 'ElevenLabs had an internal error. Try again later.');
  return new VoiceoverError('refused', `ElevenLabs rejected the request${said ? `: ${clean(said)}` : ` (HTTP ${status})`}.`);
}

async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}
async function duration(file) {
  for (const bin of ['/opt/homebrew/opt/ffmpeg-full/bin/ffprobe', 'ffprobe']) {
    try { const { stdout } = await run(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 10000 }); const d = Number(stdout.trim()); if (d > 0) return d; } catch {}
  }
  return null;
}
const looksLikeMp3 = b => b.length > 1000 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));

export async function loadSdk() {
  try { return await import('@elevenlabs/elevenlabs-js'); }
  catch { fail('sdk_missing', 'The voiceover tools are not installed yet. Ask your AI app: "Install the voiceover tools" (it runs npm --prefix system/voiceover ci).'); }
}

export function createVoiceover({ root, store = keychainStore(), sdk, now = () => new Date(), probe = duration } = {}) {
  root = path.resolve(root || path.join(here, '../..'));
  const at = rel => path.join(root, rel);
  async function client(key, timeoutInSeconds = 20) {
    const { ElevenLabsClient } = sdk || await loadSdk();
    // maxRetries 0: a retried generation could be billed twice.
    return new ElevenLabsClient({ apiKey: key, maxRetries: 0, timeoutInSeconds });
  }
  async function storedKey() {
    const key = await store.get();
    if (!key) fail('not_connected', 'ElevenLabs is not connected. Open the companion app (say "open the app"), go to Setup & preferences → ElevenLabs and click Connect.');
    return key;
  }
  async function sdkInstalled() {
    if (sdk) return true;
    try { await fs.access(path.join(here, 'node_modules/@elevenlabs/elevenlabs-js/package.json')); return true; } catch { return false; }
  }

  async function project(name) {
    if (typeof name !== 'string' || !projectName.test(name)) fail('usage', 'Give the project folder name inside workspace/videos, for example "my-video".');
    const videos = await fs.realpath(at('workspace/videos')).catch(() => fail('path', 'workspace/videos does not exist.'));
    const dir = await fs.realpath(path.join(videos, name)).catch(() => fail('path', `There is no project called "${name}" in workspace/videos.`));
    if (path.dirname(dir) !== videos) fail('path', 'The project must be a folder directly inside workspace/videos.');
    return dir;
  }
  // A folder inside the project, created if needed; symlinks may not lead outside it.
  async function projectFolder(dir, rel) {
    const target = path.resolve(dir, rel);
    if (!inside(dir, target) || target === dir) fail('path', 'Files can only be written inside the project folder.');
    await fs.mkdir(target, { recursive: true });
    if (!inside(dir, await fs.realpath(target))) fail('path', 'Files can only be written inside the project folder.');
    return target;
  }

  async function status() {
    const meta = await readJson(at(connectionFile));
    let connected = false, keychain = null;
    try { connected = await store.has(); } catch (error) { keychain = error.message; }
    const preference = await readJson(at(preferenceFile));
    return {
      sdkInstalled: await sdkInstalled(), connected, keychainError: keychain,
      account: connected ? meta?.account ?? null : null,
      checks: connected ? meta?.checks ?? null : null,
      connectedAt: connected ? meta?.connectedAt ?? null : null,
      checkedAt: connected ? meta?.checkedAt ?? null : null,
      preferredVoice: preference?.voice ?? null,
      model: preference?.model || defaults.model,
    };
  }

  // Non-billable checks: account lookup and a one-voice listing. Speech permission is confirmed by the first real take.
  async function inspect(key) {
    const c = await client(key);
    let account = null, accountRead = false, voicesRead = false;
    try {
      const user = await c.user.get();
      const s = user.subscription || {};
      account = { name: user.firstName || null, tier: s.tier || null, characterCount: s.characterCount ?? null, characterLimit: s.characterLimit ?? null, resetsAt: s.nextCharacterCountResetUnix ? new Date(s.nextCharacterCountResetUnix * 1000).toISOString() : null };
      accountRead = true;
    } catch (error) { const e = translate(error, { secret: key }); if (e.code !== 'missing_permission') throw e; }
    try { await c.voices.search({ pageSize: 1 }); voicesRead = true; }
    catch (error) { const e = translate(error, { secret: key }); if (e.code !== 'missing_permission') throw e; }
    return { account, accountRead, voicesRead };
  }

  async function connect(apiKey) {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!keyShape.test(key)) fail('invalid_key', 'That does not look like an ElevenLabs API key. It usually starts with "sk_".');
    const found = await inspect(key);
    await store.set(key);
    const time = now().toISOString();
    await writeJson(at(connectionFile), { connectedAt: time, checkedAt: time, account: found.account, checks: { authenticated: true, accountRead: found.accountRead, voicesRead: found.voicesRead, speech: 'not_yet', speechVerifiedAt: null } });
    return status();
  }
  async function disconnect() {
    await store.delete();
    await fs.rm(at(connectionFile), { force: true });
    return status();
  }
  async function check() {
    const key = await storedKey();
    const found = await inspect(key);
    const meta = await readJson(at(connectionFile)) || {};
    const checks = { speech: 'not_yet', speechVerifiedAt: null, ...meta.checks, authenticated: true, accountRead: found.accountRead, voicesRead: found.voicesRead };
    await writeJson(at(connectionFile), { ...meta, connectedAt: meta.connectedAt || now().toISOString(), checkedAt: now().toISOString(), account: found.account, checks });
    return status();
  }

  const voiceView = v => ({
    id: v.voiceId, name: v.name || null, category: v.category || null,
    description: v.description ? v.description.slice(0, 240) : null,
    labels: v.labels || {}, languages: (v.verifiedLanguages || []).map(l => l.language).filter(Boolean),
    previewUrl: v.previewUrl || null,
  });
  async function voices({ search, gender, age, accent, language, useCase, limit = 20 } = {}) {
    const key = await storedKey();
    const c = await client(key);
    try {
      const res = await c.voices.search({ search: search || undefined, gender, age, accent, language, useCases: useCase, pageSize: Math.min(Math.max(1, Number(limit) || 20), 100) });
      return (res.voices || []).map(voiceView);
    } catch (error) { throw translate(error, { secret: key }); }
  }
  async function preferVoice(voiceId) {
    if (!/^[A-Za-z0-9]{8,64}$/.test(voiceId || '')) fail('usage', 'Give a voice ID from the voices list.');
    const key = await storedKey();
    let name = null;
    try { name = (await (await client(key)).voices.get(voiceId)).name || null; }
    catch (error) { const e = translate(error, { secret: key }); if (e.code !== 'missing_permission') throw e; }
    const current = await readJson(at(preferenceFile)) || {};
    await writeJson(at(preferenceFile), { ...current, voice: { id: voiceId, name }, model: current.model || defaults.model });
    return { id: voiceId, name };
  }

  // Normalises and validates a generation request. Returns everything that identifies the performance.
  async function request(input) {
    const script = typeof input.script === 'string' ? input.script.replace(/\r\n?/g, '\n').trim() : '';
    if (!script) fail('usage', 'The script is empty.');
    const spoken = spokenText(script);
    if (!spoken) fail('usage', 'The script only has delivery tags in [brackets]; there are no words to speak.');
    if (script.length > maxCharacters) fail('too_long', `The script has ${script.length} characters; one take allows ${maxCharacters}. Split it into shorter takes.`);
    const preference = await readJson(at(preferenceFile));
    const voiceId = input.voiceId || preference?.voice?.id;
    if (!voiceId) fail('usage', 'Choose a voice first (list voices, then pass --voice).');
    if (!/^[A-Za-z0-9]{8,64}$/.test(voiceId)) fail('usage', 'That voice ID does not look right.');
    const model = input.model || preference?.model || defaults.model;
    const outputFormat = input.outputFormat || defaults.outputFormat;
    if (!/^mp3_\d+_\d+$/.test(outputFormat)) fail('usage', 'Only MP3 output formats are supported (for example mp3_44100_128).');
    const languageCode = input.languageCode || null;
    if (languageCode && !/^[a-z]{2,3}$/.test(languageCode)) fail('usage', 'Language must be a code like "en" or "es".');
    const settings = {};
    for (const name of ['stability', 'similarity']) {
      if (input[name] === undefined || input[name] === null) continue;
      const value = Number(input[name]);
      if (!(value >= 0 && value <= 1)) fail('usage', `${name} must be between 0 and 1.`);
      settings[name] = value;
    }
    const seed = input.seed === undefined || input.seed === null ? null : Number(input.seed);
    if (seed !== null && !(Number.isInteger(seed) && seed >= 0 && seed <= 4294967295)) fail('usage', 'Seed must be a whole number.');
    const identity = { version: 1, script, voiceId, model, languageCode, settings, seed, outputFormat };
    const cacheKey = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
    return { ...identity, spoken, tags: findTags(script), characters: script.length, cacheKey };
  }

  async function takes(name) {
    const dir = await project(name);
    const folder = path.join(dir, 'voiceover');
    let entries = [];
    try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const list = [];
    for (const e of entries) {
      if (!e.isDirectory() || !/^take-\d{3,}$/.test(e.name)) continue;
      const meta = await readJson(path.join(folder, e.name, 'take.json')).catch(() => null);
      if (meta) list.push(meta);
    }
    return list.sort((a, b) => a.take.localeCompare(b.take, undefined, { numeric: true }));
  }

  async function estimate(input) {
    const dir = await project(input.project);
    const req = await request(input);
    const cached = (await takes(input.project)).find(t => t.cacheKey === req.cacheKey) || null;
    const result = { project: path.relative(root, dir), voiceId: req.voiceId, model: req.model, characters: req.characters, spoken: req.spoken, tags: req.tags, cacheKey: req.cacheKey, cached: cached?.take || null, credits: null, remaining: null };
    const key = await store.get();
    if (!key) return result;
    const c = await client(key);
    try { const model = (await c.models.list()).find(m => m.modelId === req.model); if (model?.tokenCostFactor) result.credits = Math.ceil(req.characters * model.tokenCostFactor); } catch {}
    try { const s = (await c.user.get()).subscription; if (s && Number.isFinite(s.characterLimit)) result.remaining = Math.max(0, s.characterLimit - s.characterCount); } catch {}
    return result;
  }

  async function generate(input) {
    const dir = await project(input.project);
    const req = await request(input);
    const existing = (await takes(input.project)).find(t => t.cacheKey === req.cacheKey);
    if (existing && !input.newTake) return { reused: true, ...existing };
    if (!input.approved) fail('not_approved', 'Paid generation needs the owner\'s approval. Show the script, voice, delivery and estimate, then rerun with --approved.', { cacheKey: req.cacheKey });
    const key = await storedKey();
    const c = await client(key, 300);
    let res;
    try {
      res = await c.textToDialogue.convertWithTimestamps({
        inputs: [{ text: req.script, voiceId: req.voiceId }], modelId: req.model, outputFormat: req.outputFormat,
        ...(req.languageCode && { languageCode: req.languageCode }), ...(Object.keys(req.settings).length && { settings: req.settings }), ...(req.seed !== null && { seed: req.seed }),
      });
    } catch (error) { throw translate(error, { paid: true, secret: key }); }

    const audio = Buffer.from(res?.audioBase64 || '', 'base64');
    if (!looksLikeMp3(audio)) fail('bad_response', 'ElevenLabs answered, but the audio was empty or not an MP3. Check your usage page before trying again.');
    const voiceFolder = await projectFolder(dir, 'voiceover');
    let meta;
    const temp = path.join(voiceFolder, `.incoming-${randomUUID()}`);
    await fs.mkdir(temp);
    try {
      await fs.writeFile(path.join(temp, 'audio.mp3'), audio);
      const seconds = await probe(path.join(temp, 'audio.mp3'));
      const source = res.alignment?.characters?.length ? 'alignment' : res.normalizedAlignment?.characters?.length ? 'normalized_alignment' : null;
      const { words, warnings } = wordsFromAlignment(source === 'alignment' ? res.alignment : res.normalizedAlignment, { duration: seconds ?? undefined });
      const mismatch = words.length ? compareWords(words, req.script) : null;
      if (mismatch) warnings.push(mismatch);
      const audioSeconds = seconds ?? (words.length ? words.at(-1).end : null);
      const raw = { alignment: res.alignment ?? null, normalized_alignment: res.normalizedAlignment ?? null, voice_segments: res.voiceSegments ?? [] };
      await fs.writeFile(path.join(temp, 'script.txt'), req.script + '\n');
      await fs.writeFile(path.join(temp, 'spoken.txt'), req.spoken + '\n');
      await fs.writeFile(path.join(temp, 'alignment.json'), JSON.stringify(raw) + '\n');
      if (words.length) await fs.writeFile(path.join(temp, 'words.json'), JSON.stringify({ audio: 'audio.mp3', duration: audioSeconds, source, words }, null, 2) + '\n');
      meta = {
        take: null, createdAt: now().toISOString(), cacheKey: req.cacheKey, project: path.basename(dir),
        voice: { id: req.voiceId }, model: req.model, languageCode: req.languageCode, settings: req.settings, seed: req.seed, outputFormat: req.outputFormat,
        characters: req.characters, tags: req.tags, files: { script: 'script.txt', spoken: 'spoken.txt', audio: 'audio.mp3', alignment: 'alignment.json', words: words.length ? 'words.json' : null },
        duration: audioSeconds, alignmentSource: source, words: words.length, warnings,
      };
      // Number the take only when it is complete; never reuse an existing number.
      for (let n = (await takes(input.project)).length + 1; ; n++) {
        const name = `take-${String(n).padStart(3, '0')}`;
        meta.take = name;
        await fs.writeFile(path.join(temp, 'take.json'), JSON.stringify(meta, null, 2) + '\n');
        try { await fs.mkdir(path.join(voiceFolder, name)); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
        await fs.rm(path.join(voiceFolder, name), { recursive: true });
        await fs.rename(temp, path.join(voiceFolder, name));
        break;
      }
    } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }

    const conn = await readJson(at(connectionFile));
    if (conn) await writeJson(at(connectionFile), { ...conn, checks: { ...conn.checks, speech: 'verified', speechVerifiedAt: now().toISOString() } });
    return { reused: false, ...meta };
  }

  // Copies a take into a composition folder and returns paste-ready HTML.
  async function use({ project: name, take, composition = 'composition' }) {
    const dir = await project(name);
    const meta = (await takes(name)).find(t => t.take === take);
    if (!meta) fail('usage', `No ${take} in this project. List takes to see what exists.`);
    if (!meta.files.words) fail('usage', `${take} has no caption timings, so captions cannot be synced from it.`);
    const target = await projectFolder(dir, path.join(composition, 'assets/voiceover'));
    const from = path.join(dir, 'voiceover', take);
    const words = JSON.parse(await fs.readFile(path.join(from, 'words.json'), 'utf8'));
    await fs.copyFile(path.join(from, 'audio.mp3'), path.join(target, `${take}.mp3`));
    await fs.writeFile(path.join(target, `${take}.words.js`), `window.HFVoiceover = window.HFVoiceover || {};\nwindow.HFVoiceover[${JSON.stringify(take)}] = ${JSON.stringify(words)};\n`);
    await fs.copyFile(path.join(here, '../assets/hf/captions.js'), path.join(target, 'captions.js'));
    const d = Number(meta.duration).toFixed(3);
    const html = [
      `<!-- in <head>, after gsap -->`,
      `<script src="assets/voiceover/captions.js"></script>`,
      `<script src="assets/voiceover/${take}.words.js"></script>`,
      `<!-- inside the root composition; move data-start to place the narration -->`,
      `<audio id="voiceover" src="assets/voiceover/${take}.mp3" data-start="0" data-duration="${d}" data-track-index="20" data-volume="1"></audio>`,
      `<div id="captions" class="clip" data-start="0" data-duration="${d}" data-track-index="21" data-layout-allow-caption-zone></div>`,
      `<!-- in the timeline script, after creating tl; offset = the audio's data-start -->`,
      `HFCaptions.mount(tl, "#captions", HFVoiceover[${JSON.stringify(take)}].words, { offset: 0, emphasis: [] });`,
    ].join('\n');
    return { take, folder: path.relative(root, target), duration: meta.duration, html };
  }

  return { status, connect, disconnect, check, voices, preferVoice, estimate, generate, takes, use };
}
