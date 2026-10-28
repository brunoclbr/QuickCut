# Voiceover (ElevenLabs, optional)

AI narration with word-synced captions for HyperFrames videos. Optional and paid: nothing here runs unless a voiceover is requested, and videos without narration render exactly as before.

## Who does what
- **Owner:** connects ElevenLabs once in the companion (Setup & preferences → ElevenLabs → Connect) and approves each paid generation.
- **AI app:** writes the script, picks a voice, asks for approval, runs the CLI and builds the composition. Follow `.agents/skills/elevenlabs-voiceover/SKILL.md`.
- **This folder:** the only code that talks to ElevenLabs (official SDK `@elevenlabs/elevenlabs-js`, pinned in `package.json`).
- **HyperFrames:** plays the audio; `system/assets/hf/captions.js` draws the captions from the saved word timings.

## Files
- `service.mjs`: the shared service (status, connect/disconnect, voices, estimate, generate, takes, use). Used by both the CLI and the companion server.
- `voiceover.mjs`: CLI for the AI app (`node system/voiceover/voiceover.mjs --help`).
- `keychain.mjs`: stores the key in the macOS login Keychain (service `ai-video-editing.elevenlabs`). The key is passed to `security` on stdin, never as an argument.
- `alignment.mjs`: ElevenLabs character timings → caption words. Drops `[delivery tags]`, keeps punctuation, validates order and length. It never estimates timing.
- `.connection.json` (git-ignored): account name, plan, the checks that passed and when. Never the key.
- `test/`: mocked SDK and key store; no network, no Keychain, no credits.

## Install
`npm --prefix system/voiceover ci` (one-time; part of setup). Without it, the companion shows "tools not installed" and the CLI exits with code 7.

## Model and API
Eleven v4 (`eleven_v4`) through Text to Dialogue with timestamps (`textToDialogue.convertWithTimestamps`), with a single speaker. It returns the audio plus character-level `alignment` and `normalized_alignment`; captions use `alignment` because it matches the script as written (falling back to `normalized_alignment`). Limit: 2,000 characters per take. Delivery uses v4 audio tags in square brackets and punctuation; SSML is not supported. Settings: `stability` and `similarity` (0–1), optional `seed`.

## Connection checks (free)
Connecting validates the key with `GET /v1/user` (account, plan, credits) and a one-voice search (voice listing). A key without those permissions still connects; the companion shows what it can't do. Permission to generate speech can only be proven by generating, which costs credits, so the companion shows "Speech: Not yet confirmed" until the first take.

## Takes and caching
`workspace/projects/<project>/<video>/voiceover/take-NNN/`:
- `audio.mp3`;
- `script.txt` (with tags) and `spoken.txt` (without);
- `alignment.json` (raw API timings) and `words.json` (`{ duration, words: [{ text, start, end }] }`);
- `take.json`: voice, model, settings, tags, characters, cache key, warnings and creation time.

Takes are written to a temporary folder and only numbered when complete; an existing take is never overwritten. The cache key covers script, voice, model, language, settings, seed and output format. An identical request returns the saved take without a new API call. `--new-take` records another performance. Caption style, fonts, colours, resolution and visuals are not part of the key, so changing them never needs new audio.

## Cost safety
- `generate` refuses to call ElevenLabs without `--approved`.
- `estimate` shows characters, credits (characters × the model's cost factor, when the key can read models) and remaining balance.
- The SDK runs with `maxRetries: 0`. A timeout or network failure during generation is reported as "uncertain" (exit 6) and never retried: check the ElevenLabs usage page first.

Errors are plain-language and never contain the key:

| Exit | Meaning |
|---|---|
| 2 | Bad input |
| 3 | Needs approval |
| 4 | Not connected, or a key problem |
| 5 | Refused (credits, permissions, voice, busy) |
| 6 | Network problem, or uncertain whether charged |
| 7 | Tools not installed |

## Security notes
The companion's two key endpoints (`POST /api/voiceover/connect|disconnect`) accept only same-origin JSON on 127.0.0.1 and never return the key. The key is never written to files, logs, project metadata or command arguments. The AI app has shell access on the same Mac and could technically read the Keychain item. The design keeps the key out of chats, files and logs; it does not claim to isolate the key from local tools.

## Tests
`npm --prefix system/voiceover test` (and `npm --prefix system/app test` for the endpoints).
