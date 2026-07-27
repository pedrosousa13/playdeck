# The container query owns the layout switch (#114)

**Issue:** #114 (parent #1). Filed from the baseline `e2e/__screenshots__/reference-narrow.png` that #113 added, which pinned a state nobody had looked at directly.

## Goal

At a **320 px container inside a wide viewport** — an embed in a narrow column, the case `container-type: inline-size` was added for in #111 — the reference composition is not usable:

- the player box is `320×180`, and the control row occupies **153 px** of it, leaving a sliver of poster
- the button row wraps to two lines
- the caption cue **overlaps** the bottom button row

Nothing here is a regression. The appearance predates #113; only the pin is new. #114 asks whether the container query should own the layout switch that the viewport media query owns alone today.

Answer: **yes, and the media query goes away entirely.**

## 1. Why the literal ask is not expressible, and what that changes

#114 proposes moving `aspect-ratio: auto` and `position: relative` from `@media (max-width: 420px)` into `@container (max-width: 420px)`. Probed before designing against it — Chromium, `page.setContent`, three cases at a 320 px page width:

| Case                                          | `aspect-ratio` resolved      | Height |
| --------------------------------------------- | ---------------------------- | ------ |
| Container tries to restyle **itself**         | `16 / 9` — rule ignored      | 180    |
| Wrapper is the container, box is a descendant | `auto` — rule applied        | 18     |
| Descendant restyled from a self-container     | `position: relative` applied | —      |

**An element is never matched by its own container query.** `.reely-example` _is_ the container, so `aspect-ratio: auto` and its `:has()` variant cannot move as written. `.reely-example-controls { position: relative }` is a descendant and _could_ move alone — and moving it alone is precisely what #111 forbids, because the row would go in flow inside a box still locked to 16 / 9, which is the 35 px of clipped controls #32 measured.

So the split is not a preference to revisit; it is enforced by the DOM. Changing it requires a **container element that is not the box being restyled**. That is the whole design.

## 2. The wrapper

`Player.Viewport` stays the box. A plain consumer `<div>` wraps it and owns the containment:

```
.reely-example-frame   width: 100%; max-width: 48rem; container-type: inline-size
  .reely-example       width: 100%; position: relative; aspect-ratio: 16/9; overflow: hidden
```

`.reely-example` gives up `container-type` and `max-width`; it keeps everything else. `[data-reely-part="viewport"]` still resolves to the same element, so no existing locator moves.

`max-width` moves **to the wrapper** rather than staying on the box. If the box kept it, the container would measure the wrapper's full width while the player was capped at 48 rem, and above 768 px the query would be asking about the page again — the exact confusion this change removes. On the wrapper, container width and player width are the same number at every viewport.

The wrapper is consumer DOM. It does not become a primitive, and nothing in `packages/` changes.

## 3. The rules move, and the media query is deleted

All three rules move verbatim into the existing `@container (max-width: 420px)` block, joining `.reely-example-volume { display: none }`. `@media (max-width: 420px)` is removed, not kept as a fallback. The container is now the same width as the player, and the player is the thing the breakpoint is about; a viewport query alongside it can only agree with the container query or contradict it, and contradicting it is the bug being fixed.

The pair `#111` insisted on stays a pair. It is now driven by **one** query instead of two, which is the opposite of the disagreement that spec warned about.

Complete behavioural delta:

| Case                                  | Today                            | After                                                       |
| ------------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| 320 px viewport (player also ~320 px) | media fires, in-flow row         | container fires — **identical**                             |
| Wide viewport, player at 768 px       | neither fires, overlay row       | **identical**                                               |
| Wide viewport, 320 px container       | container fires alone → crowding | in-flow row, box taller than 180 px, caption clears the row |

The new height is **not asserted here as a number** — it depends on whether `Player.Media` and `Player.Poster` contribute in-flow height, which is a property of the primitives rather than of this stylesheet. The plan measures it on the viewport path first (where the same rules already apply today) and carries it as a measured fact; the test asserts the relation, not the constant.

Only the third row changes. Two of the three cases are already covered by tests that must stay green **unchanged** — that is the regression argument for this change.

## 4. What was decided against

**Keep 16 / 9 and shed controls.** The host reserved a 16 / 9 box, so honour it: hide lower-priority controls at a narrow container until the row fits one line inside 180 px. No wrapper, no structural change, and it matches #111's stated split verbatim.

Rejected because the volume slider is _redundant_ — the mute button survives it — while PiP and AirPlay are unique functionality. Hiding them is a loss of function, not a reflow. The honest version folds them into the settings menu first, which is a larger change than the wrapper, not a smaller one.

## 5. Risks, and what falsifies each

- **The stacking context moves.** `.reely-example` is `position: relative; z-index: auto`, so today it is `container-type`'s containment that makes it a stacking context. On the wrapper, it stops being one. Internal ordering should be unaffected — same relative z-indexes inside the same context — and the containing block for the absolutely-positioned row, poster and gesture layer stays `.reely-example` via `position: relative`. **Check:** `e2e/visual.spec.ts`'s ten layering invariants, unchanged. If any fail, the containment is the suspect; report it rather than working around it.
- **The `:has()` collapse guard must fire on the container path too.** In the states where #89 hides the control row (pre-activation, and while an error surface owns the viewport) the box has no in-flow content, and without the guard it collapses to zero height and takes the full-bleed overlay with it — measured in #111 as an activation button that could not be clicked. **Check:** the idle and error narrow-container cases.
- **#32's reflow cases.** 320 px at 200 % text, and 320 px-equivalent width. The replacement query is px-based exactly like the one it replaces, so these should be untouched. **Check:** `e2e/a11y.spec.ts`'s three reflow cases, green and unchanged.
- **#111's own container-query test** — the volume slider hides on the player's width with the viewport held at 1280 px — must stay green with no edit. It is the test that proves the container mechanism still works after the container moved elements.

## 6. Tests

- `e2e/reference.spec.ts` — its two responsive tests **stay green and stay distinct**. #114 says explicitly that a fix must not collapse them into the same assertion: one covers the viewport path, one the container path. The container-path test gains the assertion that the row is now in flow — the player is taller than `320 × 9 / 16` at a 320 px container.
- `e2e/visual.spec.ts` — "a 320px container keeps every layer inside the player" stays green. A new case asserts the caption cue does not overlap the control row at a narrow container: that is the defect #114 names and nothing currently asserts it. It fails against today's CSS.
- `e2e/__screenshots__/reference-narrow.png` — regenerated with `gh workflow run visual-baselines.yml` and downloaded from the artifact, **never by hand** (root README, Development). The other four baselines must come back byte-identical; if any of them moves, this change reached further than its own case and that is a finding.

## 7. Docs

`Reference.mdx` currently teaches the old split, and gives "an element cannot query its own container" as its reason. The fact is right and the conclusion no longer follows once a wrapper exists — the paragraph is rewritten to describe one container-driven breakpoint. Its floor paragraph stands unchanged: `@container` is still Chrome 105 / Firefox 110 / Safari 16, still above the packages' declared floor, and this is still a workbench composition that ships no CSS.

The `#111` spec's §3 and its plan's "do not simplify the split" note are historical records of a decision made with correct reasoning and one missing option. They are left untouched; this spec supersedes them, and says so here so a reader who finds them first is not misled.

## Out of scope

- `Theme/Theme`'s pre-existing 5 px control-row overflow at its own width, recorded in a comment in `reference-player.tsx`. Older, cosmetic, and inside the area #32 reviews.
- Anything in `packages/`. The primitives ship no CSS; the declared browser support floor does not move.
- Folding PiP and AirPlay into the settings menu at narrow widths. That is preset behaviour (#9), out of the MVP.

## Verification

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:storybook && pnpm docs:check && pnpm test:e2e
```

Run unpiped — a pipe swallows the exit code.
