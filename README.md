# QuickCut

**You direct. AI edits.**

Turn raw footage into professional videos by talking to your AI app — Codex, Claude Code, or your terminal assistant of choice. No timeline to learn, no clips to drag.

![Open Source](https://img.shields.io/badge/license-MIT-blue) ![Free to Use](https://img.shields.io/badge/free%20to%20use-yes-brightgreen) ![AI-Powered Editing](https://img.shields.io/badge/AI--powered-editing-purple)

<p align="center">
  <img src="docs/images/01-raw.gif" alt="01 — Raw footage, straight from the phone" width="30%">
  <img src="docs/images/02-editing.gif" alt="02 — The same moment across drafts 01 to 10, edited by conversation" width="30%">
  <img src="docs/images/03-final.gif" alt="03 — The approved, finished export" width="30%">
</p>

<p align="center"><em>A real QuickCut project: raw footage → ten drafts of feedback and edits → the finished video.</em></p>

## Get started in minutes

1. Download QuickCut from GitHub and keep the unzipped folder somewhere permanent (not inside the ZIP, not in an undownloaded cloud placeholder).
2. Open the folder as a project in your AI app — the Codex desktop app, or a terminal assistant such as Claude Code started in this folder.
3. Say "set up this video editing folder for me" and follow along. No terminal experience required.
4. Copy your footage into `workspace/drop-videos-here/` and describe the edit you want in plain language.
5. Optionally connect ElevenLabs for AI voiceovers with word-synced captions.

The full first-time walkthrough, step by step, lives in [`START HERE.txt`](START%20HERE.txt).

---

Your video is **moved** (not copied) into its own project the moment your AI app picks it up. Approve a draft and it lands in `workspace/finished-videos/` — nothing else changes automatically.

> 📖 Here is a link to a full tutorial on how to make the most out of QuickCut, with my own personal experience and tips on video editing, and with the truths that no one tells you behind these tools: **[read it on Substack](https://miraiengineering.substack.com/p/real-world-ai-no-tutorials-no-made)**



## The philosophy

**AI shouldn't replace your creativity. It should accelerate your execution.**

Think the finished video through first — pacing, framing, transitions, captions, sound, effects, whether images sit in front of or behind other elements. Once that's in your head, hand it to QuickCut as context and let the AI app handle the clicky stuff.

QuickCut isn't a video editor where you manually move clips around. You direct the creative decisions; the AI app and its tools do the technical execution.

## Say it, don't click it

A few examples of what you'd actually type:

> "Cut the first 15 seconds into a punchy opening, add captions, and duck the music under my voice."

> "This clip feels dark and flat — can you grade it warmer, like an old camcorder?"

> "Give me a voiceover for this script in a deep, warm, cinematic voice."

## The four pages

![QuickCut's companion app — Videos page, showing finished videos with Show in Finder, Download and Copy path](docs/images/app-snapshot.png)

The companion app is a **read-only window** into your projects — it never edits, renders, or uploads anything itself. Everything happens in conversation with your AI app; the app just shows you where things stand.

- **Videos:** your finished videos ready to play, every project with its approval status, and a map of where everything lives on your Mac.
- **Workspace:** watch drafts at their real size and shape, see your feedback grouped by draft, get a reminder when the newest draft isn't approved yet, and copy feedback or approval straight into your AI app.
- **Brand:** your colours, fonts, caption and card samples, read straight from your editing guide. To change them, tell your AI app.
- **Setup & preferences:** what's installed, how to keep QuickCut up to date, your editing style, the asset library by topic, and connecting ElevenLabs — so your API key never passes through the chat.

The app only ever does two things itself: connect ElevenLabs, and **Show in Finder**, which opens a Finder window on a file inside `workspace/` and changes nothing.

## Enjoying QuickCut?

QuickCut is built and maintained as an open-source project. If it helps you make something great, consider starring the repository — it helps others find it. If you build on it, a link back to the original project is appreciated.

## License

MIT — see [LICENSE](LICENSE). You're free to use, modify, and redistribute QuickCut's code; just keep the copyright and license notice. Fonts, sounds, and other third-party assets you add to `workspace/assets/` are not covered by this license — their own terms are your responsibility (see `system/assets/README.md`).
