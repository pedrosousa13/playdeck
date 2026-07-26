# Buffering/stall UX policy (#35) — design

Issue: [#35](https://github.com/pedrosousa13/reely/issues/35). Owner rulings taken 2026-07-26, recorded below at the point they apply.

`LoadingIndicator` shipped in #8 with no policy behind it: it renders whenever `activation === 'loading-provider'` or `state.buffering` is true, undebounced, so a short rebuffer strobes it. This issue owns the policy and its implementation.

`#35` is the last agent-actionable blocker on #18. Its other open blockers are #17 and #32 (both owner/HITL) and #9, which is a stale blocker — the `DefaultPlayer` preset was [deferred out of the MVP](https://github.com/pedrosousa13/reely/issues/1#issuecomment-5078544716).

## What is already true, and is confirmed rather than rebuilt

Measured on `main` @ `d317df7`, not assumed:

- **`LoadingIndicator`** (`packages/react/src/index.tsx:1101-1150`) already distinguishes the two states: `data-state` is `loading-provider` | `buffering` | `idle`, with default children `Loading video` / `Buffering`. Both active states get identical geometry (`position:absolute; inset:0; z-index:30; pointer-events:none`); `idle` is visually hidden but stays mounted so the `aria-live="polite"` region announces the transition rather than mounting already-populated. That idle-geometry split is a #32 ruling and is not revisited here.
- **There is no debounce anywhere.** `grep`-confirmed: the only `setTimeout` in `packages/react/src` is the gesture double-tap timer (`index.tsx:2571`, over the ref declared at `2532`).
- **`SeekSlider`** (`packages/react/src/index.tsx:1567-1638`) does not read `buffering` or `seeking` at all. Its `data-state` is `ready` | `idle`, meaning "is there a seek window" — an axis orthogonal to stalling.
- **`state.buffering` is a raw provider signal.** `waiting` on native (`provider-native/src/index.ts:392`), `bufferstart`/`bufferend` on Vimeo (`provider-vimeo/src/index.ts:546-547`), YouTube player state 3 (`provider-youtube/src/index.ts:494`).

## One measured fact that shapes the design

**Buffered ranges are not a universal fallback.** The tempting cheap answer to "what does the seek slider show during a stall" is _nothing — the playhead freezes at the edge of a buffered range and that tells the story_. It does not, on half the providers:

| Provider | `buffered`                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| native   | Real `TimeRanges` (`provider-native/src/index.ts:316,452`)                                                            |
| hls      | Real — `createNativeProvider` is delegated to (`provider-hls/src/index.ts:280`), so HLS inherits the `<video>` ranges |
| youtube  | **None emitted at all**                                                                                               |
| vimeo    | **Fabricated** single `[{start: 0, end: seconds}]` span from a progress event (`provider-vimeo/src/index.ts:544`)     |

On YouTube the user gets a stopped playhead with no explanation; on Vimeo the ranges are a progress bar wearing a buffer's clothes. So the slider needs an explicit stall signal, not an inferred one.

Fixing the two adapters is the strictly better UX and is **deliberately not done here** — #35 lists "provider-specific buffering quirks" as out of scope, and it would widen the branch into three more packages. Filed as [#91](https://github.com/pedrosousa13/reely/issues/91) instead.

## The policy

This section is what gets mirrored onto the issue to satisfy acceptance criterion 1.

### 1. Initial load and mid-playback stall are distinct states with identical geometry

Two `data-state` values, two default labels, one box. The primitive exposes the distinction; CSS decides whether the two _look_ different:

```html
<div data-reely-part="loading-indicator" data-state="loading-provider">
  Loading video
</div>
<div data-reely-part="loading-indicator" data-state="buffering">Buffering</div>
```

**Why not different geometry** (full-bleed blocking backdrop for initial load, small non-blocking badge for a stall, which is defensible on its own terms): #89 is an open bug about overlay primitives hardcoding geometry past the consumer's `...style`. Baking a second hardcoded layout into `LoadingIndicator` widens exactly the defect that is already filed against it. Geometry belongs to `theme.css` and consumer CSS, which can select on `[data-state="buffering"]` and already have everything they need.

**Why not collapse them into one state**: the core state machine already distinguishes `activation: 'loading-provider'` from `buffering`, and a consumer cannot restyle a distinction the DOM does not carry.

### 2. Debounce: 500 ms show-delay, 500 ms minimum-visible, React-side

**Two timers, not one.** A show-delay alone does not stop flicker — a stall lasting `delay + 50 ms` paints the indicator for 50 ms, and that _is_ the flicker. The floor is what makes any painted indicator legible.

| Timer           | Value  | Meaning                                                                  |
| --------------- | ------ | ------------------------------------------------------------------------ |
| show-delay      | 500 ms | `buffering` must be continuously true this long before anything is shown |
| minimum-visible | 500 ms | once shown, the indicator stays shown at least this long                 |

Consequences, stated as a table because these are the cases the tests assert:

| Stall duration | Painted for |
| -------------- | ----------- |
| 300 ms         | nothing     |
| 700 ms         | 500 ms      |
| 5 s            | 5 s         |

**Why 500/500**: a healthy ABR rebuffer is typically sub-500 ms, so the common case paints nothing at all, while 500 ms stays well under the ~1 s mark where a user loses flow — a genuine stall is still acknowledged promptly. Worst-case latency before a real stall is admitted is 500 ms.

**Why React-side, in the primitive, rather than in core**:

- `state.buffering` stays the raw, truthful provider signal. Analytics and QoE consumers keep it. A debounced `buffering` would silently change the meaning of a shipped public field.
- No new `PlayerState` field, so nothing extra lands in `.changeset/first-prerelease.md`, which #18 already has to reconcile.
- No timer lifecycle in the core state machine. #85 (`hls.js` instance leaked by a second `load()`) shows core disposal is a live leak surface; a core timer would need clearing on `dispose()`, `load()` and the error transition.

**The cost, stated plainly**: a vanilla/headless `@reely/core` consumer does not get this and must write it themselves over `state.buffering`. That is the accepted trade — the MVP ships React primitives, and the raw signal is the honest thing for core to expose.

**Fixed constants, no props.** `CLAUDE.md` rule 2: no configurability that was not asked for. Two public props would also mean two more entries in #18's API reference and two more typechecked doc examples. Add them when someone asks.

### 3. Seek slider during a stall: `data-buffering`, from the same signal

```html
<div
  data-reely-part="seek-slider"
  data-state="ready"
  data-buffering="true"
></div>
```

Driven by the **same debounced hook** as `LoadingIndicator` — same signal, same thresholds, same transitions, so the two move together.

Each component holds its own hook instance rather than sharing one value through context. Both derive from identical state in the same React commit and schedule identical timers, so they agree in every case that occurs in practice. The honest exception: `SeekSlider` renders `null` until the seek capability is available, so a slider that mounts _mid-stall_ starts its own delay from its mount rather than from the stall's start, and can lag the indicator by up to 500 ms once. Sharing through context would close that gap at the cost of new context plumbing in `Root` for a case with no user-visible consequence — not worth it.

A separate attribute, not a third `data-state` value: `data-state` on this part means "is there a seek window", and conflating two orthogonal axes into one attribute makes `[data-state="ready"]` stop matching during a stall, silently breaking every existing consumer rule. Always present with a value (`"true"` | `"false"`), matching the repo's existing convention of `data-state={muted ? 'muted' : 'unmuted'}` over conditionally-omitted attributes.

The slider is **not** disabled during a stall. Seeking away is the main thing a user does to escape one.

## Four rulings the three questions do not cover, which the implementation forces

These are not in #35's question list, but the state machine cannot be written without deciding them. They are policy, so they are recorded here and on the issue.

1. **The show-delay applies to `buffering` only.** `loading-provider` shows immediately — there is nothing on screen yet, so there is nothing to flicker against.

2. **An already-visible indicator swaps its label with no delay.** `loading-provider → buffering` is a common transition (the provider becomes ready and immediately buffers its first segment). Re-running the show-delay across it would hide the indicator for 500 ms and bring it back — manufacturing the exact flicker this policy exists to remove.

3. **The minimum-visible floor applies to any visible period, including `loading-provider`.** A fast provider load (warm cache, native provider) otherwise strobes the indicator for ~50 ms, which is the same defect wearing a different state name. A policy that says "no flicker" but exempts one of its two states is incoherent, and the carve-out costs _more_ code than uniformity — two paths instead of one.

   **Cost, stated plainly**: on a fast load the indicator holds ~450 ms longer than the provider needs, over media that is already playing underneath. This is muted in practice because the primitive paints no background of its own — `theme.css` sets only `color` on this part (`packages/react/theme.css:98`) — so what holds is the consumer's spinner, not a scrim. A consumer who wants the loading state gone the instant the provider is ready can read `activation` directly via `usePlayerState`.

4. **A terminal activation error hides the indicator immediately, overriding both timers.** Already asserted by `packages/react/test/activation.test.tsx:1360`; the floor must not be allowed to hold "Buffering" on top of `ErrorDisplay`.

## Architecture

One module-private hook, two consumers. The hook is **not exported** from `@reely/react` — it is an implementation detail, not public API, so it adds nothing to #18's documentation surface.

```
usePlayerState({activation, buffering})   ← raw core state, unchanged
              │
              ▼
    useLoadingPresentation()              ← module-private, packages/react/src/index.tsx
      returns 'loading-provider' | 'buffering' | null
              │
      ┌───────┴────────┐
      ▼                ▼
LoadingIndicator    SeekSlider
 data-state          data-buffering
```

### State machine

`desired` is derived synchronously from state; `shown` is what the DOM carries.

```
desired =
  activation === 'error'             -> null                 // ruling 4
  activation === 'loading-provider'  -> 'loading-provider'
  buffering                          -> 'buffering'
  otherwise                          -> null

on (activation, desired, shown, floorExpired) change:

  activation === 'error'
    -> clear both timers; shown = null; floorExpired = true   // immediate, ruling 4

  desired !== null
    clear the pending show timer
    shown !== null   -> shown = desired                       // ruling 2, no delay
    desired === 'loading-provider' -> show(desired)           // ruling 1, immediate
    desired === 'buffering'        -> show after 500 ms       // reset if desire lapses

  desired === null
    clear the pending show timer
    shown === null   -> nothing
    floorExpired     -> shown = null
    otherwise        -> nothing; the floor timer's expiry re-runs this effect

show(next):
  shown = next; floorExpired = false; floor timer -> floorExpired = true after 500 ms
```

The floor timer is **not** restarted by a label swap (ruling 2) — it bounds the visible _period_, not the label. Both timers are cleared on unmount.

`buffering` while `activation` is `dormant`/`eligible` keeps today's behaviour (it shows), because today's condition is `activation !== 'error' && buffering`. Not changed, not tested beyond what already exists.

## Red first

Every test below is watched fail before the implementation exists, and the _reason_ it fails is checked — a test that passes its own red step for the wrong reason is a fake-green, and this repo has shipped two of them (`.superpowers/sdd/progress.md`, session 2026-07-26).

Unit tests, `packages/react/test/activation.test.tsx`, with `vi.useFakeTimers()`:

1. A 300 ms `buffering` pulse never reaches `data-state="buffering"`. **Red for the right reason**: without the delay it flips immediately.
2. A sustained `buffering` reaches `data-state="buffering"` at 500 ms and not at 499 ms. The asymmetry is the assertion — a test that only checks 500 ms cannot fail if the delay is 0.
3. `buffering` true for 700 ms then false: still shown at 700 ms, hidden at 1000 ms. Pins the floor.
4. `loading-provider → buffering` swaps the label with no intervening `idle` frame (ruling 2).
5. `loading-provider` for 100 ms then `ready` holds the indicator to 500 ms (ruling 3).
6. Terminal error while the floor is running hides immediately (ruling 4) — an extension of the existing test at `activation.test.tsx:1360`.
7. Timers are cleared on unmount: unmounting mid-delay fires no state update.
8. `SeekSlider` carries `data-buffering="false"`, then `"true"` on the same schedule as the indicator, from the same signal.

The 500 ms values are hardcoded in the tests rather than imported from the source, deliberately: that pins the policy, so changing the constant breaks the test instead of silently moving with it.

Storybook stories cover the rendered states, not the timing (timing is not drivable through `parameters.player.state`, which the decorator emits once at mount — `apps/storybook/.storybook/mock-player.tsx:104`).

## Existing tests this change breaks, and why that is correct

Three assertions currently depend on the undebounced behaviour. Each is updated, none is deleted — the subject of the assertion changed, so the assertion moves with it.

| Location                                                     | What breaks                                                                                                         | Fix                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `packages/react/test/activation.test.tsx:1352-1357`          | emits `buffering: true`, then synchronously expects `data-state="buffering"`                                        | advance 500 ms before asserting           |
| `packages/react/test/activation.test.tsx:1419-1435`          | same, plus `emit({buffering:false})` then synchronously expects `idle`                                              | advance past both the delay and the floor |
| `apps/storybook/stories/loading-indicator.stories.tsx:55-72` | mounts with `buffering: true`; `waitFor` still resolves at ~500 ms inside its 1000 ms default, so it passes on luck | give `waitFor` an explicit timeout        |

`activation.test.tsx:1360` (terminal error) keeps passing unchanged, which is the ruling-4 check.

## Theme

**One** rule in `packages/react/theme.css`, inside `@layer reely` and `:where()`-wrapped for specificity zero, as `packages/react/test/theme.test.ts` enforces: `[data-buffering='true']` on `seek-slider` dims the buffered ranges, so a stall reads on the slider in the shipped theme.

No companion rule for `loading-indicator[data-state='buffering']`. The theme sets only `color` on that part (`theme.css:98`) and policy 1 forbids new geometry, so a second rule would have nothing meaningful to declare — an empty rule is noise, not a contract.

**Motion-free.** A pulse would be the obvious choice and is deliberately avoided: it would need a `prefers-reduced-motion` carve-out, and #32's WCAG work has just landed. A static opacity change carries the same information with no reduced-motion surface.

## Documentation

- `LoadingIndicator` and `SeekSlider` doc comments in `packages/react/src/index.tsx` state the policy and both thresholds.
- `apps/storybook/stories/Contract.mdx` — `data-buffering` added to the `seek-slider` contract row.
- A buffering/stall section stating the two thresholds and that `state.buffering` stays raw for consumers who want the undebounced signal.

## Out of scope

- **Provider `buffered` gaps** — YouTube emits none, Vimeo fabricates. Real UX debt, explicitly out of scope per #35 ("provider-specific buffering quirks"). Filed as [#91](https://github.com/pedrosousa13/reely/issues/91).
- **Live-edge stall behaviour** — #14.
- **Auto-hide** — was preset-scoped, dropped with #9's deferral. No primitive implements it (`grep autoHide packages/react/src` is empty).
- **Configurable thresholds as props** — see policy 2.
- **Debouncing in `@reely/core`** — see policy 2.

## Verification

`#35`'s own verification line is `pnpm --filter @reely/react test && pnpm test:e2e -- --grep "buffer|stall"`. The e2e half is wrong for this repo: Playwright's `--grep` matches file paths as well as titles, and there is no buffering e2e spec to match, so it selects nothing and exits green having proven nothing. The real gate is the root suite.

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm test:storybook && pnpm build && pnpm test:budgets
git diff --name-only main...HEAD | xargs npx prettier --check --ignore-unknown
```

Format check caveats, measured in prior sessions: it is a commit-range diff so it cannot see uncommitted edits — commit first, then check. `--ignore-unknown` is required because a `.vtt` fixture is in the tree. Do not run repo-wide `pnpm format:check` locally; it warns on gitignored `.planning/**`. Run every gate unpiped and read the exit code — a pipe has produced a false green here.

## What changed during implementation

Four things the design did not anticipate. All are recorded here rather than only in commit messages, because each is a decision a reviewer should be able to disagree with.

**1. The state machine moved out of the effect.** The design's machine called `setShown` synchronously inside an effect body. `react-hooks/set-state-in-effect` rejects that shape, and correctly: every branch is a conclusion that follows directly from the state just read, so an effect only adds a wasted commit. The adjustment now happens **during render**, with each branch guarded so it is a no-op once applied and converges in one extra pass before paint. Effects schedule the two timers and do nothing else. Behaviour is identical — the same tests pass, and each still fails when its mechanism is removed.

**2. Ruling 3 has a wider blast radius than the design's table showed.** Holding `loading-provider` for 500 ms means _any_ test that clicks activation and then asserts `idle` now has to wait. The design's "Existing tests this change breaks" table listed three; the real count was six, plus every new test's own setup, which has to drain the provider-load floor before it can exercise a stall from a hidden indicator. This is the cost of ruling 3 landing where the design said it would, not a surprise in kind — but the design understated it.

**3. `a11y-media.spec.ts` needed a narrow exclusion, not a moved window.** That test observes every live region during playback and asserts silence. Its window starts after `played()`, deliberately excluding `LoadingIndicator`'s `'loading-provider'` → idle transition, which its own comment already classifies as a legitimate announcement. The floor moves that transition later, into the window.

The window is **not** moved to dodge it: its start point is load-bearing, because the `installedAt < cueBoundary` guard proves the 0.4 s cue transition is still ahead of the observer, and waiting out the floor first would advance `currentTime` past that boundary and silently drop the cue coverage the test exists to hold. Instead the exact string `'loading-indicator: '` is excluded and bounded to one occurrence. A spurious `loading-indicator: Buffering`, an indicator announcing idle twice, and every time-update or cue leak all still fail. The test's second phase clears the announcement buffer before the captions click, so its "exactly one announcement" assertion is measured over that click alone.

**4. One planned test was written toothless and had to be rewritten.** "Ignores a rebuffer shorter than the show delay" originally asserted only the state _after_ the rebuffer cleared — which is `idle` with or without a debounce, so it passed against the very bug it named. Caught at its red step, where it failed to fail. It now asserts _inside_ the 300 ms window. Every timing behaviour here was subsequently falsified by breaking its mechanism and watching the specific test fail: show-delay → 0, floor → 0, and the terminal-error override deleted.
