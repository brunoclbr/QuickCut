# Asset library

Reusable icons, Lottie animations, sound effects and motion presets for HyperFrames compositions. Everything renders offline once installed.

## Where things are
- `catalog.json`: sources with verified licences, curated entries (id, tags, description, usage, path) and the manual-download wish lists. Committed.
- `workspace/assets/library-local.json`: entries for manually imported packs and files (created by setup/import). Committed metadata only.
- Installed files (git-ignored, local only): `workspace/assets/icons/phosphor/`, `animations/lottie/`, `illustrations/`, `sounds/<source>/`; players in `system/assets/vendor/`.
- `editorial/`: the **Editorial Motion Toolkit**, which has priority for supporting visuals, callouts, transitions and sound cues. `editorial.js` (`HFEditorial`: proofIn/proofOut, pipIn, focusIn/focusOut, matchExpand, stepsIn, comparisonReveal, wipeIn, drawLine), `RECIPES.md` (when to use each, timings, guardrails), original overlays and sound cues (installed by `setup` to `workspace/assets/illustrations/editorial/` and `sounds/editorial/`), a schematic `demo/` and `previews/` (not footage). Its patterns are catalogued in `catalog.json` under `motion` (`editorial-proof`, `editorial-pip`, `editorial-focus`, …) so `search` and `use` find them.
- `hf/motion.js`: seek-safe GSAP presets (`HFMotion.popIn/popOut/fadeIn/fadeOut/slideIn/slideOut/scaleIn/rotateIn/pulse/shake/highlight`, playful-only `bounceIn/elasticIn`). Each returns its end time.
- `hf/captions.js`: `HFCaptions.mount(tl, "#captions", words, options)`, phrase captions with the spoken word highlighted (text colour by default, or a box), driven by real word timings (e.g. from `system/voiceover`). Restyle with CSS variables on the container (`--hfc-active` for the highlight colour, `--hfc-scrim` for a soft fade on bright footage), not by regenerating audio.
- `example/`: a working composition (icon entrance + Lottie + synced sounds). Rebuild its assets with the `use` line in its `index.html`.

## Commands (repo root)
```sh
node system/assets/library.mjs setup          # one-time install / repair; safe to rerun
node system/assets/library.mjs status         # what is installed, what needs a manual download
node system/assets/library.mjs search idea money --installed
node system/assets/library.mjs search screenshot proof --category motion   # toolkit patterns
node system/assets/library.mjs show sfx-pop
node system/assets/library.mjs use icon-lightbulb original-success-check sfx-pop --project <composition dir> --at 2.4
node system/assets/library.mjs import ~/Downloads/x.json --source lottiefiles --url <page> --creator <name> --tags bell,notification
node system/assets/library.mjs validate       # ids, paths, formats, checksums
node --test system/assets/test/ system/assets/editorial/test/   # tool and toolkit tests (temporary fixtures, no network)
```
`setup` downloads only from npm (lottie-web, GSAP, Phosphor), copies the Pixabay sounds bundled with the HyperFrames media-use skill, and imports manual packs it finds in `~/Downloads` (`--from <dir>` to change). Already-installed sources are skipped; missing or changed files are reinstalled. `update` re-downloads automatic sources on purpose. Rendering never needs the network.

## Using assets in a composition
`use` copies only the chosen files into `<project>/assets/library/`, plus `motion.js`, the Lottie player and GSAP if the project lacks it, and prints paste-ready HTML:
- **Icons** (`icon-<name>`, `icon-<name>@bold|fill|duotone`, or any Phosphor icon as `phosphor:regular/<name>`): pasted inline so CSS `color` sets the colour. Animate the inner `<svg>`, never the timed wrapper's size.
- **Lottie**: wrapped in a host with `data-composition-id` and `data-no-timeline`. HyperFrames starts the animation at the host's `data-start`, and seeking to any time shows the right frame. Set `loop: false` for one-shots.
- **Editorial patterns** (`editorial-*` from `search --category motion`): copies `editorial.js` and prints a timed clip with a child to animate plus the `HFEditorial` calls. Animate the child, never the clip. Real media only.
- **Sounds**: an `<audio>` at the entry's volume (toolkit cues −15 to −18 dB, others 0.35), started early by the file's measured lead-in so the hit lands exactly on the visual beat (`show` prints `onset_seconds`).
- **Formats**: Lottie JSON, SVG, PNG, MP3, WAV. GIF, video stickers, Figma/AE files are not imported: they cannot be seeked frame-accurately or rendered.

## Licences
This repo is open source and ships only code and metadata (the catalogue, the tool, presets and the original Lottie). Every third-party file is fetched or downloaded by each user onto their own machine and stays out of git; `.gitignore` covers all install folders.

`search` and `show` print each source's terms. Phosphor and lottie-web are MIT. The Editorial Motion Toolkit's code, overlays and sound cues are originals made for it and ship with the repo. Pixabay, Mixkit, Craftwork and LottieFiles files are free to use in your own published videos, but are never committed, packaged or redistributed. Sources whose terms require permission for use with an editing application are not supported: DrawKit is excluded because its licence forbids use in template creators or applications. Never use any asset to train or fine-tune a model.
