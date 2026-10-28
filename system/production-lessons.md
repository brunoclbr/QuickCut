# Production lessons
Technical lessons from real edits of iPhone HLG footage with HyperFrames. Read before building or revising a composition. Style decisions live in workspace/preferences/; this file is about how to build and check. Keep a reference build (a builder script such as `build-composition.mjs` plus the small helper scripts it needs) in the `work/` folder of your first approved video and reuse it for the next ones.

## Build from a script, anchored to words
- Generate `composition/index.html` from a builder script, never by hand. Inputs: `work/edl.json` (cut list: `id, who, from, to, gap, at, end`, optional `file`, `vol`, `fadeOut`) and `work/speech-check-words.json` (word times on the cut audio). Anchor every effect to a spoken word (`A(word, after)`), so re-timing a line moves everything with it.
- When gaps change, move each word with its segment instead of re-transcribing. Re-transcribing the whole mix changes unrelated words ("Claude" became "Clot", "Clode") and breaks verified captions.
- Snapshot per draft: `build-composition-NN.mjs`, `edl-vN.json`, `speech-check-words-vN.json`. Never overwrite a draft; move superseded renders to `work/render-tests/`.

## Sync between picture and voice
- A speaker's clip must stop where their line stops. In one edit the speaker kept playing past their last line and was seen mouthing the next words 1.3 s before they were heard. After a line, show silent footage of the same person (a stretch without speech), and cut into the next synced take inside a transition.
- Lines that are contiguous in the source (gap under ~0.2 s) can play as one continuous synced take.
- Frozen "portraits" or listeners: never freeze on an open mouth.

## Speech timing and captions
- Parakeet word times can be 0.2–0.3 s off: first words early, final words late ("things" was 0.17 s late). For the hook and punchlines, measure onsets on a 10 ms RMS envelope and time those words by hand, about 2 frames before they are spoken.
- After every changed cut, re-transcribe the rendered audio around it to prove the words are there and in order.
- Fix product names in the caption rules of the builder (Higgsfield, Claude); never let a transcription error reach the screen.
- A title screen's captions must leave before the screen moves away (clamp them to the transition start).

## HDR rendering (HyperFrames 0.8.143, iPhone HLG footage)
- Colours: HyperFrames shows CSS colours as if SDR white were HLG peak, without BT.709→BT.2020. Pass every colour through `hdr()` (K = 0.5 + BT.2020 matrix, in your reference builder) and pre-convert screenshots with the same matrix (a small helper script). Text over a bright HDR wall looks grey: give it a local dark text-shadow halo, never a full-frame tint (never tint the footage).
- Footage is drawn outside the browser: CSS filters, blur, greyscale and masks never reach it. Make prepared HLG clips with ffmpeg instead (x265 10-bit, BT.2020 / arib-std-b67 tags): black-and-white freeze with a colour wipe (`lutyuv u=512:v=512`, `blend` wipe; keep the command in a helper script) and a ripple dissolve between two takes (`geq` displacement, smoothstep `blend`; also a helper script). `system/assets/compose.mjs` `freezeClip` covers plain freezes.
- Freeze in the composition: a second clip with `data-playback-rate="0.1"` (the minimum allowed).
- Punch-ins inside a card: resize the video box around the face (width/height); a CSS scale escapes the card's clip. Full-frame videos can scale.
- Whole-scene moves (the full-frame swipe): translate the scene wrappers and cards with `x`; their videos follow. Full-screen panels otherwise use opacity and clip-path wipes, never `visibility`.
- Timed layers can leak into later frames: the hook's words ("things.", "terrible") showed through later panels in draft 06. When a layer's job ends, set its contents to opacity 0 explicitly.
- Video tiles: make the camera box larger than the tile (360 px wide in a 320 tile) so the face offset never exposes the card colour.
- Masked headline text: negative letter-spacing pulls the box in past the last glyph and `overflow: hidden` cuts it (the period after "AI."). Give masked spans `padding-right: .06–.08em`.
- Every `<audio>` gets its own `data-track-index`; two sounds overlapping on one track can drop one.

## Sound
- Measure, don't guess: integrated about −18 LUFS, peak ≤ −1.5 dBFS, voice about −20 LUFS in short windows. Check every effect window against the voice next to it.
- Without music, effects are much louder than they seem in the script: the cinematic whoosh at 0.45–0.6 was "too loud"; a good level was about 0.03.
- Very soft files (a very quiet effect) need a gain-boosted copy (`volume=14dB` + `alimiter`), not a volume above 1.
- A separately recorded line: compare loudness and spectrum with the camera voice; EQ, light compression and a faint room reflection got it to within 0.1 LU (keep the recipe in a helper script). Room tone from the same recording runs under the whole edit.
- Speeding a sound effect without changing pitch: `atempo` (the trombone ran at 1.9×).

## Checking before presenting
- `ffprobe` (HEVC Main10, arib-std-b67), full decode, `ebur128` overall and around changes, transcript around changes, a 1 fps contact sheet plus frame strips at every changed moment (tone-map with a zscale chain: linear light, bt709, `tonemap=hable`).
- `hyperframes snapshot --at … --no-end --describe false` for quick layout checks before rendering. Snapshots are SDR: judge contrast on an HDR render. Always pass `--describe false`, or frames may be sent to Gemini when `GEMINI_API_KEY` is set.
- Short test renders: cut a short window out of the composition with a small helper script, render it (`-c test.html`), delete the test file. Elements with `data-start="0"` may leak into window tests (not full renders).
- Run `hyperframes check` after every build; read new warnings (shared audio tracks showed up there).
- A full 76 s render at `--quality looks --fps 30 --workers 3` takes about 15 minutes; render the hook alone first when the opening changes.

## HyperFrames Studio
- `npx hyperframes preview --port 3002` opens the editor on `composition/`. Studio saves edits into `composition/index.html` (it adds `data-hf-id` and re-serialises); the next build overwrites them. Back up the file, diff it against a fresh build ignoring `data-hf-id` and serialisation, and carry the real changes into the builder.
- Studio's Export writes to `composition/renders/`, not `drafts/`, and may not use the draft settings. Render drafts with the CLI.

## Shell pitfalls (zsh)
- `$G[a]` is an array subscript in zsh: write `${G}[a]` when a variable is followed by a filter label. Variables are not word-split (`${=spec}`).
- Put long ffmpeg filter graphs in variables built step by step and test each filter alone first.
