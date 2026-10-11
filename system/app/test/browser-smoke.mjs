// Optional real-Chrome smoke test against a temporary fixture workspace.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from '../server.mjs';
import { createVoiceover } from '../../voiceover/service.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-browser-'));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-chrome-'));
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Fake ElevenLabs account and in-memory key store: no network, no Keychain.
const KEY = 'sk_smoke_0123456789abcdefghijklmnop';
let storedKey = null;
const store = { has: async () => Boolean(storedKey), get: async () => storedKey, set: async k => { storedKey = k; }, delete: async () => { storedKey = null; } };
class ElevenLabsClient {
  get user() { return { get: async () => ({ firstName: 'Ada', subscription: { tier: 'creator', characterCount: 1200, characterLimit: 100000 } }) }; }
  get voices() { return { search: async () => ({ voices: [] }) }; }
}
const server = createApp({ root, voiceover: createVoiceover({ root, store, sdk: { ElevenLabsClient } }) });
let browser, socket;
try {
  for (const folder of ['system/setup', 'workspace/preferences', 'workspace/assets', 'workspace/videos/demo/drafts', 'workspace/videos/demo/source', 'workspace/drop-videos-here']) await fs.mkdir(path.join(root, folder), { recursive: true });
  for (const [file, text] of Object.entries({ 'workspace/drop-videos-here/my-take.mov': 'raw', 'system/prompts.md': '# Prompts', 'system/setup/setup-notes.md': '# Setup', 'workspace/preferences/editing-guide.md': '# Guide\nOriginal text', 'workspace/preferences/editing-rules.md': '# Rules', 'workspace/assets/asset-index.md': '# Assets', 'workspace/videos/demo/brief.md': '# Brief\n<img src=x onerror=alert(1)>\n- one **bold** item', 'workspace/videos/demo/feedback.md': '# Feedback', 'workspace/videos/demo/drafts/draft-01.mp4': 'fake test media' })) await fs.writeFile(path.join(root, file), text);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(chromePath, ['--headless', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let launchError; browser.on('error', error => { launchError = error; });
  let debugPort;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    const text = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    if (text) { debugPort = Number(text.split('\n')[0]); break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(debugPort, 'Chrome started');
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let id = 0;
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id && pending.has(data.id)) { const task = pending.get(data.id); pending.delete(data.id); if (data.error) task.reject(new Error(data.error.message)); else task.resolve(data.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
  const wait = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`UI timeout: ${expression}`); };
  const clickText = text => evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const consoleErrors = [];
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.method === 'Runtime.exceptionThrown') consoleErrors.push(data.params.exceptionDetails.text); if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') consoleErrors.push(data.params.args.map(a => a.value).join(' ')); });
  await send('Page.enable'); await send('Runtime.enable');
  const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const h1 = () => evaluate("document.querySelector('#main h1')?.textContent");
  await size(1440, 1000);
  await send('Page.navigate', { url });
  // Videos is the default page.
  await wait("document.querySelector('#main h1')?.textContent==='Your video projects'");
  assert.ok(await evaluate("document.body.textContent.includes('my-take.mov') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Copy start instruction')"), 'Drop folder file and start action shown');
  assert.ok(await evaluate("document.body.textContent.includes('moved out of this folder')"), 'Move warning shown');
  assert.ok(await evaluate("document.body.textContent.includes('Finished videos')"), 'Finished videos row shown');
  assert.ok(await evaluate("[...document.querySelectorAll('.project')].some(p=>p.textContent.includes('demo') && p.textContent.includes('Empty'))"), 'Project card shows real counts');
  // Workspace: player, drafts, copyable approval and feedback, safe Markdown.
  await evaluate("document.querySelector('.project').click()");
  await wait("document.querySelector('.stage video') && document.querySelector('.drafts button')");
  assert.match(await evaluate("document.querySelector('.stage video').getAttribute('src')"), /draft-01/);
  assert.equal(await evaluate("document.querySelector('.drafts button').getAttribute('aria-current')"), 'true');
  assert.ok(await evaluate("[...document.querySelectorAll('.preview')].some(p=>p.textContent.includes('## Approved version') && p.textContent.includes('Draft: drafts/draft-01.mp4'))"), 'Approval is a copyable instruction');
  assert.ok(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Copy feedback for Codex')"));
  await evaluate("[...document.querySelectorAll('details.fold')].find(d=>d.textContent.includes('Brief')).open=true");
  await wait("[...document.querySelectorAll('.doc h1')].some(h=>h.textContent==='Brief')");
  assert.equal(await evaluate("document.querySelectorAll('.doc img, .doc script').length"), 0, 'Markdown cannot inject HTML');
  assert.ok(await evaluate("document.body.textContent.includes('<img src=x onerror=alert(1)>')"), 'HTML in Markdown shows as text');
  // Back navigation returns to Videos.
  await evaluate('history.back()');
  await wait("document.querySelector('#main h1')?.textContent==='Your video projects'");
  // Setup: honest status, factor explorer, rendered preferences.
  await evaluate("document.querySelector('[data-tab=setup]').click()");
  await wait("document.querySelector('#main h1')?.textContent==='Setup & preferences' && document.querySelectorAll('.factor').length===6");
  assert.ok(await evaluate("document.querySelector('.status').textContent.includes('Not checked')"), 'Tools are not claimed before checking');
  await evaluate("[...document.querySelectorAll('details.fold')].forEach(d=>d.open=true)");
  await clickText('Highlight spoken words');
  assert.ok(await evaluate("[...document.querySelectorAll('.preview')].some(p=>p.textContent.includes('currently spoken word'))"));
  await wait("[...document.querySelectorAll('.doc')].some(d=>d.textContent.includes('Original text'))");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>/Save/.test(b.textContent))"), false, 'No save button');
  // ElevenLabs: the only form. Connect, key never shown again, two-step disconnect.
  assert.ok(await evaluate("document.querySelector('#elevenlabs .tag').textContent==='Not connected' && document.querySelector('#elevenlabs-key').type==='password' && !/null|undefined/.test(document.querySelector('#elevenlabs').textContent)"), 'panel shows no stray null');
  await evaluate(`(() => { const i = document.querySelector('#elevenlabs-key'); i.value = ${JSON.stringify(KEY)}; i.form.requestSubmit(); })()`);
  await wait("document.querySelector('#elevenlabs .tag')?.textContent==='Connected'");
  assert.equal(storedKey, KEY, 'key reached the store');
  assert.ok(await evaluate(`!document.documentElement.outerHTML.includes(${JSON.stringify(KEY)}) && !document.querySelector('#elevenlabs-key')`), 'key not in the page after connecting');
  assert.ok(await evaluate("document.querySelector('#elevenlabs').textContent.includes('Ada') && document.querySelector('#elevenlabs').textContent.includes('Not yet confirmed')"));
  await size(420, 900); const narrow = await evaluate("[...document.querySelectorAll('#elevenlabs *')].filter(e=>e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('pre')).length"); assert.equal(narrow, 0, 'ElevenLabs panel fits at 420px'); await size(1280, 900);
  await clickText('Disconnect');
  assert.equal(storedKey, KEY, 'first click only asks');
  await clickText('Disconnect');
  await wait("document.querySelector('#elevenlabs .tag')?.textContent==='Not connected'");
  assert.equal(storedKey, null, 'key removed');
  await evaluate(`(() => { const i = document.querySelector('#elevenlabs-key'); i.value = 'not a key'; i.form.requestSubmit(); })()`);
  await wait("document.querySelector('#elevenlabs .error')?.textContent.includes('does not look like')");
  assert.equal(storedKey, null);
  for (const [w, h] of [[1280, 900], [1024, 800], [420, 900]]) { await size(w, h); await evaluate("document.querySelector('[data-tab=workspace]').click()"); await wait("document.querySelector('.stage')"); const wide = await evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.drafts, .table-wrap, pre, textarea')).slice(0,6).map(e=>e.tagName+'.'+e.className+' '+Math.round(e.getBoundingClientRect().right)).join(' | ')"); assert.equal(wide, '', `no horizontal overflow at ${w}px`); }
  assert.equal(await fs.readFile(path.join(root, 'workspace/videos/demo/feedback.md'), 'utf8'), '# Feedback', 'Nothing written by the UI');
  assert.equal(await fs.readFile(path.join(root, 'workspace/preferences/editing-guide.md'), 'utf8'), '# Guide\nOriginal text');
  assert.deepEqual(consoleErrors, [], 'No console errors');
  // Capture the actual working repo read-only if explicitly supplied.
  if (process.env.SMOKE_LIVE_URL) {
    const shot = async (name, w, h) => { await size(w, h); await new Promise(r => setTimeout(r, 400)); const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await fs.writeFile(`/tmp/companion-${name}.png`, Buffer.from(image.data, 'base64')); };
    await size(1440, 1000);
    await send('Page.navigate', { url: `${process.env.SMOKE_LIVE_URL}/#videos` });
    await wait("document.querySelector('#main h1')?.textContent==='Your video projects'");
    await evaluate("document.querySelector('#dismiss').click()");
    await shot('videos-1440', 1440, 1000);
    await evaluate("[...document.querySelectorAll('.project')].at(-1).click()");
    await wait("document.querySelector('.stage video')");
    await shot('workspace-1440', 1440, 1000); await shot('workspace-1024', 1024, 800); await shot('workspace-420', 420, 900);
    await size(1440, 1000);
    await evaluate("document.querySelector('[data-tab=setup]').click()");
    await wait("document.querySelector('.status')");
    await shot('setup-1440', 1440, 1000);
  }
  console.log('Browser smoke passed: Videos default, project grid, workspace player and drafts, copyable approval/feedback, safe Markdown, back navigation, honest setup status, ElevenLabs connect/disconnect, factor explorer, no overflow at 1280/1024/420, no console errors, no files written.');
} finally {
  socket?.close();
  if (browser?.pid) { const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill('SIGTERM'); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]); }
  await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true }); await fs.rm(profile, { recursive: true, force: true });
}
