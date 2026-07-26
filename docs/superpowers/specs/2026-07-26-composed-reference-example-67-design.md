# One composed reference example, exercised in CI (#67)

Design, 2026-07-26. Parent: #1. Unblocks: #32.

**Blocked on** #81, the quality-enumeration gap (see [Dependency](#dependency)),
which lands as its own spec and PR first.

## Why this exists

The `DefaultPlayer` preset was deferred out of the MVP. The preset was the
mechanism that proved the primitives are sufficient — built only from public
parts, so a missing public part became a filed gap rather than a private hook.
Without it, "the primitives are sufficient" ships unproven, and criterion 8 of
#1 ("every public API documented with a runnable example") carries the weight.

The failure mode is not hypothetical. #15 shipped `MediaProps` without
`children`, so consumers had no way to declare a `<track>`; native caption
discovery was unreachable from the public React API despite full unit coverage
and a passing review. It surfaced only when an e2e used the API the way a
consumer would.

This design already earned its keep before a line of code: composing a settings
menu revealed that nothing in public state enumerates selectable qualities. See
[Dependency](#dependency).

## Home and shape

`apps/storybook/stories/reference/` — three files:

| File                    | Role                                        |
| ----------------------- | ------------------------------------------- |
| `reference-player.tsx`  | The composition. Exports `ReferencePlayer`. |
| `reference.stories.tsx` | The two mountings below.                    |
| `Reference.mdx`         | The docs page criterion 8 cites.            |

Storybook is the home. There is no `apps/docs` in the repo, and Storybook is
already both the docs surface and a Playwright fixture host, which is what the
issue asks for: documentation and a test target in one place.

One component, two mountings, so there is a single composition rather than two
that drift:

- **`Reference/Player → Composition`** — under the existing mock decorator
  (`apps/storybook/.storybook/mock-player.tsx`), capabilities dialed fully
  available through `ready({...})` from `stories/support.ts`. Runs in the story
  test suite; axe is already global via `preview.tsx` (`a11y test: 'error'`).
  This is the artifact #32 points axe and its keyboard flows at.
- **`Reference/Player → RealSources`** — tagged `real-playback` and `!test`, so
  the mock decorator steps aside (`mock-player.tsx` returns the bare story for
  the `real-playback` tag). Renders its own `Player.Root` with the source
  switcher. This is what Playwright drives.

**Known trap, resolved up front.** The mock decorator's `mockSource` is
`mock://reely/video.mp4`, and its comment states that stories do not render
`Player.Media`. This composition does. Story 1 therefore overrides
`rootProps.source` to the local `/tracer.mp4`: the media layer is real and
local, no network, and the fake adapter still owns every bit of player state.

## What it composes

Inside `Player.Viewport`:

- `Poster` wrapping `PosterImage`
- `Media`
- `Captions`
- `LoadingIndicator`
- `ErrorDisplay`
- `ActivationButton`
- `Gestures`
- `Controls`, in two rows:
  - row 1 — `Time type="current"`, `SeekSlider`, `Time type="duration"`
  - row 2 — `PlayButton`, `MuteButton`, `VolumeSlider`, spacer,
    `CaptionsButton` + `CaptionsMenu`, `SettingsMenu`, `PipButton`,
    `AirPlayButton`, `FullscreenButton`

### Icons are supplied by the example, not by the primitives

Every button receives an icon child from `@reely/react`'s icon exports
(`PlayIcon`, `PauseIcon`, `MutedIcon`, …). No text-label fallback is rendered
anywhere in the example.

The primitives keep their text fallback (`index.tsx:1435`,
`children ?? (isPlaying ? 'Pause' : 'Play')`). They are not changed by this
issue. Supplying icon children _is_ composition from public parts, which is the
thing being proved; and defaulting to icons would make every icon a static
dependency of every button, undoing the opt-in tree-shakeability that #31 task 2
established.

Accessible names are unaffected either way: they come from `aria-label` on the
button (`index.tsx:1418`), not from the child. The `Reference.mdx` page states
plainly that icons are the consumer's job and points at this example as the
runnable proof.

### The settings menu

Two `MenuRadioGroup`s inside `SettingsMenuContent`:

- **Playback rate** — 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2. These are constants the
  consumer picks; nothing needs to enumerate them. Driven by
  `usePlayerActions().setPlaybackRate`, gated on the `setPlaybackRate`
  capability.
- **Quality** — driven by the state field added by the dependency below, gated
  on the `selectQuality` capability.

## Source switcher

Story 2 switches between four sources:

| Label   | Source                                                       |
| ------- | ------------------------------------------------------------ |
| MP4     | `/tracer.mp4`                                                |
| HLS     | `{ type: 'hls', src: '/hls/master.m3u8', engine: 'hls.js' }` |
| YouTube | `https://www.youtube.com/watch?v=M7lc1UVf-VE`                |
| Vimeo   | `https://vimeo.com/76979871`                                 |

It changes the `source` prop rather than remounting `Root`. The swap path is
where #15-class bugs live, so the reference example should walk it rather than
sidestep it with a `key`.

Capability gating becomes visible rather than hidden. `AirPlayButton` and
`PipButton` genuinely disappear on the iframe providers — `provider-vimeo`
and `provider-youtube` hard-code `airPlay` unavailable — and that is the
primitives' central promise being demonstrated, not a defect to paper over.

## Layout

The layout CSS lives in the example, not in `@reely/react/theme.css`. The theme
stylesheet is applied unmodified; #10's decisions and its 6 KB budget are
untouched. The library stays unopinionated about layout, and the example
documents one way to lay controls out.

Two rows, wrapping button row, volume slider dropped below a ~420px breakpoint.
The composition must stay usable at 320px CSS width, so #32's reflow check
(WCAG 2.2 AA, 1.4.10) passes by construction rather than being discovered later
on the very artifact #32 is pointed at.

This is also the answer to the `Theme/Theme → Default` clipping defect
(`theme.stories.tsx:27-33` admits the row overflowed by 49px at 480 once
`AirPlayButton` made it six buttons). Fixing `Theme/Theme` itself is **not** in
scope here; if it still reads badly after this lands, it is a follow-up.

## Enforcing "public exports only"

A `no-restricted-imports` block in `eslint.config.js`, scoped to
`apps/storybook/stories/reference/**`. Allowed: `react`, `@reely/react`,
`@reely/core`, the Storybook packages, and same-directory relative files.
Rejected: any `../` escape, any specifier containing `packages/`, and any
`@reely/*/src/*` subpath.

This mirrors the `e2e/**` `no-restricted-syntax` block at `eslint.config.js:41`
and runs inside the existing `static` gate, so a violation fails at authoring
time. Convention has already failed twice (#15, #73); the lint rule is the
guard.

**The rule is verified with a probe file, red then green.** #73's rule shipped
accepting `exact: false` on its first attempt because it only tested for the
presence of the key — a lint rule that has never been seen to fail is worth
nothing.

**Stated limitation, recorded in `Reference.mdx`.** Storybook aliases
`@reely/react` to `packages/react/src/index.tsx` (`.storybook/main.ts:85`), so
this rule proves specifier hygiene, not that the _packed_ entry exports what the
example touches. That side is already covered: `attw` and `publint` in
`test:packages`, plus `packages/react/test/theme.test.ts` asserting the exports
map.

## Exercised in CI

- **Story tests.** Story 1 runs in `pnpm --filter @reely/storybook test`, with
  axe on it globally.
- **e2e.** A new `e2e/reference.spec.ts` drives story 2. The MP4 and HLS legs
  are in the blocking suite: activate, play, seek, mute, toggle captions,
  change playback rate, then swap MP4 → HLS and assert the controls are still
  live. The YouTube and Vimeo legs are tagged `@real` and stay `grepInvert`'d
  out of CI, as the existing `@real` specs are.

  This keeps the composition CI-exercised without importing the network flake
  the ledger has already characterised (under CPU saturation the failures land
  in `vimeo`/`youtube`/`hls`, never in captions).

- **Locators.** All lookups go through `e2e/locators.ts` and
  `[data-reely-part=...]`, per #73. Note that adding controls to a shared
  fixture is what broke five specs on WebKit only, so this spec adds its own
  story rather than extending `PlayerFixture`.

## Testing strategy

Red first, per the repo's practice.

- Unit: none new. This issue adds no library code.
- Story tests: the composition renders every listed control with its icon; the
  settings menu opens, and selecting a rate changes it; captions toggle;
  keyboard flow from the play button through the control row.
- e2e: the flows listed above, on chromium/firefox/webkit.
- Lint: the probe file proving the import rule rejects a `../` escape and a
  `packages/` path, and accepts `@reely/react`.

## Acceptance criteria (from #67)

- [ ] The example composes the listed controls using only public exports.
- [ ] Any primitives gap found while building it is filed as its own issue and
      fixed before this closes. — one found, see below.
- [ ] It runs in CI: story tests pass, and at least one e2e drives it end to
      end.
- [ ] #32 can point axe and its keyboard flows at it.
- [ ] Referenced from the docs so criterion 8 has something to cite.

## Dependency

**#81 — public state does not enumerate selectable qualities.**

`PlayerState.quality` (`packages/core/src/index.ts:111-115,149`) is the
_current_ quality only — `height`, `width`, `bitrate`.
`selectQuality(height: number | null)` accepts a height, but nothing public
tells a consumer which heights exist. hls.js knows them
(`packages/provider-hls/src/index.ts:68`, `levels`) and never surfaces them.

A quality menu therefore cannot be built from public exports. This is the same
class of gap as #15's missing `MediaProps.children`, and it is exactly what this
issue exists to catch.

It is filed as #81 and lands as its own spec and PR **before** #67, so
the API is designed on its own terms — whether it keys on height, whether `auto`
is a member of the list, how the iframe providers map — and #67's diff stays
about composition.

## Out of scope

- The `DefaultPlayer` preset (#9). This is an example, not a shipped component.
- Changing the primitives to default to icon children.
- Theme CSS beyond applying the stylesheet #10 already merged.
- Fixing `Theme/Theme`'s own clipping defect.

## Verification

```sh
pnpm --filter @reely/storybook test && pnpm test:e2e
```

Plus the full gate set, unpiped: `typecheck`, `lint`, `prettier --check` on
changed files only (repo-wide `format:check` fails locally on gitignored
`.planning/**`), `test:packages`, `test:budgets`.
