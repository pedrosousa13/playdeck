# WCAG 2.2 AA verification pass (#32) — design

Turns "WCAG 2.2 AA" from an aspiration into a verified claim, against the two
targets #32 names: the primitives in `packages/react/src`, and the composed
reference example #67 shipped (`stories/reference/`).

Everything below that is stated as measured was measured on `main` @ `bfeede9`
with a throwaway Playwright probe, not inferred. The probe was deleted.

## What is already true, and is confirmed rather than rebuilt

`apps/storybook/.storybook/preview.tsx` sets `a11y: { test: 'error' }` globally,
so axe already fails the Vitest story run on any violation, for every story.
That satisfies "axe across the primitive stories" today. This work confirms and
documents it; it does not re-implement it.

`packages/react/test/controls.test.tsx:768` already tests focus restoration when
a capability-gated control unmounts while focused, and `:792` tests the negative
case (an outside click that drops focus to `<body>` must not be re-stolen). That
behaviour is out of scope here — #32 asks for focus retention _through menu
open/close_, which is a different path.

## Three measured facts that shape the design

1. **Playwright can drive mock stories.** Navigating to
   `/iframe.html?id=reference-player--composition&viewMode=story` renders with
   the mock adapter's staged state live: the captions button reads
   `Disable captions`, the announcer reads `English captions on`, and no
   `<video>` is in the DOM. The `!test` tag excludes a story from the _Vitest_
   run only; Storybook dev serves every story. So the cross-engine axe pass can
   target deterministic, network-free mock states.

2. **Storybook injects hidden chrome into the story iframe.** A
   `div.sb-preparing-docs > table.sb-argstableBlock` containing three
   `<button>Set string</button>` nodes is present. Measured
   `offsetParent === null`, so axe skips it — but the axe pass is scoped to the
   player anyway, so the result does not depend on that staying true.

3. **A reflow defect exists that neither existing test catches.** Measured at
   320px viewport with `html { font-size: 32px }`:

   ```
   .reely-example         h = 144px
   [data-reely-part=controls]  h = 179px
   controls clipped at top by 35px
   ```

   `.reely-example` is `aspect-ratio: 16/9` + `overflow: hidden`, so the control
   row is cut off — loss of functionality. At 1280px the same resize passes
   clean, because `max-width: 48rem` lets the box grow 768px → 1216px. The
   existing 320px test in `e2e/reference.spec.ts` passes because it measures
   only horizontal overflow at 16px text.

   Neither WCAG 1.4.4 (200% text) nor 1.4.10 (320 CSS px) requires that
   combination on its own. It is fixed and tested anyway: a mobile user at 320px
   with 200% text is a real user.

## 1. State inventory — seven states, five stories

The seven states #32 lists do not map one-to-one onto stories: `Composition` is
genuinely both _paused_ and _captions-on_. New stories are added to
`apps/storybook/stories/reference/reference.stories.tsx`.

| State            | Story id                                                      | Status                                                                                                  |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| idle             | `reference-player--idle`                                      | new — `lifecycle:'idle'`, `activation:'dormant'`, capabilities unavailable                              |
| playing          | `reference-player--playing`                                   | new — `playback:'playing'`                                                                              |
| paused           | `reference-player--composition`                               | exists                                                                                                  |
| captions-on      | `reference-player--composition`                               | exists (`selectedTextTrackId: 'en'`)                                                                    |
| menu-open        | `reference-player--composition`, Settings clicked by the spec | exists                                                                                                  |
| blocked-autoplay | `reference-player--blocked-autoplay`                          | new — `autoplay:'blocked'` + decorator `autoplay` knob + `playResult: { ok: false, reason: 'blocked' }` |
| error            | `reference-player--error-state`                               | new — `lifecycle:'error'` + `error: PlayerError`                                                        |

**Staging constraint.** `stories/reference/**` is under a `no-restricted-imports`
denylist and may not import `../support`'s `ready()`. Each new story rebuilds its
state from `createInitialPlayerState().capabilities`, exactly as the existing
`stagedState` does, so a new core capability surfaces automatically rather than
silently missing.

**`blocked-autoplay` staging.** `MockPlayerParameters`' doc comment is explicit
that `rootProps.autoplay` collides with the decorator: the `Root` prop re-applies
its own `configureAutoplay`. Use the top-level `autoplay` knob.

**menu-open is driven, not inherited.** The spec clicks the Settings trigger
rather than relying on `SettingsMenuFollowsState`'s play function executing
inside `iframe.html`. Whether Storybook runs play functions on plain iframe
render was not measured, and clicking costs nothing.

## 2. Two axe runners

Both, deliberately.

**Vitest / `@storybook/addon-a11y`** — already wired at `test: 'error'`. The four
new stories are picked up with no configuration. This is the authoring-time gate
and the coverage claim for the primitive stories. Chromium only, by
`apps/storybook/vitest.config.ts`'s single browser instance.

**`@axe-core/playwright`** — new root devDependency, new `e2e/a11y.spec.ts`,
seven states × chromium / firefox / webkit. Scoped with
`.include('[data-reely-part="viewport"]')` so Storybook's own DOM can never
enter the result.

The cost is two places to update when a state changes; that is accepted. The
value is that axe evaluates computed style, and UA defaults for focus rings and
target size genuinely differ across engines.

**No axe rule is suppressed anywhere.** That is a standing rule on this artifact:
a suppression here hides exactly what #32 exists to find. The `tabIndex={0}` on
`Player.SettingsMenuContent` in `reference-player.tsx` is the precedent — a real
`scrollable-region-focusable` violation, remediated rather than silenced.

## 3. Reflow — one layout fix, three tests

The fix, in `reference-player.tsx`'s `layoutCss`, extending the existing 420px
breakpoint so the control row leaves the fixed-ratio clipping box:

```css
@media (max-width: 420px) {
  .reely-example {
    aspect-ratio: auto;
  }
  .reely-example-controls {
    position: relative;
  }
  .reely-example-volume {
    display: none;
  }
}
```

Three tests in `e2e/a11y.spec.ts`, each across all three engines:

| Test              | Viewport   | Root font | Asserts                                     |
| ----------------- | ---------- | --------- | ------------------------------------------- |
| 1.4.4 resize text | 1280 × 720 | 32px      | no 2D document scroll; controls not clipped |
| 1.4.10 reflow     | 320 × 640  | 16px      | no 2D document scroll; controls not clipped |
| combination       | 320 × 640  | 32px      | no 2D document scroll; controls not clipped |

200% text is applied as `document.documentElement.style.fontSize = '32px'`,
against a measured baseline of `16px`. The example's layout is already `rem`-based
(`max-width: 48rem`, `font-size: 1.125rem` on buttons), so this scales the way a
UA text-only zoom does.

"Controls not clipped" is asserted as the controls row's bounding rect fitting
inside its container's — the assertion the existing horizontal-overflow check
lacks, and the reason the defect survived.

The existing overflow and volume-slider-breakpoint assertions in
`e2e/reference.spec.ts` stay where they are. The new spec owns the resize
dimension only.

## 4. Screen-reader announcement policy

The policy — meaningful state transitions only, never time updates, never
per-cue — becomes two tests, because either alone is weak.

**Structural**, a story test on `Composition`. The live-region set in the
composed example is exactly `['loading-indicator', 'captions-announcer']`
(measured), and `Player.Time` and `Player.Captions` carry no `aria-live`,
`role="status"` or `role="alert"`. Catches a live region added to a control the
behavioural path never exercises. Blind to behaviour: an announcer firing on
every `timeupdate` has an identical inventory.

**Behavioural**, in `e2e/a11y-media.spec.ts` against `RealSources` on the local MP4
with its VTT track. A `MutationObserver` over every
`[aria-live], [role="status"], [role="alert"]` node:

- play through the cue window → **zero** mutations;
- click `CaptionsButton` → **exactly one**, text `"English captions on"`.

`CaptionsButton` computes its announcement synchronously per render and only
when `selectedTextTrackId` actually changes (`packages/react/src/index.tsx:1838-1848`),
so this is the assertion that pins that implementation down.

## 5. Keyboard flows, split by what each mounting can prove

Shortcuts are not a separate primitive — they live in `Controls`
(Space/`k`, `←`/`→` ±5s, `j`/`l` ±10s, `↑`/`↓` volume ±0.05, `m`, `f`, `c`),
scoped to the region unless `global`.

**Mock `Composition`, × 3 engines.** Every capability is dialed available, so all
nine controls render identically on every engine — the only mounting where a
fixed expected tab order is honest. On real MP4, `AirPlayButton` renders on
WebKit and not on Chromium or Firefox.

- Tab walks all nine controls in composed order.
- `ArrowDown` on the Settings trigger opens the menu onto `items[0]`.
- `Escape` returns focus to the trigger, and the Tab walk resumes from there
  uninterrupted — #32's "focus retention through menu open/close".

**`RealSources` MP4, × 3 engines.** The mock adapter implements no `seek` and
echoes no state, so shortcut effects are unobservable there. Against real media
they are read off the element:

- `m` → `video.muted === true`
- `ArrowRight` → `currentTime` advanced
- `c` → captions button `data-state` flips

## 6. Red first

Two of these tests are the kind that ship asserting nothing. Each is proven to
fail before it is made to pass, and the failure output is recorded:

| Test                      | How it is made red                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| reflow, 320 + 200%        | already red on `main` — capture the failure before applying the CSS fix                                 |
| announcement, structural  | add `aria-live` to `Player.Time` locally, watch it fail, revert                                         |
| announcement, behavioural | make the announcer recompute every render, watch the mutation count exceed zero, revert                 |
| axe, seven states         | remove `tabIndex={0}` from `SettingsMenuContent` — a known real `scrollable-region-focusable` violation |

## 7. CI wiring

`e2e/a11y.spec.ts` runs in the existing three-browser matrix with no changes:
`.github/workflows/ci.yml:64` runs `pnpm test:e2e --project=${{ matrix.browser }}`,
which runs every spec. No tag is needed, and none is added.

**Neither the file path nor any test title may contain the substring "hls", in
any case.** The macOS `hls-native-webkit` job (`ci.yml:154`) runs `--grep hls`,
and Playwright's `--grep` is case-insensitive _and matches the file path as well
as the title_ — measured: `--grep reference --list` returns all five tests in
`e2e/reference.spec.ts`, including "the composed example plays, seeks, mutes and
toggles captions on MP4", whose title contains no "reference". A match pulls a
test into a job whose environment it was never written for, which is exactly how
last session's CI failure happened. `e2e/a11y.spec.ts` is clear on both counts.

The `hls-paths` change-detection filter (`ci.yml:119`) already matches `^e2e/`,
so adding a spec there triggers the macOS job on PRs touching e2e. That is
pre-existing behaviour, not a change.

#32's own verification line is wrong for this repo twice over: `pnpm test:e2e --
--grep a11y` should be `pnpm test:e2e --grep a11y` (pnpm appends a literal `--`
that Playwright misreads as a file filter), and there are no `a11y`-tagged tests,
so it matches nothing today. Since `--grep` matches the file path (measured
above) and the spec file is named `a11y.spec.ts`, that command starts working
once this lands — without any test needing an `a11y` tag.

## Documentation

`Reference.mdx` gains a short section recording what is now verified, where each
criterion is asserted, and the one deviation: the 320 + 200% combination is
tested although no single WCAG criterion demands it.

## Out of scope

- **Owner visual review (HITL)** — gated on #17's real-device matrix. Automated
  work does not wait on it, and #32 cannot close without it.
- **`@real` provider legs** — YouTube and Vimeo are grep-inverted out of CI.
- **Capability-transition focus restoration** — already unit-tested
  (`controls.test.tsx:768`, `:792`), and not what #32 asks for.
- **#87** — filed, deliberately unfixed, unreachable from this example.
- Theme CSS (#10), caption cue styling (#15), the `DefaultPlayer` preset (#9).

## Verification

Gates run unpiped, exit codes read directly — a pipe has produced false greens in
this repo.

```sh
pnpm test; pnpm typecheck; pnpm lint; pnpm test:packages; pnpm test:budgets
pnpm --filter @reely/storybook test; pnpm test:e2e
git diff --name-only main...HEAD | xargs npx prettier --check
```

Baseline on `main` @ `bfeede9`: 731 unit / 39 files · 109 e2e passed / 20 skipped
· 74 storybook / 19 files / 2 skipped. Budgets unchanged by this work — stories
and specs ship nothing.

Repo-wide `pnpm format:check` fails locally on gitignored `.planning/**`; check
changed files only.

## What changed during implementation

Substantive deltas between this design and what shipped:

- **420px breakpoint: `relative`, not `static`.** `static` drops the control
  row out of the positioned stacking context its `z-index: 20` depends on, so
  it painted below Gestures/Poster/Media — invisible and unclickable —
  confirmed by `elementFromPoint` at the row's own center resolving to the
  gestures element instead. `relative` keeps the same in-flow position while
  keeping `z-index` effective. The `background` re-declaration in this doc's
  original snippet was also dropped: the base `.reely-example-controls` rule
  is already opaque (`rgb(4, 6, 10)`) for axe color-contrast, so a second,
  different opaque color inside the media query would be redundant and
  inconsistent.
- **`Player.LoadingIndicator` primitive fix.** Its idle style was missing
  `pointerEvents: 'none'` on one branch, dropping an invariant that was
  previously unconditional on this shipped primitive. Fixed as part of this
  verification pass; see `packages/react/src/index.tsx`.
- **`results.incomplete` is asserted via a per-state allowlist**, not treated
  as always-empty. Two states carry a diagnosed, written-down axe
  `needs-review` finding (`idle`'s color-contrast bgOverlap from the
  full-viewport `ActivationButton`; `menu-open`'s `aria-valid-attr-value`
  false positive on `aria-haspopup` + `aria-controls`) — see
  `e2e/a11y.spec.ts`'s `knownIncomplete` field.
- **The e2e suite split.** `e2e/a11y.spec.ts` ended up mock-only (axe sweep,
  reflow/hit-test, tab-order/menu-focus); real-media checks (shortcut effects
  against an actual `<video>`, the behavioural announcement test) shipped in
  a separate `e2e/a11y-media.spec.ts`, kept apart because that suite depends
  on video decode timing and is more flake-prone.
- **A dense `captions-reference.vtt` fixture** (`apps/storybook/public/`)
  backs the behavioural announcement test's cue-transition coverage.
