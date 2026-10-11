# QuickCut

**You direct. AI edits.**

Turn raw footage into professional videos by talking to your AI app — Codex, Claude Code, or your terminal assistant of choice. No timeline to learn, no clips to drag.

![Open Source](https://img.shields.io/badge/license-MIT-blue) ![Free to Use](https://img.shields.io/badge/free%20to%20use-yes-brightgreen) ![AI-Powered Editing](https://img.shields.io/badge/AI--powered-editing-purple)

<p align="center">
  <img src="https://placehold.co/360x200?text=01+-+Raw" alt="01 — Raw footage (placeholder, replace with a real GIF)" width="30%">
  <img src="https://placehold.co/360x200?text=02+-+Editing" alt="02 — Editing in progress (placeholder, replace with a real GIF)" width="30%">
  <img src="https://placehold.co/360x200?text=03+-+Final" alt="03 — Finished video (placeholder, replace with a real GIF)" width="30%">
</p>

<p align="center"><em>Placeholders. Replace with three GIFs recorded from a real QuickCut project: raw footage → an editing conversation → the finished export.</em></p>

## Get started in minutes

1. Download QuickCut from GitHub and keep the unzipped folder somewhere permanent (not inside the ZIP, not in an undownloaded cloud placeholder).
2. Open the folder as a project in your AI app — the Codex desktop app, or a terminal assistant such as Claude Code started in this folder.
3. Say "set up this video editing folder for me" and follow along. No terminal experience required.
4. Copy your footage into `workspace/drop-videos-here/` and describe the edit you want in plain language.
5. Optionally connect ElevenLabs for AI voiceovers with word-synced captions.

The full first-time walkthrough, step by step, lives in [`START HERE.txt`](START%20HERE.txt).

---

<p align="center">
  <img src="https://placehold.co/760x220?text=Drop+footage+%E2%86%92+talk+to+your+AI+app+%E2%86%92+finished+video" alt="Workflow diagram placeholder: drop footage in, describe the edit in conversation, get a finished video out" width="90%">
</p>

Your video is **moved** (not copied) into its own project the moment your AI app picks it up. Approve a draft and it lands in `workspace/finished-videos/` — nothing else changes automatically.

> 🚧 **TODO:** link a professionally edited video made with QuickCut here.



## The philosophy

**AI shouldn't replace your creativity. It should accelerate your execution.**

Think the finished video through first — pacing, framing, transitions, captions, sound, effects, whether images sit in front of or behind other elements. Once that's in your head, hand it to QuickCut as context and let the AI app handle the clicky stuff.

QuickCut isn't a video editor where you manually move clips around. You direct the creative decisions; the AI app and its tools do the technical execution.

## Say it, don't click it

A few examples of what you'd actually type:

> "Cut the first 15 seconds into a punchy opening, add captions, and duck the music under my voice."

> "This clip feels dark and flat — can you grade it warmer, like an old camcorder?"

> "Give me a voiceover for this script in a deep, warm, cinematic voice."

<p align="center">
  <img src="https://placehold.co/760x160?text=Word-synced+captions+example" alt="Placeholder: a video frame showing word-synced AI voiceover captions" width="90%">
</p>

## The three pages

![QuickCut's companion app — Videos page, showing project folders, drop-folder notes, and approved exports](docs/images/app-snapshot.png)

The companion app is a **read-only window** into your projects — it never edits, renders, or uploads anything itself. Everything happens in conversation with your AI app; the app just shows you where things stand.

- **Videos:** the drop folder, your finished videos, and every project with its drafts, source and approval state.
- **Workspace:** watch drafts at their real size and shape, and copy feedback or approval straight into your AI app.
- **Setup & preferences:** what's installed, your editing style, the asset library, and the one thing you *can* change here directly — connecting ElevenLabs, so your API key never passes through the chat.

## Enjoying QuickCut?

QuickCut is built and maintained as an open-source project. If it helps you make something great, consider starring the repository — it helps others find it. If you build on it, a link back to the original project is appreciated.

## License

MIT — see [LICENSE](LICENSE). You're free to use, modify, and redistribute QuickCut's code; just keep the copyright and license notice. Fonts, sounds, and other third-party assets you add to `workspace/assets/` are not covered by this license — their own terms are your responsibility (see `system/assets/README.md`).
