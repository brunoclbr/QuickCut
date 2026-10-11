#!/usr/bin/env node
// Voiceover CLI for the AI app. The API key is read from the macOS Keychain internally; it is never an argument.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createVoiceover, VoiceoverError } from './service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const usage = `Usage (from the repo root):
  node system/voiceover/voiceover.mjs status [--check]        connection state; --check asks ElevenLabs again (free)
  node system/voiceover/voiceover.mjs voices [words] [--gender male|female] [--age young|middle_aged|old]
                                             [--accent british] [--language en] [--use-case narration] [--limit 20]
  node system/voiceover/voiceover.mjs prefer <voice-id>        save the owner's usual voice
  node system/voiceover/voiceover.mjs estimate --project <name> --script <file> [--voice <id>] [options]
  node system/voiceover/voiceover.mjs generate --project <name> --script <file> [--voice <id>] [options] --approved [--new-take]
  node system/voiceover/voiceover.mjs takes --project <name>
  node system/voiceover/voiceover.mjs use --project <name> --take take-001 [--composition composition]
Options: --model eleven_v4  --language en  --stability 0-1  --similarity 0-1  --seed <n>
generate reuses an identical earlier take for free; --new-take records another performance (paid).
Exit codes: 0 ok, 2 bad input, 3 needs approval, 4 not connected/key problem, 5 refused by ElevenLabs, 6 network/uncertain, 7 tools not installed.`;

const options = {
  check: { type: 'boolean' }, approved: { type: 'boolean' }, 'new-take': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  project: { type: 'string' }, script: { type: 'string' }, voice: { type: 'string' }, model: { type: 'string' }, language: { type: 'string' },
  stability: { type: 'string' }, similarity: { type: 'string' }, seed: { type: 'string' }, take: { type: 'string' }, composition: { type: 'string' },
  gender: { type: 'string' }, age: { type: 'string' }, accent: { type: 'string' }, 'use-case': { type: 'string' }, limit: { type: 'string' },
};
const out = data => console.log(JSON.stringify(data, null, 2));

async function main() {
  let parsed;
  try { parsed = parseArgs({ options, allowPositionals: true, strict: true }); }
  catch (error) { throw new VoiceoverError('usage', `${error.message}\n\n${usage}`); }
  const { values: v, positionals: [command, ...rest] } = parsed;
  if (!command || v.help) { console.log(usage); return; }
  const vo = createVoiceover({ root: path.resolve(here, '../..') });
  const generation = async () => {
    if (!v.script) throw new VoiceoverError('usage', 'Pass the narration script file with --script.');
    const script = await fs.readFile(path.resolve(v.script), 'utf8').catch(() => { throw new VoiceoverError('usage', `Cannot read the script file ${v.script}.`); });
    return { project: v.project, script, voiceId: v.voice, model: v.model, languageCode: v.language, stability: v.stability, similarity: v.similarity, seed: v.seed, approved: v.approved, newTake: v['new-take'] };
  };
  switch (command) {
    case 'status': return out(v.check ? await vo.check() : await vo.status());
    case 'voices': return out(await vo.voices({ search: rest.join(' '), gender: v.gender, age: v.age, accent: v.accent, language: v.language, useCase: v['use-case'], limit: v.limit }));
    case 'prefer': return out(await vo.preferVoice(rest[0]));
    case 'estimate': return out(await vo.estimate(await generation()));
    case 'generate': return out(await vo.generate(await generation()));
    case 'takes': return out(await vo.takes(v.project));
    case 'use': { const r = await vo.use({ project: v.project, take: v.take, composition: v.composition }); out({ take: r.take, folder: r.folder, duration: r.duration }); console.log(`\n${r.html}`); return; }
    default: throw new VoiceoverError('usage', `Unknown command "${command}".\n\n${usage}`);
  }
}

try { await main(); }
catch (error) {
  if (error instanceof VoiceoverError) { console.error(`Error (${error.code}): ${error.message}`); process.exitCode = error.exit; }
  else { console.error(`Error: ${error.message}`); process.exitCode = 1; }
}
