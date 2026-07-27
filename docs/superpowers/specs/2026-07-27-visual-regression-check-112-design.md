# Visual regression check for the stories (#112)

**Issue:** #112 (parent #1). Not a release blocker — #18 does not require it.

## Goal

Nothing in this repo checks that the player still _looks_ right. The 80 Storybook interaction tests assert behaviour and ARIA state; the 163 e2e tests assert geometry _numbers_ at two specific widths; `packages/react/test/theme.test.ts` reads `theme.css` as _text_. None of them render a composition and compare it to anything.

The gap has a live example. `9f49541` added `container-type: inline-size` to `.reely-example`, which applies `contain: layout style inline-size` — a stacking context, and a containing block for absolutely-positioned descendants. Every overlay in the reference composition is absolutely positioned inside that box. All 163 e2e tests passed on three engines afterwards, and none of them could have seen a layer move.

#89 is the precedent: a control row that silently painted _below_ `Gestures`, invisible and unclickable, while every behavioural test stayed green.

## Two layers, deliberately separate

**Owner decision, 2026-07-27:** assertion-based invariants for the layering and containment facts, plus a small set of committed PNG baselines for the reference example.

### Layer 1 — invariants (all platforms, chromium project)

Assertions about what the layout must be _true of_, not what it looks like:

| Invariant        | How it is measured                                                               | The bug it catches                           |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| **Hit-test**     | `document.elementFromPoint(cx, cy)` at a part's centre resolves inside that part | #89 — a control row painted under `Gestures` |
| **Containment**  | overlay `getBoundingClientRect()` covers the player's rect                       | an overlay that stops being full-bleed       |
| **Non-collapse** | every visible part has `width > 0 && height > 0`                                 | a box collapsed by a lost `aspect-ratio`     |
| **No overflow**  | `scrollWidth <= clientWidth` on the player and the control row                   | content escaping an `overflow: hidden` box   |

**`LoadingIndicator` needs a variant of the hit-test.** It sets `pointer-events: none` by design, so `elementFromPoint` resolves _through_ it to whatever is underneath, and a naive hit-test would report it as painting below `Media` even when it paints above. The helper therefore sets `pointer-events: auto` on the candidate inside the same `page.evaluate` call, hit-tests, and restores the previous value. Pointer-events do not affect paint order, so the answer is the stacking fact; the mutation never outlives the measurement.

### Layer 2 — pixels (linux only, 5 images)

`toHaveScreenshot()` over the reference example. Five states:

| Snapshot                | Story                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `reference-idle`        | `reference-player--idle` — poster plus activation overlay     |
| `reference-composition` | `reference-player--composition` — full control row, cue shown |
| `reference-menu-open`   | `reference-player--composition`, settings menu opened         |
| `reference-narrow`      | `reference-player--composition` at a 320px container          |
| `reference-error`       | `reference-player--error-state` — error surface plus Retry    |

**These stories run under the mock decorator**, so there is no media element, no network, and no clock: `stagedState` pins `currentTime: 12` and `duration: 120`, the poster is a local SVG, and the cue text is staged. The pixels are deterministic by construction, which is why the pixel layer points at the mock stories and not at `reference-player--real-sources`. No masking, no seeking, no frame decode in the shot. `animations: 'disabled'` is still set, because a transition mid-capture is not a media problem.

## Why the pixel layer is linux-only

There is no docker on the maintainer's machine (`docker info` fails), CI is `ubuntu-latest`, and macOS and Linux render text differently. Baselines can therefore only be produced where CI runs. The five pixel tests carry `test.skip(process.platform !== 'linux', …)`, and `snapshotPathTemplate` is pinned to a single set with no platform or project suffix:

```
snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}'
```

The comparison threshold is pinned too, and not by preference. Playwright's default is `0.2`, which pixelmatch turns into `maxDelta = 35215 * threshold ** 2` = 1408.6 in YIQ space (`playwright-core/lib/coreBundle.js:6792`). Repainting the whole reference control bar from `rgb(4, 6, 10)` to `rgb(90, 6, 10)` is a delta of **1184.1** — under the default that is a pass, and the first falsification run went green against a visibly red bar. `expect.toHaveScreenshot.threshold` is therefore `0.1` (maxDelta 352.2), which fails that change with room to spare while pixelmatch's own antialiasing detection still absorbs edge noise. A font-rendering change on the runner image produces deltas far above either number, so this does not trade flakiness for sensitivity.

One baseline set, generated on linux, compared on linux. On macOS the five tests skip with the reason printed, and the invariant layer — which is the part that catches the bugs this repo has actually had — still runs.

### Refresh procedure

An un-refreshable baseline is the check somebody deletes at the first font bump, so the refresh is a command, not a paragraph:

- `.github/workflows/visual-baselines.yml`, `workflow_dispatch` only. Runs `pnpm test:e2e --project=visual --update-snapshots` on `ubuntu-latest` and uploads `e2e/__screenshots__` as an artifact.
- `gh workflow run visual-baselines.yml` → `gh run download <id>` → commit the PNGs.
- Documented in the root `README.md` testing section, next to the other gate commands.

The `visual` CI job uploads `test-results/` on failure, so the `-actual` and `-diff` PNGs are downloadable from a red run.

## Structure

One spec, `e2e/visual.spec.ts`, and one new Playwright project:

```js
{ name: 'visual', testMatch: /visual\.spec\.ts/, use: { ...devices['Desktop Chrome'] } }
```

The three engine projects gain `testIgnore: /visual\.spec\.ts/`, so `pnpm test:e2e --project=chromium|firefox|webkit` keeps its current 163 passed / 20 skipped exactly. A visual test is **+1, not +3** — the opposite of the rule that holds for every other spec in `e2e/`.

CI gets a `visual` job on `ubuntu-latest`, chromium only, alongside the existing `e2e` matrix.

### States covered by the invariant layer

Driven from Playwright against the real dev server (`playwright.config.ts` already starts `storybook dev` on `127.0.0.1:4173`), not against the built output and not through the test-runner — dev mode and the production build differ, and this repo has seen `test:storybook` green while dev mode was broken.

| Story                                         | Invariant                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reference-player--composition`               | control row and every button in it hit-test to themselves, not to `Gestures`                                                                                                                           |
| `reference-player--composition`               | poster and caption boxes sit inside the player; the cue is not under the control row                                                                                                                   |
| `reference-player--composition`               | settings menu opened from Playwright: menu inside the viewport, hit-tests above the row                                                                                                                |
| `reference-player--composition` @ 320px       | player ≤ 320, no overflow, volume slider hidden, overlays still cover the player — **#111's containing-block invariant**                                                                               |
| `reference-player--idle`                      | activation overlay covers the player and hit-tests above poster/gestures; control row absent from layout                                                                                               |
| `reference-player--error-state`               | error surface covers the player, Retry hit-tests to itself, control row absent from layout                                                                                                             |
| `player-errordisplay--not-recoverable`        | surface covers, and there is no retry affordance                                                                                                                                                       |
| `player-loadingindicator--buffering`          | overlay covers the **viewport** box and paints above it (pointer-events variant above) — #89's exact ground. There is no `media` part under the mock decorator                                         |
| `player-loadingindicator--loading-provider`   | the idle indicator occupies no visible box                                                                                                                                                             |
| `player-activationbutton--dormant`            | overlay covers the viewport and hit-tests on top                                                                                                                                                       |
| `player-activationbutton--activates-on-click` | after the click the overlay is gone and what was beneath it hit-tests to itself                                                                                                                        |
| `player-captions--one-line`                   | the cue box is non-zero and inside the player                                                                                                                                                          |
| `player-settingsmenu--open`                   | menu inside the viewport, painting above its trigger                                                                                                                                                   |
| `theme-theme--default`                        | layering holds and the row does not overflow with `theme.css` mounted. **Not** an opaque background — measured, the themed row resolves `rgba(0, 0, 0, 0)`; the theme styles the controls, not the bar |

**Stories whose own `play` function mutates state are avoided** where the test drives the interaction itself: `reference-player--settings-menu-selection` and `--settings-menu-follows-state` both click during `play`, which would race a Playwright click. The read-only stories (`Composition`, `Idle`, `Playing`, `ErrorState`) are safe to drive.

`Real playback/Providers` is out — live YouTube and Vimeo, flaky by construction, already `@real`-gated.

## Falsification

The check is worth nothing until it has been watched to fail.

- **Invariant layer, locally:** set the loading overlay's `z-index` to `0` → the paints-above assertion goes red. Remove `container-type: inline-size` from `.reely-example` → the 320px containment/volume-slider assertions go red. Both reverted, both outputs recorded in the PR body.
- **Pixel layer:** cannot go red on macOS, because it does not run there. Proof is a deliberate-break commit pushed to the PR branch, the red CI run captured, then reverted. Recorded in the PR body the same way.

## Baselines

`pnpm test` stays 817. `pnpm test:storybook` stays 80. `pnpm test:e2e --project=<engine>` stays 163 passed / 20 skipped per engine.

The `visual` project adds 15 tests (10 invariant, 5 pixel), chromium only. The exact totals are whatever the first green run prints and are written into the README and the handoff then, not predicted here — the five pixel tests are skips on macOS and passes on linux, so the local and CI numbers differ by design.

## Out of scope

- Changing any component or theme CSS. If this finds a real regression, it is a separate issue.
- The owner's visual review across devices — that is #32, which this supports and does not replace.
- Cross-browser screenshots. Firefox and WebKit render text differently and would triple baseline maintenance for little extra signal.
