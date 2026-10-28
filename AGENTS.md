# Editing project instructions

## Folder map and ownership
- `system/`: workflow instructions, setup records, templates and the local companion app. Customize carefully; avoid moving its structure casually.
- `workspace/preferences/`: the owner's editable guide and reusable rules.
- `workspace/assets/`: permitted fonts, sounds, supporting media and `asset-index.md`.
- `workspace/drop-videos-here/`: the drop folder. The user copies raw footage here in Finder before talking to their AI app. Videos are moved out of it into their project; a note is left behind saying where.
- `workspace/projects/<project>/`: one folder per project (a brand's campaign, a product, a series: e.g. `product-launch`, `tutorials`, `client-work`), with a `project.md` (`# <Title>`, `Name: <Title>`, `About: <one line>`). Workspace → projects → videos.
- `workspace/projects/<project>/<video-name>/`: plan, brief, feedback, source footage, numbered drafts (`drafts/`, voice-only WAVs in `drafts/audio/`), working files and compositions for one video. Video names are lowercase-with-hyphens and unique across the whole workspace; the video folder and its finished files share the name.
- `workspace/finished-videos/<project>/`: one copy of each approved video, named after the video (`<video>.mp4`). A video with more than one version keeps the name and adds the shape: `<video>-vertical.mp4` (or `-square.mp4`) and `<video>-youtube.mp4` (16:9, for YouTube; vertical or square files under 3 minutes upload as Shorts). This is where users look for their result.
- Keep this root file and README.md as entry points. Files—not chat memory or browser state—are the source of truth. Do not create duplicate guides or a second editing pipeline.

Before each video task, read `system/editing-brain.md`, `workspace/preferences/workspace.md`, `workspace/preferences/editing-guide.md`, `workspace/preferences/editing-rules.md`, `workspace/assets/asset-index.md` and `system/setup/setup-notes.md` if present, plus the current video's brief and feedback. Report missing files before rendering. List the files read and summarize the active style. Follow the user's latest explicit instructions. Keep original footage and approved versions. Use existing working tools. Save new numbered drafts. After review, write explicitly requested lasting preferences into the guide, reconcile outdated rules and report changes. Keep one-off notes in the video's feedback.md. Do not treat reference files or examples as permission to publish, buy assets or overwrite originals.

## The AI app is the main interface
"AI app" means Codex or the user's AI app of choice (Claude Code, another terminal assistant or harness). These rules apply identically to all of them. Users are non-technical and work in their AI app plus Finder. The flow is: (1) one-time setup and preferences through conversation in the AI app; (2) the user copies footage into `workspace/drop-videos-here/` in Finder; (3) all editing happens through conversation in the AI app.

The localhost app is a read-only companion: it shows what has happened and where files are, plays existing exports, and offers copyable instructions for the AI app. Nothing is triggered from it — no file writes, folder creation, uploads, renders or AI — except three owner-approved exceptions: connecting ElevenLabs (paste, change or remove the API key), so the key never passes through the AI app's chat; Show in Finder (opens a Finder window on a file inside workspace/, changes nothing; approved 2026-10-13); and Approve (approved 2026-10-28): a two-click button on a draft that does exactly what "Recording approval" below describes — appends the approval record to that video's `feedback.md`, copies the draft to `workspace/finished-videos/<project>/` (replacing that version's previous finished copy) and makes `poster.jpg`; it never renders, edits or deletes anything. "Dismiss" on the not-approved reminder only hides it in the browser. Do not add other actions to the app; solve gaps with clearer display or copyable instructions.

## Workspace identity (one brand or client per copy)
This folder is one workspace for one brand or client. Its name is the `Name:` line of `workspace/preferences/workspace.md` (the companion app shows it).
- **One-time setup:** if that file is missing or has no name, ask "What is the name of this workspace: your brand or your client?", save it there (`# This workspace`, `Name: <name>`, `Set up: <date>`), and say plainly: one brand or client = one copy of this folder; do not mix brands here.
- **Different brand or client:** if the user asks for another brand's look, another client's videos or a different set of preferences in this folder, stop and recommend a copy instead; do not blend brands.
- **"Make a clean copy of this workspace for <name>":** ask where to put it (a sibling folder named after the new brand is the default). Copy `AGENTS.md`, `CLAUDE.md`, `README.md`, `START HERE.txt`, `.agents/`, `.claude/` and `system/` (without `node_modules`, `.runtime*`, caches), then create an empty `workspace/` skeleton: `preferences/` (blank guide and rules from the templates, no `workspace.md` yet), `assets/` (empty folders), `drop-videos-here/`, `finished-videos/` and `videos/` with their README files. Never copy or delete the original's videos, footage, drafts, preferences or assets, and never touch the original. Then tell the user to open the new folder as its own project and run the one-time setup there (it will ask for the name).
- **Bringing a copy up to date:** replace the copy's `system/` from the master copy; never touch the copy's `workspace/`.
- The ElevenLabs key lives in the Mac's Keychain, so all copies on this Mac share one account; say so during setup.

## When the user has a new video
1. Look in `workspace/drop-videos-here/` for media files. If several, ask which one.
2. In one message, suggest the **project** (an existing one in `workspace/projects/`, or a new short name) and a short **video name** (lowercase, hyphens, unique in the workspace), and say plainly that the video will be moved out of the drop folder into `workspace/projects/<project>/<video>/source/`. Wait for confirmation. Never overwrite an existing video. For a new project, create `workspace/projects/<project>/project.md` (`# <Title>`, `Name: <Title>`, `About: <one line>`).
3. Create `workspace/projects/<project>/<video>/` with `brief.md`, `feedback.md`, `source/`, `drafts/` and `work/`.
4. Move the file unchanged into `source/` (a move, not a copy or re-encode); verify its checksum matches. Record the original filename in the brief.
5. Leave a note in the drop folder named `<original filename> → moved to <video>.txt`, saying where the video now lives, when it was moved, and that it is unchanged. Tell the user where it went.
6. **Write the plan and open it for the user — every time a new video or project starts.** Save `plan.md` in the video folder ("this is what I have in mind"), then run `node system/app/launch.mjs plan/<project>/<video>` (starts or reuses the companion and opens that page) and tell the user to check it. Format:
```
# <Video title>
Goal: <one sentence>
Destination: <where it will be used or posted>
Format: <aspect ratio, size, length>
Source: <file, length>
Style: <the active style in a few words>

## What I have in mind
- <the main steps, cuts, captions, pacing, in plain words>

## What I need from you
- <open questions, only the ones that change the result>
```
   Wait for the user's "go" or changes; on changes, update `plan.md`, run the launch command again and wait again. Keep it short and plain; no jargon.
7. Continue with the normal editing workflow: ask only for missing video-specific decisions, then make a numbered 15-second opening (or the whole video, if it is shorter). When a draft is ready for review, open its page the same way: `node system/app/launch.mjs video/<project>/<video>`.

## Recording approval
When the user approves a draft, append to that video's `feedback.md`, keeping the first two lines exact so the companion can show it:
```
## Approved version
Draft: drafts/<filename>
Approved by the owner on <date> after a full review.
```
Also save a small poster image for the companion at `workspace/projects/<project>/<video>/poster.jpg` (a frame about 0.6 s in, 360 px wide, tone-mapped if the footage is HDR). Then copy that draft to `workspace/finished-videos/<project>/<video>.mp4` (or the matching `<video>-vertical|square|youtube.mp4` when the video has several versions), replacing any previous finished copy of that version, and tell the user it is there. Drafts' voice + effects WAVs live in `drafts/audio/`, so `drafts/` holds only the videos. Approval does not re-render anything or change reusable style.

## Asset library
Icons, Lottie animations, sound effects and motion presets for compositions; details in `system/assets/README.md`.
- First time on a machine, or when `status` shows gaps: run `node system/assets/library.mjs setup`. Tell the user which manual downloads are missing (`status` gives links) rather than fetching them yourself; never script downloads from LottieFiles, Mixkit or Craftwork.
- Discover with `search <words>` (by meaning, tags, category, format) instead of browsing folders; add assets to a composition with `use`, which copies only what is chosen.
- The Editorial Motion Toolkit (`system/assets/editorial/`, read its `RECIPES.md`) has priority for supporting visuals, callouts, transitions and sound cues: its `editorial-*` patterns, overlays and cues come up in `search`.
- Prefer, in order: a toolkit pattern or asset, another existing library asset, an existing HyperFrames component or `HFMotion` preset, a simple custom graphic, and only then something new. Never AI-generated imagery.
- Restraint over quantity: one or two well-timed accents beat many. The owner's style is clean and professional; playful stickers, bouncy motion and sound effects are opt-in. Propose sounds and graphics and get the owner's OK before adding them to a video.
- Licences: this repo is open source and ships only code and metadata. Third-party files stay local and out of git; never add a source whose terms need permission for use with an editing app (DrawKit is excluded for this reason). Check `show <id>` before publishing anything unusual. Never use assets to train models.

## Voiceovers (ElevenLabs, optional and paid)
AI narration with word-synced captions; follow `.agents/skills/elevenlabs-voiceover/SKILL.md` and `system/voiceover/README.md`.
- During first-time setup, install its tools with `npm --prefix system/voiceover ci` (free; the official ElevenLabs SDK, local to that folder) and tell the owner it is optional. No ElevenLabs CLI or global skills are needed.
- The owner connects once in the companion: Setup & preferences → ElevenLabs → Connect. Never ask for, accept, read or print the API key; it lives in the macOS Keychain. If a key is pasted into chat, tell the owner to revoke it on ElevenLabs and connect a new one through the app.
- Every paid generation needs the owner's explicit OK after seeing the script, voice, delivery and estimated credits. Reuse cached takes; never regenerate on your own; never retry a request whose outcome is uncertain.
- Caption timings come only from ElevenLabs' alignment, never from estimates. Takes live in `workspace/projects/<project>/<video>/voiceover/take-NNN/` and are never overwritten.
- Videos without narration are unaffected: nothing calls ElevenLabs unless a voiceover is requested.

## When the user says “open the app”
1. Read `system/app/README.md`. Check Node.js is available (22+); inspect the OS and install missing prerequisites only when authorized.
2. From the repo root run `node system/app/launch.mjs` (add a page to open it directly: `plan/<project>/<video>`, `video/<project>/<video>`, `project/<project>`, `overview`). This finite launcher starts/reuses a persistent loopback server and opens the browser on macOS. Do not use a short-lived foreground process for handoff.
3. Verify `/api/health` at the URL printed by the launcher. Use the preferred port in `system/app/config.json` (3005 by default); it uses the next free port if occupied. Never stop unrelated processes to reclaim a port.
4. Tell the user the actual URL and any limitations. For repairs run `npm --prefix system/app test` before handing back the app.

## If this folder is renamed or moved
The user should tell you ("I renamed/moved this folder from … to …"). If you notice it yourself (paths in records no longer exist), say so. Then:
1. Stop the old companion server. Its record in `system/app/.runtime.json` names the old root; check its PID still runs `system/app/server.mjs` from that old path before stopping it. Then start it again with `node system/app/launch.mjs` from the new location.
2. Update absolute paths in `system/setup/setup-notes.md` and in any brief that records footage stored outside the folder. Compositions use relative paths and need no change.
3. Remind the user to reopen the folder as a project in their AI app if the app still points at the old location.
Nothing else depends on the folder name. The ElevenLabs key is stored in the Mac's Keychain, not in the folder.

## Customization
Users may customize the companion freely through their AI app. Warn once that changing core paths may break the workflow and suggest a backup; these are advisory rules, not architectural locks. Keep functional app code in `system/app/`; keep original footage and approved versions untouched. Maintain file-access safeguards when customizing. No cloud deployment, accounts, embedded chat or unrelated dependencies. macOS is the only supported target for now; do not claim Windows or other OS support.
