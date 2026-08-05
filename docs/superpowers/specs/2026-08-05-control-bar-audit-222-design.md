# SeekSlider and Time against a full control bar — audit (SIDEPRO-222)

Audit, 2026-08-05.

https://linear.app/side-projects-p/issue/SIDEPRO-222/audit-seekslider-and-time-against-what-a-full-control-bar-needs

> **Correction, recorded because it matters.** This audit exists because a
> design session claimed twice that Reely has no seek-bar or time-display
> primitive. Both claims were wrong. `Player.SeekSlider` and `Player.Time`
> have existed since commit `a4a16c0` (2026-07-23), in
> `packages/react/src/transport-controls.tsx:167` and `:246`. The error was
> caught only when the file was read directly, per the issue's own account.
> This is the second recorded time the same false claim reached a planning
> artifact for these two primitives. Everything below assumes both
> primitives exist, because they do.

Reely ships `SeekSlider` and `Time`, and a reference composition already
places them beside every other control
(`apps/storybook/stories/reference/reference-player.tsx:409-455`). This audit
reports what that composition covers, what `SeekSlider` and `Time` do on
scrub, on live sources, and on the keyboard, why the Backpack wrapper never
composed them, and where each primitive stands against WCAG 2.2 AA. It fixes
nothing. Every defect below is filed as its own issue, or folded into an
issue whose scope already covers it. See the "Findings triage" table at the
end.

## 1. Compose the bar

The brief assumed nothing composed `SeekSlider` and `Time` with the rest of
the control set. That assumption was wrong too.
`apps/storybook/stories/reference/reference-player.tsx:409-455` already
composes `Time`, `SeekSlider`, `Time`, `PlayButton`, `MuteButton`,
`VolumeSlider`, `CaptionsButton`, `CaptionsMenu`, `SettingsMenu`, `PipButton`,
`AirPlayButton`, and `FullscreenButton` inside one `Player.Controls`. Per the
maintainer's ruling, this audit reports on that existing composition. It does
not build a second one.

### It works

- The `Composition` story (`apps/storybook/stories/reference/reference.stories.tsx:96-151`)
  locates every control by its accessible name and asserts each renders an
  icon with no text fallback.
- `KeyboardFlow` (`reference.stories.tsx:250-292`) tabs through the full
  control row in composed order, including into and out of the settings
  menu.
- `e2e/a11y.spec.ts` runs axe over seven states across three browsers with no
  suppressed rule (per `Reference.mdx:154-287`). Two allowlisted findings are
  diagnosed, not hidden: a `color-contrast` case tracked as its own defect
  (#89), and a permanent `aria-valid-attr-value` axe-core limitation.

The composition works. It is the most heavily tested surface in the
repository.

### What is missing or awkward side by side

- **The buffered-progress indicator renders nothing.** `SeekSlider`'s
  buffered-range parts (`packages/react/src/transport-controls.tsx:200-215`)
  carry only `position`, `left`, and `width` inline. `reference-player.tsx`'s
  `layoutCss` has no rule for either `seek-buffered` or `seek-buffered-range`
  — its only two `data-reely-part` selectors target `time` and the menu
  items (`reference-player.tsx:89,121-122`). The styling for these parts
  exists only in `packages/react/theme.css:223-239`, which the reference
  deliberately does not import (`reference-player.tsx:16-19`). A viewer of
  the reference never sees how much of the video has buffered.
- **Both sliders render as bare native range inputs.** `layoutCss`
  (`reference-player.tsx:20-210`) has no selector for `input`, `[type=range]`,
  `seek-slider-input`, or `volume-slider`. The thumb and track styling exists
  only in `theme.css:251-264`, not imported here.
- **`SettingsMenuContent` needs a consumer-supplied `tabIndex={0}` to pass
  axe.** `packages/react/src/settings-menu.tsx:135-184` sets no `tabIndex` on
  the menu content root. `reference-player.tsx:264` adds `tabIndex={0}` to
  avoid a real `scrollable-region-focusable` axe violation, and that reason
  is documented only in `Reference.mdx:179-181,199-201`.
- **Responsive folding duplicates markup and already hit a specificity
  trap.** Below 420px, `PipButton` and `AirPlayButton` hide behind a
  container query (`reference-player.tsx:437,444`), and two `Player.MenuItem`
  copies of the same actions render unconditionally inside the settings
  menu, hidden above 420px (`reference-player.tsx:303-330`). The comment at
  `reference-player.tsx:196-209` records a real regression this pattern
  already caused: a selector at specificity `(0,1,0)` lost to menu-item
  styling at `(0,2,0)`, leaving a duplicate entry visible at 768px.
- **The volume slider is dropped, not folded, below 420px.**
  `.reely-example-volume { display: none }` (`reference-player.tsx:189-191`)
  removes fine-grained volume control on a narrow player, leaving only mute.

None of this argues for a different extension mechanism. Every gap above is
a missing style, a missing default, or a missing documented pattern, inside
the constraint `.out-of-scope/as-child.md` states: primitives render fixed
elements, and children plus `data-reely-part`/`style` are the only extension
points.

### Library CSS versus story-local CSS, quantified

`@reely/react` contributes one inline style object to this bar:
`{ minWidth: 44, minHeight: 44 }`, reused across `PlayButton`, `MuteButton`,
and `VolumeSlider` (`packages/react/src/loading-error.tsx:301-304`), plus the
equivalent `minHeight: 44` inline on `SeekSlider`'s wrapper and input
(`transport-controls.tsx:199,233`). That is the library's entire visual
contribution to this bar: a tap-target floor, nothing else.

The story contributes roughly 191 lines of CSS (`reference-player.tsx:20-210`):
layout, background, the two-row split, button reset and hover, menu
positioning and scrolling, error-state styling, and three `@container`
responsive rules, plus per-element inline styling through the rest of the
552-line file.

A consumer who adopts only public exports and copies this file has to write
nearly the entire visual language of the bar, or adopt `theme.css`, which
this example is structured specifically not to exercise.

## 2. Scrub semantics

`SeekSlider` seeks continuously while dragging. It does not preview locally
and commit on release.

`transport-controls.tsx:216-236` renders one `<input type="range">` and wires
`onChange` directly to `controller.seekTo(next)` (`:230`). There is no
pending-value state and no `onPointerUp`, `onMouseUp`, or `onTouchEnd`
handler. React's `onChange` on a range input binds to the native `input`
event, which fires on every intermediate position during a drag, not only on
release. Every tick of the drag issues its own seek command.

The call chain for one tick runs `transport-controls.tsx:230` into
`controller.seekTo` (`packages/core/src/player-controller.ts:402-403`), into
`#command` (`:470-495`), into `#providerCommand` (`:497-532`), into
`provider.seekTo` directly. No throttle, debounce, or in-flight-command guard
exists anywhere in this path.

**Provider tolerance:**

- **Native** (`packages/provider-native/src/playback.ts:206-213,231-238`)
  clamps the target, then assigns `media.currentTime` directly. Repeated
  rapid assignment is a normal browser operation. Each new value supersedes
  the last pending seek.
- **HLS** (`packages/provider-hls/src/playback.ts:37-68`) delegates `seekTo`
  to the same native functions verbatim (`:46-47`). Same tolerance, same
  lack of gating.
- **YouTube** (`packages/provider-youtube/src/playback.ts:119,127-139`) calls
  the IFrame API's `seekTo` and writes the target into a local time mirror
  immediately (`:136-137`), because a read-back would still return the
  pre-seek time. Every call requires a ready player through
  `getReadyPlayer()`, but adds no throttle. The postMessage transport is
  asynchronous, so rapid calls queue messages the embed processes at its own
  pace.
- **Vimeo** (`packages/provider-vimeo/src/playback.ts:130-131,136-143`)
  clamps the target, then calls `player.setCurrentTime` through the SDK. No
  rate limit exists. Rapid dispatch produces overlapping in-flight promises
  to the embedded iframe.
- **Wistia** (`packages/provider-wistia/src/playback.ts:128-129,159-164`)
  follows the same shape as Vimeo. Its attachment binds no `onSeeking`
  handler at all (`:93-94`), so `state.seeking` may never observably flip to
  `true` during a drag on this provider. Only `onSeeked` fires (`:278-284`).

No adapter rejects a seek for being too rapid. None debounce or coalesce. The
risk this creates sits at the network and embed-API level, not in code that
mitigates it.

**Is `PlayerState.seeking` enough to distinguish a user drag from a
programmatic seek? No.**

`PlayerState.seeking` (`packages/core/src/types.ts:112`) is a bare boolean
with no provenance field. `SeekSlider`'s `onChange` handler
(`transport-controls.tsx:228-232`) calls `controller.seekTo` with no origin
argument. Compare `PlayButton`, which calls the origin-tagged
`controller.togglePlaybackWithOrigin('user')`
(`transport-controls.tsx:42-47`). `PlayerController` defines
`playWithOrigin`/`pauseWithOrigin` (`player-controller.ts:382,388`) but no
`seekToWithOrigin` counterpart (`:402-403`).

Every adapter's `providerEvent()` helper hardcodes `origin: 'provider'` for
the `seeking`/`seeked` events, confirmed at
`packages/provider-native/src/adapter-values.ts:20-29` (`:27`) and used
identically by the other four adapters. `PlayerEventOrigin`
(`packages/core/src/types.ts:154-155`) defines
`'user' | 'api' | 'autoplay' | 'provider' | 'system'`, but the seek path
never emits `'user'` or `'api'`. A consumer reading `state.seeking`, or the
`seeking`/`seeked` event's `origin`, cannot tell a user drag from a
script-driven seek.

## 3. `Time` coverage

`Time`'s `type` prop accepts three values: `'current'` (the default),
`'duration'`, and `'remaining'` (`packages/react/src/transport-controls.tsx:242-244`).
The branching logic at `:246-262` confirms all three render.
`reference-player.tsx:415` uses `type="current"` and `:419` uses
`type="duration"`. A `type="remaining"` instance exists only in the story
file (`apps/storybook/stories/time.stories.tsx:65-71`), not in the reference
composition.

When `duration` is `null`, the live-stream case, `Time` renders a literal
`"0:00"` for both `type="duration"` and `type="remaining"`.

`hasDuration` (`transport-controls.tsx:252`) is `false` when `duration` is
not a finite number. For `type="duration"` (`:254-257`), `seconds` falls back
to `0`, and `formatTime(0)` returns `"0:00"` (`:6-15`). For `type="remaining"`
(`:258-262`), `seconds` also falls back to `0`, and because the minus-sign
branch requires `seconds > 0` (`:264-265`), the rendered text is `"0:00"`,
not `"-0:00"`.

`type="current"` is unaffected. `seconds = currentTime` stays meaningful on a
live stream. `data-state` is correctly set to `"untimed"` when `hasDuration`
is `false` (`:273`), so the raw signal exists in the DOM. The rendered text
does not use it. A consumer who wants different text for the untimed case
must supply `children` themselves.

## 4. Live

`SeekSlider` never reads `PlayerState.live`.

Its `usePlayerState` selector (`transport-controls.tsx:173-181`) destructures
`buffered`, `currentTime`, `duration`, `provider`, `seekable`, and `status`.
`live` is not in that list, and no `data-live` or similar attribute appears
anywhere in the render body (`:192-239`). Compare the attributes that do
render, at `:193-199`.

`SeekSlider` instead computes its scrubbable range from `duration` and
`seekable` through the module-level `seekWindow` helper (`:154-165`). A
positive `duration` gives the range `[0, duration]`. Otherwise, a populated
`seekable` gives `[min(start), max(end)]`, which the comment there names the
"live DVR" fallback. This produces a usable range for HLS live sources
because the HLS adapter forces `duration: null` while live
(`packages/provider-hls/src/index.ts:272-283`), and `PlayerLiveState`
documents the same convention (`packages/core/src/types.ts:74-77`). It works
by accident of how `duration` and `seekable` happen to be populated, not
because the component consults `live`.

**What a live source looks like today, when it works:** the same chrome as a
VOD scrub bar over an unusually-shaped window. If the HLS adapter judges the
seekable span "meaningful" (at least `LIVE_MIN_SEEK_WINDOW_SECONDS = 2`,
`provider-hls/src/index.ts:97-98,250-258`), `capabilities.seek` stays
`available` and the slider renders a draggable range with
`data-state="ready"`. There is no "LIVE" badge, no distinct color or state,
and no `data-*` attribute a consumer could style for it.
`PlayerLiveState.atLiveEdge` (`types.ts:78-81`, populated only by
`provider-hls/src/index.ts:68-91`) has zero consumers in `packages/react/src`,
so there is no snap-to-live-edge affordance and no indication of where the
live edge sits. Dragging to the slider's `max` seeks to whatever
`seekable.end` was at render time, a stale snapshot rather than a request to
catch up.

**What happens when the window is too short:** the HLS adapter forces
`capabilities.seek` to `unavailable` when the live span is under two seconds
(`provider-hls/src/index.ts:211-213`). `SeekSlider`'s capability gate then
returns `null` (`transport-controls.tsx:184`). The entire control disappears
from the bar. Nothing replaces it, not even a static "LIVE" label.

**Only the HLS adapter ever populates `PlayerState.live`.** No file under
`packages/provider-native/src`, `packages/provider-youtube/src`,
`packages/provider-vimeo/src`, or `packages/provider-wistia/src` constructs a
`{ live: ... }` patch. `PlayerState.live` for those four providers stays at
its controller-constructed initial value of `null`
(`packages/core/src/player-controller.ts:62`) for the life of the session,
live broadcast or not.

Reely has no first-class notion of live or DVR seeking in its React
primitives today. What exists is an incidental range-computation fallback,
plus one adapter's optional signal that nothing downstream reads.

## 5. Keyboard

`SeekSlider` attaches no `onKeyDown`. `transport-controls.tsx:167-240` has no
keyboard handler in its body. Everything a keyboard user can do comes from
one of two other layers: the native `<input type="range">`'s own behavior, or
`Player.Controls`' region-scoped shortcut handler (`controls.tsx:97-191`),
which owns Space, `k`, arrow keys, `j`/`l`, volume arrows, `m`, `f`, and `c`,
but only when focus sits outside the slider.

| Key(s)                                   | Effect                                      | Owner                                             |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| `ArrowRight`/`ArrowLeft`, off the slider | ±5s seek                                    | `Controls` shortcut (`controls.tsx:118-122`)      |
| `j`/`l`                                  | ∓10s / +10s seek                            | `Controls` shortcut (`controls.tsx:123-134`)      |
| `ArrowRight`/`ArrowLeft`, on the slider  | ±1s (the input's `step`)                    | native range input (`transport-controls.tsx:218`) |
| `Home`/`End`                             | jump to min/max of the seek window          | native range input, no Reely code                 |
| `PageUp`/`PageDown`                      | an unspecified, engine-dependent "big step" | native range input, no Reely code                 |
| Space/`k`                                | play/pause toggle                           | `Controls` shortcut (`controls.tsx:104-112`)      |
| `↑`/`↓`, off the slider                  | volume ±0.05                                | `Controls` shortcut (`controls.tsx:135-147`)      |
| `↑`/`↓`, on a focused `VolumeSlider`     | ±0.05 (native `step`)                       | native range input (`transport-controls.tsx:130`) |
| `m`, `f`, `c`                            | mute, fullscreen, caption-track toggle      | `Controls` shortcut only (`controls.tsx:148-173`) |

`isEditableTarget` (`controls.tsx:21-30`) treats any `<input>`, including
`type="range"`, as an editable target, and `handleShortcut` bails when the
event target is editable (`:99-102`). This is deliberate and tested:
`controls.test.tsx:727-753` asserts the seek and volume shortcuts do not fire
while a slider has focus.

**Arrow-key seek granularity changes with focus, unannounced.** Off the
slider, arrows seek 5 seconds (`controls.tsx:118-122`). On the slider, the
same keys seek 1 second (`transport-controls.tsx:218`). Nothing announces the
change in meaning when focus moves onto the slider. The same seam is
invisible for volume, because both steps happen to equal `0.05`.

**What SIDEPRO-225 still needs to add, per this audit:**

- A large-jump key for the seek slider. `PageUp`/`PageDown` today are
  whatever the browser does, unowned by any Reely code.
- A stated relationship between the two seek granularities, 5s off the
  slider versus 1s on it, rather than an emergent side effect of two
  independent defaults.
- A resolution to the `global` option's WCAG 2.1.4 risk. In its default
  mode, `Player.Controls`' shortcut listener is scoped to the named,
  focusable region (`controls.tsx:244-257`), which satisfies SC 2.1.4's
  "only active when the component has focus" exception, confirmed by
  `controls.test.tsx:773-782` and used by the reference player
  (`reference-player.tsx:409-413`, no `global` prop). Opting into `global`
  (`controls.tsx:42-49,192-198`, exercised by `controls.test.tsx:784-791`)
  attaches the same single-character shortcuts to `document`, active
  regardless of focus anywhere on the page. That satisfies none of 2.1.4's
  three exceptions, and Reely ships no remap or turn-off alongside it.

## 6. Why the Backpack wrapper ignored them

`apps/storybook/stories/backpack/backpack-video.tsx:406-413` renders exactly
one control inside `Player.Controls`:

```tsx
{
  !awaitingActivation && controls ? (
    <Player.Controls
      aria-label="Video player controls"
      className="ef-video-controls"
    >
      <Player.PlayButton />
    </Player.Controls>
  ) : null;
}
```

**Verdict: overlooked, not deliberate.**

`SeekSlider` and `Time` shipped in commit `a4a16c0` ("Transport control
primitives + accessible semantics"), dated 2026-07-23. The full reference
composition, using both primitives side by side with every other control
against real Vimeo, YouTube, HLS, and MP4 sources, landed in commit
`bfeede9` ("One composed reference example, exercised in CI"), dated
2026-07-26, three days later. `apps/storybook/stories/backpack/backpack-video.tsx`
was created in commit `3b46acd` ("Add a BackpackVideo compat wrapper..."),
dated 2026-08-03, eleven days after `SeekSlider` shipped and eight days after
the reference composition proved it working. A search of every commit
touching that `Player.PlayButton` line finds exactly one: `3b46acd` itself.
The single-button bar has never been revisited since.

`SeekSlider` was not unavailable. It was not shown to be unsuitable either:
Backpack's own `VideoPlayer` forwards `controls` straight to `react-player`,
which hands the underlying element the provider's native chrome, so the
parity target has no competing bar design to match. `SeekSlider` gates on
`capabilities.seek.status`, which is `available` on both Vimeo and YouTube,
demonstrated directly in the reference composition's `RealSources` story
(`reference-player.tsx:521-551`). No capability, layout, or provider
constraint anywhere in the codebase would have made `SeekSlider` or `Time`
fail inside the Backpack wrapper.

The originating ticket, SIDEPRO-197, scoped `controls` narrowly: "show or
hide the provider's controls," with an acceptance list of four stories and
no criterion mentioning a seek bar or time display. Its own out-of-scope
list names light mode, cover images, hover effect, viewport pause, and
several other exclusions, never the shape of the control bar.

`docs/backpack-parity.md:125` marks the affected `WithControls` row
`partial`, with no tracked issue number, unlike every other acknowledged
shortfall in the same document's "Where Reely is worse" table (`:60-68`),
which carries SIDEPRO tickets for SIDEPRO-210, SIDEPRO-212, and SIDEPRO-214.
The gap is recorded as descriptive fact, not as a reasoned, tracked
divergence.

Not unavailable, not shown to be unsuitable, and not recorded as a
deliberate choice anywhere a deliberate choice would be recorded.
SIDEPRO-197's acceptance criteria never asked for a seek bar, and nobody
extended the wrapper's chrome once that narrow criteria was met. That is an
unreasoned omission, not a design decision, even though the wrapper's
original scope was itself a deliberate, narrow slice.

**One concrete consequence.** Because the wrapper renders its own
`Player.Controls` independently of what it forwards to the provider, a
YouTube source with `controls={true}` likely renders two control bars at
once: YouTube's own native chrome (`backpack-video.tsx:519-530` forwards
`controls` into `playerVars.controls`,
`packages/provider-youtube/src/attachment.ts:154`) and Reely's
`Player.Controls`. No story exercises this. Every `WithControls`/`Loop`
story uses a Vimeo URL (`backpack-video.stories.tsx:454-462`,
`backpack-video-real.stories.tsx:95-97`).

## 7. Accessibility against WCAG 2.2 AA

### 4.1.2 Name, Role, Value

Name and role pass. `SeekSlider`'s input has an implicit `role="slider"` from
`type="range"` and an explicit `aria-label="Seek"`
(`transport-controls.tsx:217`), confirmed by `controls.test.tsx:288`.

Value is correct in the normal and live-DVR cases, and wrong in the idle
case. `aria-valuetext` reads `${formatTime(value)} of ${formatTime(duration)}`
for VOD (`:220-224`, test `:293`) or just the position for a live DVR window
(test `:364`). When `duration` is `null` and `seekable` is empty, the actual
state the component's own `data-state="idle"` names (`:198`), `min`, `max`,
and `value` all collapse to `0` (`:187-190`) and `aria-valuetext` reports
`"0:00"` (`:222-223`), a specific, plausible time value for a slider that
cannot move at all. Nothing marks this state as unavailable: no `disabled`,
no `aria-disabled`, on the input or its container. `controls.test.tsx:246-392`
covers capability-unavailable, VOD, and live-DVR, never this state.

### 1.3.1 Information and Relationships

Fails. The buffered-range visualization is invisible to assistive
technology. The wrapping `seek-buffered` element carries `aria-hidden="true"`
(`transport-controls.tsx:201`), removing it and every child range
(`:203-213`) from the accessibility tree. `aria-valuetext` encodes playhead
position only (`:220-224`) and says nothing about how much has loaded. A
sighted user sees the buffer extent through CSS positioning
(`theme.css:234-239`). A screen-reader user has no way to determine it at
all.

### 2.1.1 Keyboard

Passes for the primitive's own affordances. Every action `SeekSlider`
exposes is reachable through native range-input keyboard behavior, with no
pointer required (`transport-controls.tsx:167-240`). `Time` is a static
`<time>` with no interactive affordance to gate.

### 2.4.7 Focus Visible

Passes. A generic rule targets every `[data-reely-part]` element with
`:focus-visible`, setting a 2px white outline (`theme.css:199-202`),
contrasting at roughly 21:1 against the default black backdrop. The rule is
opt-in: the reference example does not import `theme.css`
(`Reference.mdx:73-78`), so a consumer who ships no stylesheet gets the
browser's own default focus ring instead.

### 2.5.8 Target Size (Minimum)

Passes, measured. Both the seek slider's container and its input carry an
inline 44px minimum height (`transport-controls.tsx:199,233`), and
`VolumeSlider` gets the same floor through `controlTargetStyle`
(`loading-error.tsx:301-304`). Test `controls.test.tsx:323-327` pins the seek
slider's floor directly. Both exceed the 24×24 CSS px minimum with room to
spare.

### 1.4.3 / 1.4.11 Contrast

Text contrast does not apply to these two primitives. `Time` inherits its
color from the surrounding theme (`theme.css:151`), a composition concern.

Non-text contrast fails for the seek slider's unfilled track, on the shipped
default. `seek-buffered` is the visual track under the transparent-background
native input (`theme.css:251-260`). Its default color,
`--reely-color-track: rgb(255 255 255 / 0.3)` (`theme.css:230`), composites
against the default `#000` backdrop (`theme.css:28,78`) to roughly 2.49:1,
below the 3:1 floor 1.4.11 sets for a UI component's boundary. This is not
exempt as user-agent-styled chrome: the shipped theme draws this element
with an explicit author color.

Everything else on the slider passes. The buffered range itself,
`--reely-color-buffered: rgb(255 255 255 / 0.5)` (`theme.css:238`), composites
to roughly 5.3:1. The accent color used for the thumb,
`--reely-color-accent: #3ea6ff` (`theme.css:257`), contrasts at roughly
8.1:1. `VolumeSlider`'s unfilled track carries no separately-colored element
(`theme.css:251-260`), so whatever groove is visible is genuinely
browser-drawn chrome, exempt under 1.4.11.

### Live-region policy for `Time`

A deliberate, correct, and already-tested choice: no live region. `Time`
carries no `aria-live`, `role="status"`, or `role="alert"`
(`transport-controls.tsx:267-278`), per the stated policy of announcing
state transitions only, never time updates, documented and verified in
`docs/superpowers/specs/2026-07-26-wcag-verification-pass-32-design.md:152-162`.
Announcing every second of playback would be unusable. No SC in this set
requires proactive announcement of `Time`'s value.

## Findings triage

Every defect found across the three source audits is listed below, one row
each. Disposition names the existing issue whose scope already covers the
defect, or reads `new issue` where nothing does.

| Defect                                                                                                                                         | Anchor                                                                                        | Disposition |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `SeekSlider` seeks continuously with no preview/commit-on-release mode and no throttle                                                         | `packages/react/src/transport-controls.tsx:228-232`                                           | new issue   |
| `PlayerState.seeking` and the `seeking`/`seeked` events cannot distinguish a user drag from a programmatic seek                                | `packages/core/src/types.ts:112`, `packages/react/src/transport-controls.tsx:230`             | new issue   |
| `Time` renders a literal `"0:00"` for `type="duration"` and `type="remaining"` when `duration` is `null`                                       | `packages/react/src/transport-controls.tsx:254-262`                                           | SIDEPRO-224 |
| `SeekSlider` never reads `PlayerState.live` and exposes no live-edge affordance                                                                | `packages/react/src/transport-controls.tsx:173-181`                                           | SIDEPRO-224 |
| `SeekSlider` disappears entirely when the live seekable window is judged too short to scrub                                                    | `packages/provider-hls/src/index.ts:211-213`, `packages/react/src/transport-controls.tsx:184` | SIDEPRO-224 |
| Only the HLS adapter populates `PlayerState.live`. Native, YouTube, Vimeo, and Wistia never do                                                 | `packages/core/src/player-controller.ts:62`                                                   | new issue   |
| Idle/no-window `SeekSlider` reports a misleading `"0:00"` value with no `disabled`/`aria-disabled` state                                       | `packages/react/src/transport-controls.tsx:187-190,222-223`                                   | new issue   |
| Buffered-range information has zero non-visual exposure to assistive technology                                                                | `packages/react/src/transport-controls.tsx:201`                                               | new issue   |
| Default seek-slider unfilled-track color fails WCAG 1.4.11 non-text contrast (roughly 2.49:1)                                                  | `packages/react/theme.css:230`                                                                | new issue   |
| Arrow-key seek granularity silently changes with focus location (5s off slider, 1s on it), unannounced                                         | `packages/react/src/controls.tsx:118-122`, `packages/react/src/transport-controls.tsx:218`    | SIDEPRO-225 |
| `Player.Controls`' `global` option is a live WCAG 2.1.4 risk with no remap or turn-off offered                                                 | `packages/react/src/controls.tsx:192-198`                                                     | SIDEPRO-225 |
| No large-jump key is defined for the seek slider. `PageUp`/`PageDown` are unspecified browser defaults                                         | `packages/react/src/transport-controls.tsx:167-240` (no handler)                              | SIDEPRO-225 |
| The buffered-progress indicator renders nothing in the reference composition, for lack of a CSS rule                                           | `apps/storybook/stories/reference/reference-player.tsx:20-210`                                | new issue   |
| Both sliders in the reference bar render as unstyled native range inputs                                                                       | `apps/storybook/stories/reference/reference-player.tsx:20-210`                                | new issue   |
| `SettingsMenuContent` ships a `scrollable-region-focusable` axe violation by default. The fix is an undocumented consumer prop                 | `packages/react/src/settings-menu.tsx:135-184`                                                | new issue   |
| Responsive control folding is hand-rolled, duplicates markup, and already hit a CSS specificity trap                                           | `apps/storybook/stories/reference/reference-player.tsx:196-209`                               | new issue   |
| Backpack wrapper's `controls={true}` on a YouTube source likely renders two overlapping control bars, untested                                 | `apps/storybook/stories/backpack/backpack-video.tsx:406-413,519-530`                          | SIDEPRO-223 |
| Backpack wrapper's control bar omits `SeekSlider`, `Time`, `MuteButton`, `VolumeSlider`, and `FullscreenButton` with no recorded design reason | `apps/storybook/stories/backpack/backpack-video.tsx:406-413`                                  | new issue   |
