// Codex can run this finite command; the local server survives the command returning.
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRoot, preferredPort } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const stateFile = path.join(here, '.runtime.json');
const logFile = path.join(here, '.runtime.log');
const port = await preferredPort();
const root = await fs.realpath(defaultRoot);
async function healthy(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) });
    const result = await response.json();
    return result.app === 'local-editing-companion' && result.root === root;
  } catch { return false; }
}
// Optional page to open: `node system/app/launch.mjs plan/<project>/<video>` opens http://127.0.0.1:<port>/#plan/<project>/<video>.
const pageArg = process.argv.slice(2).find(a => !a.startsWith('--'));
const hash = pageArg ? `#${pageArg.replace(/^#/, '')}` : '';
function openBrowser(url) {
  if (process.argv.includes('--no-open')) return;
  if (process.platform !== 'darwin') { console.log(`Open this URL in your browser: ${url}${hash}`); return; }
  const child = spawn('/usr/bin/open', [url + hash], { stdio: 'ignore' });
  child.on('error', error => console.error(`Could not open browser: ${error.message}. Open ${url} manually.`));
}
let previous;
try { previous = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch {}
const previousPort = previous?.url?.match(/^http:\/\/127\.0\.0\.1:(\d+)$/)?.[1];
if (previousPort && Number(previousPort) >= port && Number(previousPort) < port + 20 && await healthy(previous.url)) {
  console.log(`Editing companion: ${previous.url} (already running)`); openBrowser(previous.url);
} else {
  // Probe before starting so a removed runtime file does not create duplicate servers.
  let url;
  for (let candidate = port; candidate < port + 20; candidate++) {
    const check = `http://127.0.0.1:${candidate}`;
    if (await healthy(check)) { url = check; break; }
  }
  let child;
  if (!url) {
    const fd = openSync(logFile, 'w', 0o600);
    child = spawn(process.execPath, [path.join(here, 'server.mjs')], { cwd: root, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, PORT: String(port) } });
    closeSync(fd);
    let spawnError;
    child.on('error', error => { spawnError = error; }); child.unref();
    for (let attempt = 0; attempt < 60; attempt++) {
      if (spawnError) throw spawnError;
      const log = await fs.readFile(logFile, 'utf8').catch(() => '');
      const match = /Editing companion: (http:\/\/127\.0\.0\.1:\d+)/.exec(log);
      if (match && await healthy(match[1])) { url = match[1]; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (!url) throw new Error(`App did not start. Inspect ${logFile}; no existing service was stopped.`);
  }
  await fs.writeFile(stateFile, JSON.stringify({ url, pid: child?.pid || null, root }, null, 2), { mode: 0o600 });
  console.log(`Editing companion: ${url}`); openBrowser(url);
}
