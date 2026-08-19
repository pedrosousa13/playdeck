# The control row fits the player it is in (#114)

**Issue:** #114 (parent #1). Filed from the baseline `e2e/__screenshots__/reference-narrow.png` that #113 added, which pinned a state nobody had looked at directly.

**Supersedes** the first version of this spec (`512233d`), which proposed moving the layout switch onto the container query and stopped there. That design was falsified by measurement before any of it was implemented; §2 records how, because the failure is more useful than the proposal was.

## Goal

At a **320 px container inside a wide viewport** — an embed in a narrow column, the case `container-type: inline-size` was added for in #111 — the reference composition is not usable. #114 records three symptoms: the control row occupies 153 px of a 320×180 player, the button row wraps to two lines, and the caption cue overlaps the buttons.

Make a 320 px embed usable: video area intact, every control reachable, nothing clipped at 200 % text.

## 1. What the measurement actually found

Probed against the running Storybook before designing, `reference-player--composition`, Chromium:

| Fact                                         | 320 px **viewport** (today)          | 320 px **container** (today)          |
| -------------------------------------------- | ------------------------------------ | ------------------------------------- |
| `.playdeck-example` box                      | **288 × 153**                        | 320 × 180                             |
| computed `aspect-ratio`                      | `auto`                               | `16 / 9`                              |
| `[data-playdeck-part="controls"]` `position` | `relative`                           | `absolute`                            |
| control row height                           | 153                                  | 153                                   |
| button row height                            | 92 — two lines                       | 92 — two lines                        |
| caption cue vs button row                    | 125–150 inside 73–165 — **overlaps** | 152–177 inside 100–192 — **overlaps** |

**That table is measured on `reference-player--composition`, which is mock-decorated and renders no `<video>` element at all.** An earlier draft of this spec read the 288 × 153 box as "the viewport path has no video area" and concluded that #114's root-cause section was wrong. It is not. `Player.Media` is `position: relative` — in flow — and the mock simply has no media element to contribute height. The same four cases on `reference-player--real-sources`, which renders a real `<video>`:

| Case             | Before                                                | After                         |
| ---------------- | ----------------------------------------------------- | ----------------------------- |
| 320 px viewport  | 336 = media 180 + row 153, stacked                    | 315 = media 162 + row 153     |
| 320 px container | **180, with the row absolutely overlaying 153 of it** | **303 = media 150 + row 153** |

So the viewport path was already correct, exactly as #114 says, and the container path is the defect: the box stays locked to 16:9 while the row covers 153 of its 180 px and the media element underneath is only 150 px tall.

Two things from the mock table still hold, and both are real:

**Two of #114's three symptoms are not container-path defects.** The button row wraps to two lines on both paths, and the caption cue overlaps the button row on both paths.

**The row is 153 px on both paths.** No choice of query changes that; it is the row's own arithmetic (§3). On the real path the stacked layout absorbs it, which is why the container path is where it hurts.

## 2. Why the first design failed, and the constraint that killed it

The first design proposed making the container path match the viewport path, on the strength of #114's claim that the viewport path was correct. It would have traded a sliver of poster for none.

Its other finding stands and still shapes this one. Probed separately: **an element is never matched by its own container query.** `.playdeck-example` carries `container-type`, so `@container` rules cannot restyle it; only descendants. Any design that restyles the box from a container query needs a wrapper element that is the container. That wrapper survives into this design, because `cqw` units resolve against an ancestor container too.

## 3. The row is the constraint, and it is arithmetic

Measured at a 320 px container: row content width 312 px, `gap: 4px`, every control a **44 × 44** target (WCAG 2.2 AA, and not negotiable).

```
capacity:  n × 44 + (n − 1) × 4 ≤ 312   →   n ≤ 6.58   →   6 per line
present:   play mute captions cc-menu settings pip | airplay fullscreen  = 8
           (volume slider already hidden at this width and still 8)
```

Six fit; two wrap. That is the 92 px button row, and:

```
control row = 8 (padding) + 49 (time row) + 4 (gap) + 92 (buttons) = 153
```

So the fix is to remove two controls from the row without removing the functionality, and to stop the box from collapsing when the row goes in flow.

## 4. The design

### 4.1 Fold two controls into the settings menu

`PipButton` and `AirPlayButton` leave the row at a narrow container. They are unique functionality — unlike the volume slider, which is redundant with the mute button and is already dropped here — so they move rather than vanish, as `Player.MenuItem` entries in the existing settings menu.

`MenuItem` is a public export (`packages/react/src/index.tsx:2490`) and closes the menu on select, so this stays composed only from public parts, which is the reference example's entire purpose.

Both forms render, and the container query hides whichever does not apply:

```css
@container (max-width: 420px) {
  .playdeck-example-fold {
    display: none;
  } /* the two buttons */
}
@container (min-width: 421px) {
  .playdeck-example-menu-fold {
    display: none;
  } /* the two menu items */
}
```

No JS, no `ResizeObserver`, and `display: none` removes the inactive form from the accessibility tree, so neither width exposes a duplicate affordance.

Two consequences for `ExampleSettingsMenu`:

- It gates itself on capabilities and returns `null` when neither playback rate nor quality is available. It must also render when only the folded items are available, or the folded functionality disappears exactly where it is needed.
- `PipButton` and `AirPlayButton` self-gate on `capabilities.pictureInPicture.status` and `capabilities.airPlay.status`. `MenuItem` does not gate itself, so the menu entries must read those capabilities explicitly. Actions are `requestPictureInPicture()` / `exitPictureInPicture()` and `showAirPlayPicker()` on `usePlayerActions()`.

Result: 6 buttons, one line, control row **105 px** instead of 153. On the real path that is 48 px off the stacked box (303 → 255) and 48 px more video for the same footprint; on a composition with no media element, where the 180 px floor sets the height, it is the difference between the row covering 85 % of the box and 58 %.

### 4.2 `min-height`, not `aspect-ratio: auto`

`aspect-ratio: auto` is what lets the box grow around the in-flow media and row, and it cannot simply be dropped: at 320 px with 200 % text the row roughly doubles, and an overlay row inside a 180 px `overflow: hidden` box is clipped. That is the 35 px #32 measured. But `auto` alone leaves nothing holding the box open in the states where there is no in-flow content — pre-activation and error, where #89 hides the row, and any composition without a media element. The `:has()` guard existed for exactly that. A floor replaces it:

```css
@container (max-width: 420px) {
  .playdeck-example {
    aspect-ratio: auto;
    min-height: 56.25cqw; /* 9/16 of the container — 180px at 320px */
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .playdeck-example-controls {
    position: relative;
  }
}
```

`Media` and the control row both take part in flow, so the box becomes the sum of them — measured 303 px at a 320 px container, against a 180 px lid before. `Poster`, `Gestures`, `LoadingIndicator` and `Captions` are absolutely positioned and stretch to whatever the box resolves to.

`min-height: 56.25cqw` is the floor for the states with **no** in-flow content: pre-activation and error, where #89 hides the row, and any composition with no media element (the mock-decorated stories are exactly that — measured 180 px there, held open by this rule alone). Without it those states collapse to zero height and take the full-bleed overlay with them, which #111 measured as an activation button that could not be clicked.

`justify-content: flex-end` keeps the row at the bottom when the floor is what sets the height, rather than at the top of the trailing free space.

The `:has(.playdeck-example-controls[hidden])` collapse guard is therefore **deleted**: `min-height` covers the same states, and covers them without depending on which children happen to be in flow.

### 4.3 The media query is deleted

With the box no longer collapsing, both paths want identical treatment, and the container query owns all of it. `@media (max-width: 420px)` goes away entirely. That is #114's literal ask, reached from the other direction.

## 5. Risks, and what falsifies each

- **The stacking context moves to the wrapper.** `.playdeck-example` is `position: relative; z-index: auto`, so today it is `container-type`'s containment that makes it a stacking context. Internal ordering should be unaffected and the containing block for the absolutely-positioned overlays stays `.playdeck-example` via `position: relative`. **Check:** `e2e/visual.spec.ts`'s ten layering invariants, unchanged. If any fail, the containment is the suspect — report it rather than working around it.
- **`display: flex` on the player is new.** Every overlay in it is absolutely positioned and so is out of flow, but the control row is not, and `Captions` is not. **Check:** the same layering invariants, plus the caption cue's box.
- **The collapse guard is gone.** If `min-height` does not hold the box open in the idle and error states, the activation button becomes unclickable — the exact #111 failure. **Check:** `the idle and error states hand the whole player to their overlay`, and the activation-overlay test, at a narrow container as well as wide.
- **#32's reflow cases.** 320 px at 200 % text is the case the `min-height` growth exists for. **Check:** `e2e/a11y.spec.ts`'s three reflow cases, green and unchanged.
- **The folded menu items are new interactive surface.** **Check:** axe over the primitive stories and the composed example with the menu open, and the keyboard flow that opens the menu and returns focus on Escape.
- **`cqw` and `@container` are Chrome 105 / Firefox 110 / Safari 16** — above the packages' declared floor (Chrome 99 / Firefox 97 / Safari 15.4). Unchanged from #111: this is a workbench composition, never published, and the primitives ship no CSS. `Reference.mdx` says so and continues to.

## 6. Tests

- `e2e/reference.spec.ts` — the two existing responsive tests **stay green and stay distinct**; #114 says a fix must not collapse the viewport path and the container path into one assertion. A new test asserts the container path's single-line row: the button row's height equals one 44 px target, and the player is 320 × 180 with the row in flow.
- PiP and AirPlay reachability at a narrow container — the point of folding rather than hiding. Asserted through the menu, not through the buttons.
- `e2e/visual.spec.ts` — the ten layering invariants unchanged; the narrow-container case gains the in-flow assertion.
- `e2e/__screenshots__/reference-narrow.png` regenerated with `gh workflow run visual-baselines.yml`, **never by hand**. `reference-menu-open.png` will also move, because the menu gains items at wide only if the fold items are visible there — they are not, so it must **not** move. If it does, the `min-width: 421px` rule is wrong.
- The other four baselines must come back byte-identical. Any other movement means the change reached past its own case.

## 7. Docs

`Reference.mdx` currently teaches the old split and cites "an element cannot query its own container" as the reason the box's rules stay on a media query. The fact is right; the conclusion no longer follows once a wrapper exists. Rewritten to describe one container-driven breakpoint, the fold, and the `min-height` mechanism.

The `#111` spec's §3 and its plan's "do not simplify the split" note are historical records of a decision made with correct reasoning and one missing option. They are left untouched; this spec supersedes them and says so here.

**#114 itself needs correcting.** Its root-cause section states that the viewport path is the good outcome. It is not, and the measurement in §1 belongs on the issue so the next reader does not re-derive a wrong premise.

## Out of scope

- **Dropping the two `Time` labels at a narrow container.** It is the obvious next lever on the remaining 105 px — the time row is 49 of it — and it is not measured, so it is not promised.
- `Theme/Theme`'s pre-existing 5 px control-row overflow at its own width. Older, cosmetic, inside the area #32 reviews.
- The caption cue overlapping the button row. It happens on **both** paths, at every width, and `e2e/visual.spec.ts:129-135` records that cue-over-row overlap is deliberate — the cue wins on paint order. #114's third symptom is therefore not fixed here, and the issue gets a comment saying so rather than a silent omission.
- Anything in `packages/`. The primitives ship no CSS and the declared browser support floor does not move.
- The `DefaultPlayer` preset's own narrow layout (#9). Out of the MVP.

## Verification

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:storybook && pnpm docs:check && pnpm test:e2e
```

Run unpiped — a pipe swallows the exit code.
