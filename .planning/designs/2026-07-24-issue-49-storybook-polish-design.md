# Design — Issue #49: Polished Storybook

**Issue:** #49 — Polished Storybook: real-capability-driven mock + clear
per-component docs
**Date:** 2026-07-24
**Baseline:** `main` @ `bf0261e`
**Predecessor:** #19 (Storybook workbench, merged as `a47e635` / #40)

## Goal

Make the Storybook workbench a genuinely nice, well-documented reference
whose staged states reflect REAL capabilities — what a reviewer sees in
Storybook matches how components actually behave — and kill the drift
risk banked in #40 (the mock duplicates the core capability/state model
instead of deriving from it).

## Context (verified)

- Storybook lives in `apps/storybook` (`@reely/storybook`, private).
  Config under `apps/storybook/.storybook/`: `main.ts` (globs
  `../stories/**/*.stories.tsx`; addons a11y + vitest; `viteFinal`
  aliases `@reely/*` → `src/`), `preview.tsx` (single global decorator
  `withMockPlayer`; `a11y.test: 'error'`; **no autodocs, no docs
  addon**), `vitest.setup.ts` (determinism guard — asserts zero external
  requests per story).
- 11 stories exist (`apps/storybook/stories/*.stories.tsx`) covering
  `ActivationButton`, `Controls`, `FullscreenButton`, `LoadingIndicator`,
  `MuteButton`, `PipButton`, `PlayButton`, `Poster`, `SeekSlider`,
  `Time`, `VolumeSlider`. Not covered: `Root`, `Viewport`, `Media`,
  `PosterImage`.
- **Two duplication sites** (the #49 target):
  1. `apps/storybook/.storybook/mock-player.tsx` → `createMockAdapter`
     is a stripped copy of the real `createFakeProvider`
     (`packages/react/test/fixtures/fake-provider.ts`). Inert no-op
     `ProviderAdapter`.
  2. `apps/storybook/stories/support.ts` → re-declares `Availability`
     values, a `baseCapabilities` object, and a `ready()` helper —
     duplicating core's `initialCapabilities()` /
     `createInitialPlayerState()`.
- Real contracts all in `packages/core/src/index.ts`: `Availability`
  (`available` | `unknown{reason}` | `unavailable{reason}`),
  `PlayerCapabilities` (9 keys), `PlayerState`, `PreProviderActivation`,
  `createInitialPlayerState()`, `initialCapabilities()`,
  `PlayerController`.
- Data-attribute contract emitted from `packages/react/src/index.tsx`:
  `data-reely-part`, `data-state`, and `data-provider` (on
  capability-gated interactive controls).
- Docs are **greenfield** — no `*.mdx`, no autodocs anywhere.

## Decisions

- **Dedup strategy: core factories as single source, no new package.**
  The drift risk #49 names is the _capability/state model_ ("states that
  can't occur") — that is `support.ts`, not the inert mock adapter.
  Rebuild `support.ts` on core's exported factories/types so story state
  derives structurally from the contract. Reject alternatives: a new
  `@reely/mock-controller` package is scaffolding for a non-problem
  (YAGNI); exporting the test fixture from `@reely/react` grows the
  published surface and risks the bundle harness (#37). Upgrade path if
  ever needed: a private `@reely/test-support` package — not now.
- **Docs: autodocs + hand-written MDX overviews.** Per-component pages
  auto-generate from `argTypes` + JSDoc + stories (low-maintenance,
  always matches source). Cross-cutting content is hand-written MDX.
- **Real-provider stories: out of scope.** The determinism guard asserts
  zero external requests; #49 only says "consider." Real playback stays
  in `apps/docs` (driven by e2e). Noted on the contract page.
- **Coverage:** all 15 public components get autodocs pages. Transport
  primitives get the full treatment; structural components
  (`Root`/`Viewport`/`Media`) + `PosterImage` get lighter pages.

## Architecture

### 1. Single source of truth (mock ← core)

Rewrite `apps/storybook/stories/support.ts`:

- Import from `@reely/core`: `createInitialPlayerState`,
  `initialCapabilities`, and types `Availability`, `PlayerCapabilities`,
  `PlayerState`, `ProviderStatePatch`.
- Thin `Availability` constructors (no re-declared literals):
  - `available()` → `{ status: 'available' }`
  - `unknown(reason)` → `{ status: 'unknown', reason }`
  - `unavailable(reason)` → `{ status: 'unavailable', reason }`
- `withCapabilities(overrides: Partial<PlayerCapabilities>)` — merges
  onto `initialCapabilities()`.
- `ready(overrides?: Partial<PlayerState>)` — builds a
  `ProviderStatePatch` from `createInitialPlayerState()` with
  `lifecycle: 'ready'`, `activation: 'ready'` and the overrides applied.

`apps/storybook/.storybook/mock-player.tsx`: keep the local no-op
adapter (trimmed) — it is inert plumbing, not a capability model. State
comes only via `support.ts` helpers pushed through the real
`PlayerController`.

### 2. Drift-guard test

`apps/storybook/stories/support.contract.test.ts` (TDD — written red):

- **Type-level:** helper outputs `satisfies Availability` /
  `satisfies Partial<PlayerCapabilities>` (compile-time proof of shape).
- **Runtime key/value guard:** every capability key produced by
  `withCapabilities`/`ready` ∈ `Object.keys(initialCapabilities())`;
  every `Availability.status` ∈ the real union; every `reason` valid for
  its status.
- **Reachability:** a `ready()` patch pushed through a real
  `PlayerController.setProvider(mockAdapter)` + `emit` yields the
  expected `PlayerState` — proves the staged state is one the real
  controller accepts.

### 3. Docs infrastructure

- Add `@storybook/addon-docs` (pin `10.5.3`, devDependency only).
- `preview.tsx`: add `tags: ['autodocs']`; configure
  `parameters.docs` (page layout, sorted TOC).
- `main.ts`: extend glob to include `../stories/**/*.mdx`.
- Keep everything devDependency-only; published packages unaffected;
  bundle/packaging checks stay green.

### 4. Per-component docs content

For each transport primitive, via `meta.argTypes` +
`parameters.docs.description.component` (rendered by autodocs):

- Headless usage snippet (composition under `Player.Root`).
- Data contract: `data-reely-part` value, `data-state` values,
  `data-provider` presence.
- a11y / keyboard notes.
- Capability-gating rule (which `Availability` hides/disables it).

### 5. MDX overview pages

- `stories/Introduction.mdx` — workbench intro + story conventions
  (documented for later issues).
- `stories/CapabilitiesMatrix.mdx` — table of component × `Availability`
  state → visible / hidden / disabled, keyed off the real capability
  names from core.
- `stories/Contract.mdx` — `data-reely-part` / `data-state` /
  `data-provider` reference + note that real playback lives in
  `apps/docs`.

### 6. Missing stories

- Add a `PosterImage` story (has `data-reely-part`, visual states).
- Brief autodocs doc blocks for `Root`, `Viewport`, `Media` (structural).

## Testing & verification

- `pnpm test:storybook` green: browser-mode story tests + a11y (`error`)
  - determinism guard (zero external requests) + new drift-guard test.
- `storybook build` renders all MDX without error (runs in CI).
- Full handoff gate: `pnpm format && format:check && lint && typecheck
&& test && test:e2e && build && test:packages && test:bundle &&
test:integrations`.
- pnpm build allowlist stays exactly `sharp@0.34.5` unless a Storybook
  addon legitimately requires an addition (reviewed decision).

## Task / commit boundaries (for the plan)

1. Rewrite `support.ts` on core factories + drift-guard test (red→green).
2. Rewire `mock-player.tsx` to the trimmed adapter + `support` helpers.
3. Enable autodocs infra (addon, `tags`, glob, `preview` config).
4. Enrich each component `meta` (argTypes + descriptions + a11y notes).
5. Add missing stories (`PosterImage`; structural doc blocks).
6. MDX overview pages (`Introduction`, `CapabilitiesMatrix`, `Contract`).
7. CI/verify pass (storybook build + `test:storybook` + full gate).

## Out of scope

- Real-playback demo stories (belong to `apps/docs`). Consolidating
  real playback into Storybook and retiring `apps/docs` is deferred to
  follow-up issue #50 — none of #49's work is wasted if that lands.
- Hosting the static Storybook build.
- Visual regression snapshots.
- Stories for components that don't exist yet.
- Unifying the mock adapter with the contract-test fixture / migrating
  the 244 existing tests.

## Acceptance (from #49)

- [ ] Every transport primitive has an autodocs/MDX page with usage +
      a11y + state-attribute docs.
- [ ] Mock capability/state derives from the real core contracts (no
      duplicated capability model); a drift-guard test exists.
- [ ] Reviewer can see every meaningful + capability-gated state, and the
      docs explain each.
