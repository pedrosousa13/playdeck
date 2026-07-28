# Issue #19: Storybook Workbench + Story-Based Component Tests Design

**Status:** Approved design
**Issue:** [#19 — Storybook workbench + story-based component tests](https://github.com/pedrosousa13/reely/issues/19)
**Depends on:** #6 and #7, both merged on `main` (`0aba39a`)
**Storybook version:** `10.5.3` exact, verified as stable `latest` on npm for
`storybook`, `@storybook/react-vite`, `@storybook/addon-vitest`, and
`@storybook/addon-a11y` on 2026-07-23.

## Goal

Stand up Storybook as the component workbench and make every story a real
browser test, so later visual issues (#8, #9, #10, #15) add stories as part
of their own acceptance criteria instead of retrofitting.

Two governing rules from the issue:

1. **Stories are tests.** The Vitest addon runs every story as a Vitest
   browser-mode test (Playwright-driven) including an axe check. `play`
   functions are the interaction-test layer for single-component semantics.
2. **No real media.** All playback-dependent states are dialed through a mock
   controller decorator built on the same fake provider surface the contract
   tests use. Stories are deterministic and instant: no network, no media
   files, no provider SDKs.

## Placement

- New workspace app `apps/storybook`, private package `@reely/storybook`.
  All Storybook, vitest-browser, and axe dependencies live in its
  `devDependencies`. Published packages (`@reely/core`,
  `@reely/provider-native`, `@reely/react`) are untouched: no new
  dependencies, `files: ["dist"]` unchanged, bundle checks stay green.
- Stories are colocated with components:
  `packages/react/src/*.stories.tsx`, globbed from the app's `main.ts`
  (`../../packages/react/src/**/*.stories.tsx`). Colocation is the
  convention later issues follow. Story files are excluded from the react
  package build output (they are not imported by `src/index.tsx` and the
  Vite library build only bundles the entry graph; `tsc -b` excludes them
  via the package tsconfig so declaration output is unaffected).

## Mock controller decorator

### Seam

The provider-loader seam (`packages/react/src/provider-loaders.ts`) stays
private, exactly as the #7 design requires. The Storybook app's Vite config
(`viteFinal` in `main.ts`) substitutes it with
`apps/storybook/src/mock-provider-loader.ts` via a Vite alias, and aliases
`@reely/react`, `@reely/core`, and `@reely/provider-native` to package
source, mirroring the root `vitest.config.ts`. Because the substitution is
at the Vite level, it applies identically in `storybook dev`,
`storybook build`, and the vitest browser-mode test run (the addon reuses
the Storybook Vite config).

### Scenario store

`mock-provider-loader.ts` exports the same `loadProvider` signature backed
by a module-level scenario store:

- `resolve` (default): returns a `createFakeProvider()` adapter — the
  existing fixture at `packages/react/test/fixtures/fake-provider.ts`,
  imported directly — then applies any scripted `emit()` patches so stories
  can dial post-ready playback states (paused, playing, buffering,
  blocked-autoplay, capability sets).
- `pending`: the loader promise never settles → activation holds at
  `loading-provider`.
- `reject`: rejects with a deterministic error → activation `error`.

The store records the live fake-provider handle so `play` functions can
`emit()` further patches mid-test.

### Decorator

`withMockController` (in `apps/storybook/src/`) reads
`parameters.reely = { rootProps, scenario }`:

- resets the scenario store before render (stories stay independent),
- wraps the story in `<Player.Root {...rootProps}>` with a stable inline
  source (`/media/sample.mp4`) and a default `preload="none"` — `Media`
  renders `<source>` children once eligible, so `preload="none"` (real Root
  behavior forwarded to `<video>`) is what keeps the browser from fetching
  the source; the fake adapter never calls `load()`,
- renders the story's children inside real Root/Viewport wiring.

Pre-provider activation states come from real strategy behavior, not
shortcuts:

- `dormant`: `loading="interaction"`, no click yet.
- `eligible`: `loading="interaction"`, clicked, with `Player.Media` omitted
  so no media mount exists and the loader never starts — activation holds
  at `eligible` deterministically.
- `loading-provider`: interaction click with a `pending` scenario.
- `error`: interaction click with a `reject` scenario.

## Stories

One story per meaningful state, colocated in `packages/react/src/`:

- `poster.stories.tsx` — `Player.Poster` + `Player.PosterImage`:
  - `idle`: no `src`/`srcSet`.
  - `loading`: `src` pointing at a same-origin hanging endpoint
    (`/__reely/hang.png`) served by a tiny shared Vite middleware plugin —
    the request never completes, so `data-state="loading"` holds
    deterministically with zero external requests.
  - `loaded`: inline data-URI image (instant, memory-only).
  - `error`: structurally invalid data URI → deterministic `onError`.
  - custom-child poster: `Player.Poster` with arbitrary JSX children.
- `activation.stories.tsx` — `Player.ActivationButton` in `dormant`,
  `eligible`, `loading-provider`, `error`; plus the reference
  **play-function story**: click the activation button, assert the
  `data-state` transition (`dormant` → `loading-provider` under a `pending`
  scenario). This story is the documented interaction-test pattern.
- `loading-indicator.stories.tsx` — `Player.LoadingIndicator` in
  `loading-provider` (pending scenario) and `buffering` (resolve scenario +
  buffering patch emitted).

The hanging-endpoint plugin lives in `apps/storybook/src/` and is
registered once in `viteFinal`, so dev, build preview, and vitest modes
share it. (`storybook build` output does not need the endpoint — static
hosting is out of scope; only build success is required.)

## Test integration

- `@storybook/addon-vitest` with `@vitest/browser-playwright` (Chromium).
  CI already installs Playwright browsers. All addon/browser packages pin
  compatible versions in `apps/storybook` devDependencies; verified peer
  ranges: addon-vitest accepts vitest `^4`, react-vite accepts vite `^8`
  and react `^19`.
- `apps/storybook/vitest.config.ts` uses the Storybook project plugin so
  every story becomes a browser-mode test.
- `@storybook/addon-a11y` with `parameters.a11y.test = 'error'` set
  globally in `preview.ts`: axe violations fail the test run for every
  story.
- **No-external-request proof:** a global `afterEach` in the vitest setup
  asserts every `performance.getEntriesByType('resource')` entry is
  same-origin, and separately that no entry matches the decorator's
  `/media/sample.mp4` source (same-origin checks alone would not catch
  it). This covers all stories, not a sentinel story.

## Scripts and CI

- `apps/storybook` scripts: `dev` (`storybook dev`), `build`
  (`storybook build`), `test` (`vitest run` with the app config).
- Root `test:storybook`: `pnpm --filter @reely/storybook test`.
- Root `pnpm build` (`pnpm -r --if-present run build`) picks up the app's
  `build` automatically, so the existing CI `pnpm build` step satisfies
  "`storybook build` succeeds in CI" with no extra step.
- CI verify chain gains `pnpm test:storybook` (appended after
  `test:bundle`, before `test:integrations` order is not significant —
  appended at the end for clarity).
- Root `pnpm test` is unchanged (fast, happy-dom). Story tests are a
  separate serial step, consistent with the repo's serial-verification
  practice.

## Conventions documentation

`apps/storybook/README.md` documents, for later issues:

- stories live next to their component (`packages/react/src/*.stories.tsx`),
- one story per meaningful state,
- how `parameters.reely` scenarios dial `PlayerState`,
- the play-function pattern with a pointer to the reference story,
- how to run (`pnpm --filter @reely/storybook dev`, `pnpm test:storybook`),
- the no-network rule and the a11y gate.

## Dependency policy

- Every Storybook package pinned exact `10.5.3`; vitest-browser packages
  pinned exact to versions compatible with `vitest@4.1.10`.
- pnpm `allowBuilds` true-entries stay exactly `sharp@0.34.5`. If any new
  dependency requests an install script, that is surfaced as a reviewed
  decision — not auto-allowed.
- **Reviewed decision (2026-07-23):** Storybook introduces transitive
  `esbuild@0.28.1`, whose install script pnpm blocks. Declined explicitly
  (`esbuild: false` under `allowBuilds`): esbuild's platform binary ships
  as an optional dependency and the postinstall only swaps a JS shim for
  the binary, so declining is safe; `storybook build` succeeding is the
  proof. No new build scripts are allowed.

## Alternatives rejected

### Public injection prop on `Player.Root`

Rejected: the approved #7 design forbids any public loader registry,
mutation function, or test-only prop.

### Decorator bypassing Root with a hand-built context

Rejected: stories would stop exercising real Root wiring, so
stories-as-tests would no longer test the integration they render, and it
would require exporting private context.

### Storybook colocated inside `packages/react`

Rejected: adds the Storybook dependency tree to a published package's
manifest and mixes workbench tooling into a library package. Colocated
_stories_ with an app-owned _config_ keeps both benefits.

## Success criteria

- `storybook dev` shows every listed poster, activation, and
  loading-indicator state, dialed without network or media.
- `pnpm test:storybook` runs every story as a Chromium browser test with an
  axe check; the play-function story asserts a real state transition.
- The no-external-request assertion passes for every story.
- `pnpm build` (including `storybook build`) and the full verification gate
  stay green; bundle checks unchanged.
- CI runs story tests and the static build.
- `apps/storybook/README.md` lets #8/#9/#10/#15 add stories without
  rediscovering conventions.
