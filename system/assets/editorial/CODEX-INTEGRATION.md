# Codex integration task — paste into existing project chat

> **Status: done on 2026-10-10.** The toolkit is integrated (see `system/assets/README.md` and `workspace/assets/asset-index.md`). Do not repeat this task; it is kept for reference.

I added `system/assets/editorial/`, a **drop-in add-on**, to our existing video-editing repository. **Do not rebuild the app, reset the editing guide, replace the existing asset library, or create a parallel editing pipeline.**

1. Read our root `AGENTS.md`, `system/editing-brain.md`, `system/assets/README.md`, the editing guide and asset index. Then inspect `system/assets/editorial/README.md`, `RECIPES.md`, `editorial.js`, `demo/` and `test/`.
2. Run `node --test system/assets/editorial/test/editorial.test.mjs`. If the installed HyperFrames or GSAP integration differs from the assumptions here, adapt the *integration*, not the user's established workflow.
3. Register/discover these choreography functions alongside the existing `HFMotion` presets in a minimally invasive way. Ensure compositions import only the assets they actually use. Use absolute times and seek-safe timelines.
4. Make a short test composition on **dummy schematics**, not a user video, exercising floating proof, PiP, focus, comparison and one sound cue. Render or preview and check different seek positions. Do not treat these schematic images as publishable media.
5. For a real edit, choose effects because they clarify a spoken point. Use authentic source media only; never invent footage/screenshots. Cut hard by default when a transition adds no explanatory value.
6. Do not turn the optional original sound cues into automatic defaults: show a voice-only vs subtle-SFX comparison and ask for approval. Respect the separate soundtrack authorization and all existing asset permission rules.
7. Show me a **10–15 second opening draft** with the new toolkit, and explicitly report which effects were used and why. Save video-specific decisions to feedback, not universal defaults unless I approve them.

Target style: authentic, contemporary, professional educational reels with polished multi-layer compositing, restrained type and synchronized sound. The reference demonstrates editorial sophistication; it does not authorize copying someone else's assets or creating fake demonstrations.
