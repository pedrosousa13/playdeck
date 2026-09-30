---
'@playdeck/react': patch
---

Lift the caption cue clear of the control row instead of letting it paint over it

`Player.Captions`' cue box carries an opaque default background and shares the
control row's own `z-index`, composing after it, so it always won the paint
tie. Centred in the middle of the row, that box could land on top of live
controls — measured on the reference composition under either shipped theme,
where it covered the captions button and the captions menu's own trigger.

While the control row is actually painted, the cue overlay now measures the
row's own current rect and applies a `transform: translateY(...)` that clears
its top edge by 8px, so the cue's box can never overlap a control regardless
of what background it paints. "Painted" is read off the row itself — its
computed `opacity` and `visibility` — rather than inferred from `Viewport`'s
`data-idle` attribute: `docked.css` never reads that attribute at all, so its
bar never fades, and a fix that treated idle as hidden un-lifted the cue onto
a docked bar that was still fully visible. Reading the row's own computed
style instead gives the right answer under all three cases this package
ships — always shown for `docked.css` and for an unthemed row, and exactly
`theme.css`'s own fade (`:focus-within` override included) for the themed
row — with no per-theme branching in the fix itself.

The measurement is live: a `ResizeObserver` on the row (so it holds under any
control-row height — either shipped theme, the phone media query, or an
unthemed composition with no stylesheet at all), a `MutationObserver` on
`Viewport`'s own `data-idle` attribute and on `transitionrun`/`transitionend`
for the row's own opacity transition, and a further `MutationObserver` on the
viewport's child list so a control row that mounts after `Captions`, or is
unmounted and remounted later, is picked up without a remount of `Captions`
itself. Once the row is no longer painted, the transform clears and the cue
returns to the resting position `--playdeck-caption-*`'s own `paddingBottom`
formula already draws. The move transitions (150ms, matching the rest of the
library's default), collapsed to near-zero under
`prefers-reduced-motion: reduce`.

No new theming surface: the 8px clearance and the transition timing are
internal constants, the same "no prop" call `viewport-media.tsx`'s own idle
delay already makes, not new `--playdeck-*` tokens.

`e2e/visual.spec.ts`'s "the caption cue paints above the control row" stays
green — the paint-order tie it asserts is now moot in the reference
composition's own layout (the cue no longer reaches the row at all there),
but the same tie still matters for a `renderCue` consumer whose own box is
taller than the clearance, so the assertion and the composition order it
depends on are both kept. Some of that file's Chromium screenshot baselines
move because the cue itself moves — `reference-composition.png`,
`reference-menu-open.png` and `reference-narrow.png` are expected to;
`reference-idle.png` and `reference-error.png` are not, since captions are
hidden in both states. Not regenerated here; CI's `visual` job produces the
actuals to review.

This is not reachable from any of the four scenarios
`scripts/compare-libraries.mjs` measures — none of them render
`Player.Captions`, and `Player.Controls`' only static reference into
`captions.tsx` is the standalone `resolveCaptionToggle`, which tree-shakes
independently of the rest of the module, so `docs/comparison/results.md` is
unchanged. It does move `@playdeck/react`'s own published bundle, measured by
`pnpm test:budgets` and `README.md`'s byte table (the whole package, not a
tree-shaken scenario): the primitives figure moves from 20.4 KB to 21.02 KB
gzipped, about 0.6 KB, for the `ResizeObserver`/`MutationObserver` wiring and
the lift arithmetic. `@playdeck/react`'s reporting-only budget line was
already over its reference figure before this change; it stays reporting-only
and this adds to that gap rather than opening it.
