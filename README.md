# Local video editing with your AI app

**Codex or your AI app of choice (such as Claude Code) is the main interface.** This folder holds your saved preferences and video projects. The local app is a read-only companion: see where files are, watch drafts and copy instructions into your AI app. It never changes anything itself, is not a timeline editor and does not run AI.

## How it works
1. **Once:** set up tools and your editing style by talking to your AI app.
2. **Each video:** copy your raw video into `workspace/drop-videos-here/` using Finder.
3. **Then:** tell your AI app “I put a new video in drop-videos-here.” Everything else happens in the conversation. Your video is **moved** out of the drop folder into its project; a note is left behind saying where.
4. **Result:** when you approve a version, it is copied to `workspace/finished-videos/`.

## Start here
1. Keep this unzipped folder in a permanent local location, not inside the ZIP or an undownloaded cloud placeholder. **After setup, don't rename or move it.** If you have to, reopen it in your AI app and tell it the old and new name or location, so it can restart the companion and update the saved paths.
2. Open the entire folder as a local project in your AI app: the Codex desktop app, or a terminal assistant such as Claude Code started in this folder.
3. Ask your AI app to read `AGENTS.md` (Claude Code loads it automatically through `CLAUDE.md`) and check the folder. Copyable setup/editing prompts are in `system/prompts.md`.
4. Ask your AI app to configure missing tools and prove the editing setup with a short playable test. Setup records live in `system/setup/`; Markdown files do not install software by themselves.
   Also ask it to **set up the asset library** (icons, animations, sound effects). It installs what it can automatically and lists a few free packs you download yourself in the browser; save them to Downloads and ask again.
   Optional: for **AI voiceovers** with synced captions, the setup also installs the ElevenLabs tools (`npm --prefix system/voiceover ci`). To use them, open the app → Setup & preferences → ElevenLabs → Connect, create an ElevenLabs API key, paste it once, and you're ready. After that, ask your AI app for a voiceover in plain words. Each paid voiceover needs your OK first.
5. Establish your own style in `workspace/preferences/editing-guide.md`. `system/sample-editing-guide.md` is an example, never automatic defaults.
6. Ask your AI app: **“Open the app.”** It starts a persistent local server and opens the browser. Node.js 22+ is needed; no npm dependencies are required for the companion.
7. Copy new footage into `workspace/drop-videos-here/` in Finder, and reusable fonts/sounds/supporting media into `workspace/assets/`. Your AI app creates the video's project folder and moves the footage, unchanged, into its `source/` folder, leaving a note in the drop folder. Approved videos are copied to `workspace/finished-videos/`.
8. Review a numbered 15-second opening, iterate, then ask for the full video. Review the entire export before approving. Save explicitly chosen lasting lessons for the next video.

## What gets downloaded
This folder ships only instructions, code and one font. Everything else is downloaded during setup, by your AI app, after asking you. About 1.5–2 GB in total, mostly FFmpeg, the browser used for rendering and the speech model.

**Required (first-time setup):**
- **Homebrew**, if your Mac doesn't have it: the standard macOS package installer.
- **Node.js 22 or newer** (Homebrew): runs the companion app, the asset library and HyperFrames.
- **FFmpeg** (Homebrew `ffmpeg-full`, about 50 libraries; the full build is needed for iPhone HDR footage): reads and writes video.
- **HyperFrames** (pinned `hyperframes@0.8.x`, run with `npx`, cached by npm), its headless Chrome for rendering (about 200 MB in `~/.cache/hyperframes/`) and its agent skills (`npx hyperframes skills update`, into `~/.agents/skills/` and `~/.claude/skills/`). HyperFrames sends anonymous usage telemetry by default; turn it off with `npx hyperframes telemetry disable`.
- **whisper.cpp** (Homebrew `whisper-cpp`) and one speech model in `workspace/assets/models/`: English `base.en` (about 150 MB) or `small.en` (about 490 MB), or a multilingual model for other languages. It turns your speech into timed captions, on your Mac.

**Asset library** (`node system/assets/library.mjs setup`, about 25 MB, into this folder):
- From npm: GSAP 3.14.2 (free GSAP licence), lottie-web 5.13.0 (MIT) and Phosphor Icons 2.1.1 (MIT).
- Pixabay sound effects copied from the HyperFrames media-use skill.
- Optional free packs you download yourself in the browser: Open Stickers (Craftwork), Mixkit sound effects and LottieFiles animations.

**Optional, AI voiceovers:**
- The official ElevenLabs SDK, `@elevenlabs/elevenlabs-js` 2.71.0, with its three small dependencies (`ws`, `node-fetch`, `command-exists`). It goes into `system/voiceover/node_modules/` (about 100 MB) with `npm --prefix system/voiceover ci`.
- It needs an ElevenLabs account. Generating speech uses paid credits, always after your OK.

**Included:** the Inter font (SIL Open Font License) in `workspace/assets/fonts/inter/`.

Your videos never leave your Mac. The only online service is ElevenLabs, and only for voiceover scripts you approve.

## Folder map
```text
AGENTS.md                         AI app entry instructions
CLAUDE.md                         Points Claude Code to AGENTS.md
system/                           Customize carefully
  editing-brain.md                 Editing process
  prompts.md                      Instructions to copy into your AI app
  sample-editing-guide.md          Example, not a default
  setup/                          Setup notes and clarifications
  app/                            Local companion code and tests
  assets/                         Asset library tool, catalogue, motion and caption presets
  voiceover/                      Optional ElevenLabs voiceovers (CLI, service, tests)
workspace/                        Your everyday files
  preferences/                    Personal guide and reusable rules
  assets/                         Fonts, sounds, icons, animations, asset index
  drop-videos-here/               Drop raw footage here (it gets moved into its project)
  finished-videos/                Approved videos, one per project
  videos/<video-name>/
    brief.md                      This video's requirements
    feedback.md                   Review history and approvals
    source/                       Raw footage (your AI app moves it here)
    drafts/                       Numbered exports; keep approvals
    work/                         Transcripts, manifests, scoped helpers
    voiceover/take-NNN/           AI narration takes with word timings (if used)
    composition-*/                Editable video compositions
.agents/skills/                   Skills for Codex (linked for Claude Code in .claude/skills/)
```

## Terminal option
From this repo root:
```sh
node system/app/launch.mjs          # start/reuse app and open browser
node system/app/launch.mjs --no-open # start/reuse without opening
npm --prefix system/app test       # app tests only
node system/assets/library.mjs setup   # install or repair the asset library
node system/assets/library.mjs status  # what is installed, what to download by hand
node system/voiceover/voiceover.mjs status  # ElevenLabs connection (optional)
npm --prefix system/voiceover test     # voiceover tests (mocked, free)
```
The preferred address is `http://127.0.0.1:3005`, configured in `system/app/config.json` (chosen to stay clear of other local tools that use 3000). If occupied, the launcher prints another free local port. It never kills an existing service. See `system/app/README.md` for maintenance.

## The three pages
- **Videos:** the drop folder (with a copyable "start this video" instruction), your finished videos, and every project with its drafts, source and approval state.
- **Workspace:** watch drafts at their real size and shape, see each file's details, and copy feedback or approval for your AI app. Footage, brief and feedback history sit in folded sections below.
- **Setup & preferences:** what is installed (only what has actually been checked), the ElevenLabs connection (the only thing you can change here, so your key never goes through the chat), your preferences and setup notes, the asset library, and the optional editing-factor explorer. Selections only build instructions; illustrations do not approve fonts, colors or assets.

To change any file, tell your AI app. Customize with it however you like. Changing core paths may break the workflow; keep a backup. This is a local, macOS-only workflow for now, not a cloud service. No publishing or purchases occur automatically. Existing media may need QuickTime if a browser cannot play its codec; the app does not silently transcode HDR.

Licensing for each added font/sound/media asset remains the user's responsibility.
