# Editorial recipes — decide by meaning, not by an effect quota

Use these when actual visual information supports the spoken narrative; a normal hard cut is still often the best edit. Never generate fake screenshots, fake people, fake software demos or pseudo-proof.

| Pattern | Trigger in the explanation | Media required | Entry | Hold / exit | Optional audio |
|---|---|---|---|---|---|
| Floating proof | "Here is the result" or cites a real document | Actual screenshot/document | `proofIn` 0.40–0.52s | Stay readable ≥ 1.3s, `proofOut` 0.20–0.32s | Soft swish ONLY if movement is prominent |
| Picture-in-picture | Speaker is explaining a real on-screen action | Screen recording + real camera footage | `pipIn` 0.40–0.55s | Keep screen text legible, hard cut out or controlled exit | Usually none |
| Focus / click | Specific UI control is named | Actual captured UI | `focusIn` 0.18–0.26s | Dim 30–45%; release `focusOut` | Quiet click if audible/UI action |
| Match expand | Thumbnail becomes the *same* full-screen screenshot | Same underlying real media | `matchExpand` 0.48–0.65s | End with full-screen proof; no other animation | Light swish near transition midpoint |
| Step reveal | Explaining ordered instructions | Real task steps in approved words | `stepsIn` .35–.55s stagger | 2–4 steps visible; don't cover footage | Usually none |
| Comparison | Genuine side-by-side before/after or options | Both real images or screenshots | `comparisonReveal` .55–.75s | Explicit labels; don't imply altered benchmark | Usually none |
| Wipe / split | Switch between two related authentic visuals | Two real shots/screens | `wipeIn` 0.3–0.45s | Use infrequently; hard cuts otherwise | Soft swish when justified |
| Arrow annotation | Viewer needs to locate something difficult | Real captured UI | `drawLine` .25–.4s | Arrow not over text/person | None |

## Timing choreography

An effect alone does not make an edit feel professional. A typical *proof reveal* is:

- **T-0.3s**: finish the preceding spoken phrase; don't begin the new visual too early.
- **T+0.0s**: speaker names the thing → screenshot starts entering (optional, approved swish).
- **T+0.25s**: screenshot settles; subtitle remains below or moves to a legible safe area.
- **T+0.3–2.1s**: viewer has time to read; subtle annotation only if it helps.
- **T+2.1s**: exit visual on sentence boundary; don't introduce a random transition to prove animation sophistication.

A typical *screen demo* is:

- Cut to real screen footage at the moment the speaker says "I'll show you".
- Enter genuine camera inset only if facial context adds value.
- Brief focus ring or annotation on the exact action; optional quiet click at the actual click frame.
- Return to speaker using a cut or a justified match expansion, not a gratuitous wipe.

## Guardrails for an editing agent

1. **Narrative:** Select the clip or frame that proves the claim. If it does not exist, use speaker footage or ask the owner for a recording—never synthesize evidence.
2. **Readability:** Preserve mobile-safe captions, size, contrast and dwell time. Do not cover important UI text or the speaker's face.
3. **Visual system:** Use one typography system, muted accent if approved, consistent insets, restrained shadows. No pre-approved accent colour is presumed.
4. **Motion:** Seek-safe GSAP timelines only. Every visual has a start, purpose and exit. Test arbitrary timeline seeks (not just sequential playback).
5. **Sound:** Sound remains optional, not a reaction to every overlay. Use only licensed or original sounds with owner approval and measure visual/audio onset.
6. **Source fidelity:** Never color grade or alter original source footage without approval; comparison panels must be truthful.
7. **Render QC:** Check the first frame, entry/exit frames, arbitrary seeks, full playback, text cropping, mobile safe areas, and absence of sound clipping.

## Relative spacing and motion defaults (suggestions, not owner-approved global preferences)

For a 1080×1920 vertical frame, start with 72px horizontal safe margins, 100px top content inset, no critical text in platform UI zones, cards around 16–24px radius, and subtle soft-edged shadows. Scale all geometry with composition dimensions. Use these solely as demonstration defaults until reviewed.

Motion easing: `power3.out` for entrances, `power2.inOut` for wipes/match expansion, `power2.in` for exits. Avoid spring/bounce by default. Limit simultaneous focal animations to one primary action plus one supportive detail.
