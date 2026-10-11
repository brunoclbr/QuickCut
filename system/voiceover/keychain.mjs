// The ElevenLabs API key lives in the macOS login Keychain, never in files, logs or command arguments.
// `security -i` reads its command from stdin, so the key never shows up in the process list.
import { spawn } from 'node:child_process';

export const keyService = 'ai-video-editing.elevenlabs';
const account = 'api-key';
// ElevenLabs keys are letters, digits, "_" and "-". Checking the shape also keeps the stdin command unambiguous.
export const keyShape = /^[A-Za-z0-9_-]{20,200}$/;
const notFound = 44;

function security(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input || '');
  });
}
const keychainError = action => Object.assign(new Error(`Could not ${action} the macOS Keychain.`), { code: 'keychain', status: 500 });

export function keychainStore({ service = keyService } = {}) {
  const ensureMac = () => { if (process.platform !== 'darwin') throw Object.assign(new Error('Saving the ElevenLabs key needs the macOS Keychain. Only macOS is supported for now.'), { code: 'keychain', status: 501 }); };
  return {
    async has() {
      ensureMac();
      const r = await security(['find-generic-password', '-s', service, '-a', account]);
      if (r.code === 0) return true; if (r.code === notFound) return false; throw keychainError('read');
    },
    async get() {
      ensureMac();
      const r = await security(['find-generic-password', '-s', service, '-a', account, '-w']);
      if (r.code === notFound) return null; if (r.code !== 0) throw keychainError('read');
      return r.stdout.trim() || null;
    },
    async set(key) {
      ensureMac();
      if (!keyShape.test(key)) throw Object.assign(new Error('That does not look like an ElevenLabs API key.'), { code: 'invalid_key', status: 400 });
      const r = await security(['-i'], `add-generic-password -U -s ${service} -a ${account} -w ${key}\n`);
      if (r.code !== 0) throw keychainError('save to');
    },
    async delete() {
      ensureMac();
      const r = await security(['delete-generic-password', '-s', service, '-a', account]);
      if (r.code !== 0 && r.code !== notFound) throw keychainError('delete from');
    },
  };
}
