# Editorial Motion Toolkit (optional add-on)

A small collection of **seek-safe, editable visual choreography** for the existing HyperFrames + GSAP project. Inspired by reference edits with floating authentic screenshots, picture-in-picture, clean cutaways, focus callouts and timed sound—not by stock-graphic templates.

This is **not** a second video workflow, style guide, animation engine or app. It extends `system/assets/hf/motion.js` with higher-level scene vocabulary. The existing `AGENTS.md`, approval rules, `workspace/assets/asset-index.md`, license policy, ElevenLabs tool and local companion stay authoritative.

## Contents

- `editorial.js` — `window.HFEditorial`, 10 reusable GSAP functions.
- `demo/index.html` — six mobile-portrait **schematic** example layouts, with HTML/CSS artwork and no actual/generated footage. Open in a browser with `?scene=proof`, `?scene=pip`, `?scene=focus`, `?scene=steps`, `?scene=compare`, or `?scene=cutaway`.
- `overlays/*.svg` — original transparent vector annotation shapes (not baked captions).
- `sounds/*.wav` — three original, quiet optional accents. Do **not** place into edits automatically; owner approval required.
- `previews/` — illustrative reference images. These are NOT publishable source footage. Do not treat sample UI as an actual screen capture.
- `RECIPES.md` — how to choose and choreograph components, using real media.
- `CODEX-INTEGRATION.md` — task to attach to the current folder, without redesigning it.

## Install

Installed in this repo on 2026-10-10 and registered in the asset library (`system/assets/catalog.json`): the patterns are searchable (`node system/assets/library.mjs search proof`), the overlays and sound cues install with `setup`. Only compositions that use a pattern load `editorial.js`.

Add a pattern to a composition with the library, which copies `editorial.js` into `<project>/assets/library/` and prints the HTML and timeline calls:

```sh
node system/assets/library.mjs use editorial-proof --project <composition dir> --at 2.1
```

Load it **after** GSAP. Put the real media in a timed clip and animate a **child** of that clip: HyperFrames owns a clip's visibility, and these fades write visibility. `editorial.js` throws a clear error if it is given a clip (`hyperframes check` does not lint external scripts). Register the timeline the standard way so `hyperframes check` finds it:

```html
<script src="assets/library/gsap.min.js"></script>
<script src="assets/library/editorial.js"></script>
<div id="proof-host" class="clip" data-start="2" data-duration="3.2" data-track-index="3">
  <div id="real-screenshot"><img src="assets/real-screenshot.png" alt=""></div>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  HFEditorial.proofIn(tl, '#real-screenshot', 2.10, { direction: 'bottom' });
  HFEditorial.proofOut(tl, '#real-screenshot', 4.80);
  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;
</script>
```

**Important**: HyperFrames clips must have correct `data-start` / `data-duration` metadata; place visual media on real clips, preserve provenance and permissions. The example shows motion only—not a license to publish dummy content.

## Checks

```sh
node --test system/assets/editorial/test/
```

Sound cues do not automatically play. Add approved ones with `library.mjs use sfx-editorial-<name>` (it sets the cue's default volume and starts it early by its measured lead-in), as normal HyperFrames audio clips with measured lead-in, consistent with `system/assets/README.md`. Use speech/music ducking where necessary. Prefer silence over an unsuitable cue.
