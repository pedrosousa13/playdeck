# `currentTime` stays a `usePlayerState` read; it does not become a published CSS custom property

_Proposed — awaiting the maintainer's decision in the PR that adds it._

#881 asked whether `SeekSlider`'s fill and `Time`'s display should read
`currentTime` the way `Viewport` reads a measured aspect ratio
([ADR-0002](0002-published-measurements-are-outputs.md)) — a value written
imperatively onto a DOM node, outside `usePlayerState`'s
`useSyncExternalStore`, instead of selected from `PlayerState` on every
render. Today both read it through `usePlayerState`
(`packages/react/src/transport-controls.tsx`), which means both re-render on
every `timeupdate` — 15–250ms apart per the HTML spec, commonly around 4Hz on
native sources, and on a fixed 250ms poll on YouTube
(`TIME_UPDATE_INTERVAL_MS`, `packages/provider-youtube/src/time-updates.ts`).
This records a measured answer: **reject**. The gain is real but small, and
it does not actually reach to where the proposal's name suggests it does.

## What was measured

Two harnesses, not part of this change — their source is in the pull request
that adds this ADR, not in `packages/`. Both mount a representative control bar under a real
`Player.Root`, with a mock provider driving `currentTime` through 200
synthetic ticks (a quarter-second apart, matching the YouTube poll rate), and
each wraps every measured component in its own `Profiler` so a render count
or `actualDuration` is attributed to the part that produced it rather than to
an ancestor.

**Before** (`before.test.tsx`) mounts the real exported parts unmodified, as
one eight-part control bar — `PlayButton`, `MuteButton`, `VolumeSlider`,
`SeekSlider`, three `Time` instances (`current`/`duration`/`remaining`),
`FullscreenButton` — and drives `currentTime` through the controller exactly
as a provider would.

**After** (`after.test.tsx`) mounts the _same_ eight parts: `PlayButton`,
`MuteButton`, `VolumeSlider` and `FullscreenButton` unchanged, `SeekSlider`
replaced by `SeekSliderCP` and all three `Time` instances replaced by
`TimeCP`. Both prototypes take the shape the issue proposes: a single
`useImperativeCurrentTime` subscriber per part, built on
`controller.subscribe` rather than `usePlayerState` — the same mechanism
`Viewport` already uses for `--playdeck-media-aspect-ratio`
(`packages/react/src/viewport-media.tsx`'s `subscribeDimensions` effect) —
bailing out when `currentTime` has not actually moved, with no `setState`
anywhere in the callback. Both files drive the identical 200-tick loop and
wrap every part in its own `Profiler`, so every row below except the last is
the same instrument on both sides.

Three runs each, 200 ticks per run, averaged:

| metric (same instrument both sides)                                                                                   | Before                                       | After                        |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------- |
| Renders, summed across the four currentTime-reading parts (`Profiler` `onRender` count)                               | 800 (200 × 4 parts — every tick, every part) | 0                            |
| React `actualDuration`, summed across those same four parts (`Profiler`)                                              | ≈76.9ms total → ≈0.385ms/tick                | 0ms                          |
| Wall clock for one tick's dispatch across the **whole eight-part bar** (`performance.now()` around the dispatch loop) | ≈160.1ms total → ≈0.80ms/tick                | ≈38.7ms total → ≈0.19ms/tick |

One further row uses a **different instrument** and is not folded into a
ratio against the row above it: the "after" side's four subscribers
(`SeekSliderCP` + three `TimeCP` instances) each write to the DOM once per
tick, timed with a bare `performance.now()` around the subscriber callback
rather than through `Profiler` — there is nothing for `Profiler` to measure
once a part stops re-rendering. That cost averaged ≈24.7ms total across the
200-tick run, ≈0.12ms/tick, for all four writers combined.

The render-count row is the one that matters most: every tick, today,
re-renders `SeekSlider` and all three `Time` instances — `Time[duration]`
included, which displays nothing that changed, because `Time`'s one selector
names `currentTime` regardless of its own `type` prop. The prototype parts
re-render **zero** times after mount. On the one metric measured identically
on both sides end to end — wall clock for dispatching a tick across the same
eight-part bar — the saving is a **≈4× reduction** (≈0.80ms/tick to
≈0.19ms/tick), smaller than an earlier, mismatched measurement in this
investigation reported, because that draft compared the full eight-part
"before" bar against a two-part "after" tree that mounted only the swapped
parts. This version fixes that: both sides now mount the same eight parts,
and the wall-clock row is the only one actually measuring the whole bar on
both sides at once.

Reproduce (from the repository root, with `before.test.tsx`, `after.test.tsx`
and `vitest.config.ts` — the pull request's own harness source, saved
together in one directory of your choosing):

```
npx vitest run --config vitest.config.ts before.test.tsx --disable-console-intercept
npx vitest run --config vitest.config.ts after.test.tsx --disable-console-intercept
```

## Why the saving does not clear the bar

**A CSS custom property cannot hold what `Time` displays.**
`--playdeck-media-aspect-ratio` works because the value it carries is itself
a CSS value — `aspect-ratio` reads a `var()` directly. `Time` renders
formatted text, `1:23` or `-0:07`, into an element's child text node and its
`dateTime` attribute; there is no CSS mechanism that puts an arbitrary
formatted string into a text node, `content: var(...)` included (that
route needs a `<string>`-typed registered property, renders through
`::before`/`::after` rather than the element's own text, is invisible to
text selection and to a screen reader's normal reading order, and buys
nothing an ordinary text node does not already give for free). The
prototype's `TimeCP` does not read a published property at all: it writes
`textContent` and `dateTime` directly from the same subscriber. That is a
legitimate pattern — it is the one `Viewport`'s own write already uses, a
`useEffect`-driven `controller.subscribe` rather than
`useSyncExternalStore` — but it is not the one #881 asked about, and the ADR
this issue asked for would be documenting a decision under the wrong name.
"The time display reads a published custom property" is not a sentence that
can be made true; "the time display writes its own text node imperatively"
is a different, larger claim about how far this package is willing to move
its own primitives off React's render cycle, and it deserves its own
decision if anyone proposes it on its own terms.

**`SeekSlider`'s `currentTime` dependency is not only a paint value.**
`useSeekPreview` (`transport-controls.tsx`) computes `release` — whether a
user's requested seek position has been confirmed, and so should stop being
shown in place of the published value — **during render**, by comparing the
live `currentTime` against the requested value and a tolerance
(`requestAnswered`). Its own comment explains why that comparison runs at
render time and not in an effect: "releasing a render later would show the
previewed position for one frame after the media had already answered for
it." That comparison needs `currentTime` as an ordinary render-time value on
every tick; moving it to an imperative subscriber would not just change how
the fill paints, it would require rebuilding the echo/release logic to run
off a `controller.subscribe` callback instead of render, including the
`setRequested(null)` call that logic makes conditionally during render
today. The prototype in this investigation does not attempt that — it
measures a fill and an input value with no preview/echo behaviour at all, so
its numbers are a ceiling on the saving available to the **fill alone**, not
a working replacement for the control.

**The native input's `value` would become imperative, and that has a real
accessibility cost.** `aria-valuenow` is never hand-set — `SeekSlider`
renders a native `<input type="range" value={value} …>`, and the implicit
accessible value derives from `value`. Keeping the visual fill in sync via a
published property still leaves the input's own `value` (what
`aria-valuenow` and a screen reader's announcement actually read) needing to
move every tick too, which `aria-valuetext` already does today — so the
"published property" framing does not remove the per-tick write it was
meant to avoid; it relocates it from a React-controlled prop to an
imperative `.value` assignment on an input React still renders with
`value={...}` for every other purpose (seeking, the echo preview, focus
handling). An input controlled by React except for one externally-mutated
property is exactly the shape React's own controlled-input tracking warns
against: React compares the DOM's `.value` against what it last set to decide
whether a user actually changed it, and an outside write in between is
invisible to that comparison. The prototype sidesteps this by making the
input **fully uncontrolled** (`defaultValue`, no `value` prop at all) — the
one way to make an imperative `.value` write safe — which is a bigger
interface change than "the fill reads a custom property" describes: it gives
up `SeekSlider`'s controlled-input contract entirely, for every consumer who
reads or sets the input's value through the DOM today.

**SSR loses a correctness property it has today.** `youtube-poster-ssr.test.tsx`
confirms this package's primitives are rendered server-side in practice.
`usePlayerState`'s `getServerSnapshot` is the same `getSnapshot` the client
uses (`player-context.ts`), so the server-rendered HTML already carries the
real `currentTime` — the fill's width, the input's `value`, and `Time`'s text
are all correct in the very first markup a browser paints, resume position or
live offset included. An imperative subscriber runs in a `useEffect`, which
never executes during server rendering and does not run synchronously even
on the client before the first paint. The server-rendered HTML under this
proposal would carry no custom property (the fill falls back to its
`calc()`'s default), an empty `Time` text node, and whatever `defaultValue`
the uncontrolled input was given — not `0` as a harmless placeholder, but a
visibly wrong position for any player that does not start at the beginning.
Today's render-time read has no such gap; trading it away is a real
regression, not a neutral implementation detail, for every consumer who
renders this package on a server.

## Consumer-contract impact

Nothing here removes `currentTime` from `PlayerState` or from
`usePlayerState` — rejecting this proposal changes nothing a consumer-built
part reads today. `ChaptersMenu` is worth naming because it is in the same
position `SeekSlider` and `Time` are: its selector names `currentTime`
directly (to mark the active chapter) and would pay the identical per-tick
re-render while open. It was out of scope for the issue's prototype and
remains out of scope here, for the same reason `SeekSlider`'s preview logic
does: deciding this for one reader and not the others would leave the
question half-answered by a change that touched only two of the three.

## Migration path

Set out for completeness, in the order it would have to happen — this is
what adopting the proposal would cost, not a plan this ADR is asking for:

1. **`SeekSlider`'s fill first, on its own.** The fill is the one part of
   this proposal that is actually a published CSS property in ADR-0002's
   sense, and the one part whose `currentTime` dependency is not entangled
   with anything else — unlike the input, it carries no echo/preview state.
   It could move alone, behind the same kind of `useEffect`-driven
   `controller.subscribe` `Viewport` already uses, with no change to what
   `usePlayerState` reports.
2. **`useSeekPreview`'s render-time comparison would have to move with the
   input, not stay behind.** The input's `value` cannot move to an
   imperative write while `release` keeps comparing `currentTime` at render
   time — the two would disagree about which `currentTime` is current. This
   is the step this investigation did not prototype: `useSeekPreview` would
   need its own `controller.subscribe`, running its tolerance comparison and
   calling `setRequested(null)` from that callback instead of during render.
3. **The controlled → uncontrolled change, staged behind a prop.** Turning
   the input from `value={value}` to `defaultValue` is a breaking change for
   any consumer reading or setting it as a controlled element through the
   DOM or through `inputProps`. A `currentTimeSource?: 'state' | 'published'`
   prop (default `'state'`) would let it ship without breaking anyone, one
   release deprecating the default before flipping it.
4. **SSR's first paint would need to be seeded from `usePlayerState` once,
   then handed off.** The regression in this ADR's own measurement is not
   inherent to the mechanism — only to writing nothing until the first
   effect runs. The fix is the pattern SSR-aware imperative widgets already
   use elsewhere: read `currentTime` from `usePlayerState` for the initial
   render only (one `useRef` holding whether the subscriber has taken over
   yet), so the server-rendered and first-paint HTML carry the real value,
   and let `useImperativeCurrentTime` take over from the next tick on. That
   still leaves one `usePlayerState` read per mount, not per tick, which is
   the saving this ADR measured and would not give back.
5. **`ChaptersMenu` decided alongside, not after.** It shares the same
   `currentTime` selector and the same per-tick cost while its menu is open;
   shipping this for `SeekSlider`/`Time` and leaving `ChaptersMenu` on
   `usePlayerState` would be the half-finished state the consumer-contract
   section above already declines to create.
6. **A changeset, not a silent swap.** `inputProps`, the controlled-input
   contract, and (for `ChaptersMenu`, if included) nothing public — but the
   `currentTimeSource` prop and the controlled → uncontrolled default change
   are both consumer-visible, so this ships as a minor version with a
   changeset describing the new prop and, when the default flips, a second,
   later changeset marked breaking.

## Recommendation

**Reject.** The measured saving — on the one metric measured identically on
both sides of this investigation, a ≈4× reduction in wall-clock cost per
tick across a representative eight-part control bar, and a drop from 800
re-renders to zero on the four parts that read `currentTime` — is real but
does not clear what adopting it would cost: `Time`'s half of the proposal is
not actually expressible as a published CSS property at all, `SeekSlider`'s
`currentTime` read is load-bearing inside render-time echo logic that a
property cannot serve, the input would have to give up being a controlled
component, and the server-rendered first paint would regress from correct to
wrong unless the migration path above's seeding step is also built. None of
those four is a tuning problem solvable by measuring harder; each is a
different shape of commitment than "read a published property instead of
state," and no one of them was shown to be worth taking on for a
sub-millisecond-per-tick saving.
