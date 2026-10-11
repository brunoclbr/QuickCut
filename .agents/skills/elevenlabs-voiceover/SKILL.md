---
name: elevenlabs-voiceover
description: Add an AI voiceover (ElevenLabs) with word-synced captions to a video project in this repo. Use when the owner asks for narration, a narrator, a voiceover or a voice for a video, or describes a voice ("deep warm male, cinematic"). Generation costs credits, so it always needs the owner's approval first.
---

# ElevenLabs voiceover

Optional, paid. Tool: `node system/voiceover/voiceover.mjs` (run from the repo root; details in `system/voiceover/README.md`). Captions: `system/assets/hf/captions.js`. The key is in the macOS Keychain; never ask for it, print it, read it or pass it on a command line.

## 0. Is it ready?
`voiceover.mjs status`
- `sdkInstalled: false` → run `npm --prefix system/voiceover ci` (one-time, free).
- `connected: false` → tell the owner: say "open the app", then Setup & preferences → ElevenLabs → Connect, and paste a key there. Never take the key in chat; if they paste one anyway, tell them to delete that key on ElevenLabs and create a new one.
- `checks.voicesRead: false` → the key cannot list voices; ask for a voice ID or a key with Voices read access.

## 1. Script first (free)
Write the narration to fit the video (length, tone, what is on screen). Save it as `workspace/videos/<name>/work/voiceover-script.txt`. Spoken words stay plain text; delivery goes in square-bracket tags, which are spoken as direction, not read out and never captioned:
- Tags (Eleven v4): `[warm]`, `[calm, thoughtful]`, `[excited]`, `[confident]`, `[whispers]`, `[sighs]`, `[laughs]`, `[curious]`, `[sarcastic]`, or plain descriptions like `[low, gravelly voice]`, `[building tension, measured pace]`, `[softly, with wonder]`.
- Turn the owner's direction into tags at the right sentences: "start calm, get enthusiastic, end confident" → `[calm] … [growing enthusiasm] … [confident]`.
- Pauses: ellipses (…) and sentence breaks. CAPITALS add emphasis. No SSML (`<break>` etc.).
- Match tags to the voice: a measured narrator will not shout convincingly. Say what may not come through exactly.
- One take allows 2,000 characters; split longer narration into several takes.

## 2. Pick a voice (free)
If `status` shows a `preferredVoice` and the owner didn't ask for something else, propose it. Otherwise translate the description into filters and search:
`voiceover.mjs voices [words] --gender male --age middle_aged --accent british --use-case narration --limit 10`
Read names, descriptions and labels; propose 2–3 real matches with one line each (and the preview link). Never invent voice IDs. If nothing fits, say so and offer the closest. Save the owner's usual voice with `voiceover.mjs prefer <id>` only when they say it's their default.

## 3. Approval (required before any paid call)
`voiceover.mjs estimate --project <name> --script <file> --voice <id>`
Show the owner: the full script with tags, the voice, the intended delivery, model (`eleven_v4`), characters, estimated credits and remaining balance (when reported), and whether a cached take already exists (free). Ask for a clear yes.

## 4. Generate
`voiceover.mjs generate --project <name> --script <file> --voice <id> --approved`
- An identical request returns the existing take for free (`reused: true`). A new performance of the same script needs `--new-take` and its own approval. Never regenerate on your own to "improve" a take.
- Takes are saved in `workspace/videos/<name>/voiceover/take-NNN/` (audio, script, spoken text, raw alignment, `words.json`, `take.json`) and never overwritten.
- Exit 6 (`uncertain`): the request may have been charged. Do not retry; ask the owner to check their ElevenLabs usage page first. Exit 5: explain the reason (credits, permissions, voice, busy). Exit 4: connection problem, see step 0.
- Read `warnings` in the result. No `words.json` means no timing came back: say captions cannot be synced from this take. Never estimate word timings yourself. Forced alignment would cost extra; offer it only with the cost and approval.

## 5. Put it in the video (HyperFrames)
`voiceover.mjs use --project <name> --take take-001 [--composition composition]`
This copies the audio, the word timings and `captions.js` into `<composition>/assets/voiceover/` and prints the HTML to paste: the `<audio>` clip, an empty `#captions` clip and `HFCaptions.mount(tl, "#captions", words, { offset, emphasis })`. Set `offset` to the audio's `data-start`. Mix under or over the original footage audio as the owner wants (lower the source `data-volume` under narration).
- Captions follow the owner's saved style (`workspace/preferences/editing-guide.md`). By default the spoken word changes colour (`highlight: "color"`, `--hfc-active`); `highlight: "box"` puts a box behind it instead (`--hfc-box`). Restyle with CSS variables on `#captions` (`--hfc-font`, `--hfc-size`, `--hfc-color`, `--hfc-active`, `--hfc-accent`, `--hfc-shadow`, `--hfc-scrim` for a soft fade on bright footage, `--hfc-bottom`, `--hfc-width`) and options (`emphasis: ["word", …]` for the accent colour, `mode: "word"`, `entrance`, `maxWords`). None of that needs a new take.
- Render with the normal workflow, save a numbered draft and inspect frames at a few word times to confirm sync. The companion shows the draft like any other.
