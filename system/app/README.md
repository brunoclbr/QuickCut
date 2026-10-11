# Local editing companion

## Purpose and ownership
Codex or your AI app of choice handles conversation, setup and video editing. This app is a read-only companion. It shows what has happened and where things are: the drop folder for new videos, project folders, original footage locations, numbered drafts, Markdown documents and recorded approvals. It streams existing media unchanged and builds copyable instructions for the AI app. It never writes files, creates folders, records approvals, uploads, renders, runs AI or executes commands. The single owner-approved exception is the ElevenLabs API key: the Setup page can connect, change or remove it so the key never passes through the AI app (handled by `system/voiceover/service.mjs`, stored in the macOS Keychain). It has no database or deployment configuration.

The `createApp({root})` interface contains the workspace/file logic behind the local HTTP interface, and accepts a root folder for isolated testing. Browser UI code owns presentation only. Existing video-scoped helpers/compositions still own editing and rendering.

## Start / open
Node 22+; no additional app dependencies (the optional ElevenLabs connection uses the SDK installed in `system/voiceover/`). macOS only for now.
From the repo root run `node system/app/launch.mjs`. The launcher is finite: it reuses a healthy server for this folder or detaches a new server, verifies health and opens the actual URL with macOS `open`. `--no-open` skips browser launch. Preferred port is set in `config.json` (3005 by default). `PORT=3020 node system/app/launch.mjs` overrides that starting port. An occupied port is skipped, not reclaimed.

For foreground debugging only: `node system/app/server.mjs` (stop with Ctrl-C). Ordinary user handoff should use the persistent launcher. Runtime URL/PID is in `.runtime.json`, logs in `.runtime.log`; these are local ignored files. To stop the detached server, inspect that runtime record and verify the PID still belongs to this app before sending SIGTERM. A missing/stale record is not permission to stop arbitrary Node processes.

## App interface
Only `GET` and `HEAD` are accepted, plus two credential endpoints; every other method returns 405.
- `POST /api/voiceover/connect` `{apiKey}` and `POST /api/voiceover/disconnect`: require an `Origin` matching this server, `Sec-Fetch-Site: same-origin` when sent, `Content-Type: application/json` and a body ≤ 4 KB. Connect validates the key with free ElevenLabs lookups before saving it to the Keychain. Responses are the connection status only; the key is never returned, logged or written to a file.
- `GET /api/health`: app identity and canonical root; used by launcher.
- `GET /api/state`: projects folder status, asset-library summary (from `system/assets/library.mjs` status), drop folder (`workspace/drop-videos-here/`) contents, whether it exists and its "moved to" notes, finished videos (`workspace/finished-videos/`), projects with drafts, `source/` files and whether `source/` exists, recorded approval, assets, document paths and the ElevenLabs status (connected, account, checks, preferred voice; never the key). Reads the filesystem on each request.
- `GET /api/tools`: bounded detection of Node/FFmpeg/Whisper, not setup certification. It never installs tools.
- `GET /api/document?path=...`: plain Markdown; no raw HTML execution.
- `GET /inter.ttf`: the repo's licensed Inter font (OFL) for the UI; system fonts are the fallback.
- `GET/HEAD /media?path=...`: allowed workspace image/audio/video formats; range requests for seeking; no transcoding.

An approval is shown when a project's `feedback.md` contains a block starting with `## Approved version` followed by `Draft: drafts/<file>` for a draft that exists (the AI app writes this; see root `AGENTS.md`).

Server binds only to 127.0.0.1; no CORS, strict Host/Origin checks and CSP. Rejects traversal, hidden paths and symlink escapes. Factor choices and prompt fields exist only in the browser; copy them into the AI app.

Browser support depends on source codecs; Safari/QuickTime may be needed for HEVC/HDR. The app streams unchanged files rather than converting color silently. Only files inside `workspace/` are served.

## Interface
Sidebar with three pages: **Videos** (default: folder rows, project grid with real counts and dates), **Workspace** (player with bounded height for portrait video, real metadata read from the file, numbered drafts, copyable approval and feedback for the AI app, collapsible footage and documents) and **Setup & preferences** (status that only reports what was checked, the ElevenLabs connect panel, collapsible preferences, environment, asset library and the advanced factor explorer). Markdown is rendered by a small DOM-only renderer in `app.js` (no raw HTML); each document can also be viewed raw. Design tokens live at the top of `styles.css`.

## Development
- `npm --prefix system/app test`: isolated Node tests, temporary fixture workspaces; no actual video pipeline or user documents changed.
- `node --check system/app/server.mjs` and `node --check system/app/public/app.js`: syntax checks.
- `npm --prefix system/app run smoke`: optional real-Chrome UI checks using temporary fixtures. Requires installed Chrome on macOS (or `CHROME` pointing to a compatible browser).
- UI: `public/index.html`, `public/styles.css`, `public/app.js`; no build step.
- Server: `server.mjs`; launcher: `launch.mjs`.

No third-party example catalog or remote preview dependencies. Illustrative factor diagrams are original CSS/UI, not video renders or generated imagery added to footage. Clean ZIP packaging and other operating systems are not part of this MVP.
