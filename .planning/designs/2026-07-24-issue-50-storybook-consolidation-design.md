# Design — Issue #50: Consolidate real-playback into Storybook, retire apps/docs

**Issue:** #50 — Consolidate real-playback into Storybook, retire apps/docs
**Date:** 2026-07-24
**Baseline:** `main` @ `6375ccc` (after #49 merged)
**Depends on:** #49 (autodocs/MDX infra, mock←core) — merged.

## Goal

One front-facing surface. Storybook shows real-video playback (real
providers, real `<video>`) alongside the existing mock states, docs, and
tests. `apps/docs` is retired. The determinism that keeps the mock story
suite fast and non-flaky is preserved by keeping real-network stories out
of that suite.

## Why the split exists today (the one real reason)

Storybook runs every story as an automated Vitest browser test, and
`apps/storybook/.storybook/vitest.setup.ts` enforces **zero external
requests per story** (asserts `externalRequests == []` across fetch,
resource-timing, and DOM src/srcset/href in `afterEach`). That guard is
what makes the story suite deterministic and offline-safe. Real playback
(HLS segments, YouTube/Vimeo SDKs) needs the network, so it lives in
`apps/docs` (Playwright e2e, real network allowed) instead. Nothing
fundamental forces two apps — real stories just have to opt out of the
zero-network suite.

## Migration surface (verified)

- **`apps/docs/src/main.tsx`** (1027-line SPA): a top `<PlayerFixture>`
  (primary e2e target) + `<YouTubeExample>` + doc prose. Source selection
  via `URLSearchParams`: `?source=hls|live|vimeo|vimeo-unlisted|https://…`,
  `?engine=native|hls.js`, `?activationSource=youtube|external`,
  `?autoplay`, `?loading`, `?preload`, `?defaultMuted`, `?airplay=demo`,
  `?sourceChange=external`. Default source `/tracer.mp4`.
- **e2e contract the fixture exposes:** `window.playdeckHandle` (global
  `PlayerHandle`), testids `viewport`, `youtube-example`,
  `presentation-capabilities` (+ `fullscreen-toggle`, `pip-toggle`,
  `airplay-picker`), `live-panel` (+ `live-indicator`, `live-time`,
  `live-seek-back`, `live-seek-edge`), `hls-engine`, `error-category`,
  and rich `data-*` state attributes.
- **Fixtures** `apps/docs/public/`: `poster.svg`, `tracer.mp4`,
  `hls/master.m3u8`, `hls/v0|v1/prog.m3u8` + `seg_000.ts`, `hls/subs/*`.
  `live/*` is synthesized at request time by the plugin. e2e-side:
  `e2e/fixtures/vimeo-embed.html`.
- **`apps/docs/live-playlist-plugin.ts`** — `liveHlsFixture()` Vite
  plugin. Serves a wall-clock sliding-window live `.m3u8`
  (`/live/index.m3u8`) and `/live/seg_N.ts` (replays `hls/v0/seg_000.ts`).
  Hooks BOTH `configureServer` and `configurePreviewServer` — same
  dual-hook pattern as Storybook's existing `pendingAssetPlugin`.
- **`apps/docs/vite.config.ts`** — `plugins: [react(), liveHlsFixture()]`,
  aliases all six `@playdeck/*` to `packages/*/src`.
- **`playwright.config.ts`** — `baseURL http://127.0.0.1:4173`, 3 browser
  projects; `webServer.command = vite preview apps/docs --host … --port
4173 --strictPort` (serves the docs preview build);
  `grepInvert: /@real/` unless `PLAYDECK_REAL_PROVIDERS=1`. All `page.goto`
  use root-relative paths. 11 specs: `native-mp4`, `autoplay`,
  `activation`, `poster`, `platform`, `hls`, `live`, `youtube`,
  `youtube-real` (`@real`), `vimeo`, `vimeo-smoke` (`@real`).
- **Storybook current:** `preview.tsx` global `withMockPlayer` decorator
  - `tags: ['autodocs']` + `a11y.test: 'error'`. `main.ts` viteFinal
    aliases `@playdeck/*` to source + `pendingAssetPlugin`. No `!test` opt-out
    tag exists yet.
- **Root/CI:** `test:e2e = turbo run build --filter=@playdeck/docs &&
playwright test`. `ci.yml`: `e2e` matrix job runs `test:e2e`;
  `hls-paths` job path-filters on `apps/docs/`; `hls-native-webkit`
  (macOS) runs `test:e2e --project=webkit --grep hls`; `storybook` job
  builds+tests storybook. `@playdeck/docs`/`apps/docs` referenced only in
  `apps/docs/`, root `package.json` (`test:e2e`), and `ci.yml`
  (`hls-paths` filter) — contained retirement surface.

## Decisions

- **Opt-out via tags, not a separate app.** Real-playback stories carry
  `tags: ['real-playback', '!test']`. `!test` removes them from the
  addon-vitest run (zero-network guard + a11y). A guard test asserts every
  `real-playback` story also has `!test` — no leak into the deterministic
  suite.
- **Tag-gated mock decorator.** `withMockPlayer` passes the story through
  untouched when `context.tags` includes `real-playback` (real stories
  render their own `Player.Root`); all existing mock stories are
  unaffected (they are not tagged `real-playback`).
- **e2e runs against `storybook dev`, not a static preview.** The
  live-HLS middleware and source aliases live in viteFinal, which
  `storybook dev` runs (a plain static file server would 404
  `/live/index.m3u8`). `storybook dev` serves `/iframe.html` and allows
  real network — the correct e2e target. Consistent with today: docs e2e
  already ran against source-aliased builds.
- **Recreate `PlayerFixture` as a story, mapping query→args.** A single
  `Fixtures/PlayerFixture` story reproduces the docs fixture's testids +
  `window.playdeckHandle` + arg-driven source selection, so specs retarget by
  rewriting `goto('/?source=hls&engine=hls.js')` →
  `goto('/iframe.html?id=fixtures-playerfixture--default&viewMode=story&args=source:hls;engine:hls.js')`.
- **Delete `apps/docs` LAST**, only after retargeted e2e is green in CI
  across all browsers. Fail-safe: if e2e migration stalls, ship steps 1–5
  (real stories visible in Storybook) and defer deletion.
- **Keep the mock suite exactly as is.** No change to existing per-primitive
  stories, `support.ts`, the drift guard, or the zero-network guard's
  global behavior (it simply never sees `!test` stories).

## Architecture

### A. Story-suite opt-out mechanism

- `withMockPlayer` (`.storybook/mock-player.tsx`): early-return
  `<Story/>` when `context.tags?.includes('real-playback')`.
- New guard test `stories/real-playback.contract.test.ts`: load the
  Storybook story index (or import the real-playback story modules) and
  assert every story tagged `real-playback` is also tagged `!test`.

### B. Fixtures + live plugin in Storybook

- Move `apps/docs/public/*` → `apps/storybook/public/` (or a
  `staticDirs` entry in `main.ts`).
- Port `live-playlist-plugin.ts` → `apps/storybook/.storybook/` and add
  `liveHlsFixture()` to viteFinal `plugins` (alongside
  `pendingAssetPlugin`). Confirm it serves `/live/index.m3u8` +
  `/live/seg_N.ts` in `storybook dev`.

### C. Real-playback showcase stories

`stories/real-playback.stories.tsx`, `tags: ['real-playback', '!test']`,
each rendering a real `Player.Root` (no mock decorator):

- Native MP4 (`/tracer.mp4`), HLS VOD native, HLS VOD hls.js, live HLS,
  YouTube, Vimeo. Interaction-loaded (activation click) to avoid
  autoplay-policy noise.

### D. e2e PlayerFixture story

`stories/player-fixture.stories.tsx`, `tags: ['real-playback', '!test']`,
`title: 'Fixtures/PlayerFixture'`. Reproduces the docs `PlayerFixture`:

- Reads source/engine/loading/autoplay/etc. from **story args** (Storybook
  maps `?args=…` into the render context), mirroring the docs
  `URLSearchParams` mapping.
- Exposes the same testids and sets `window.playdeckHandle` via the Root ref.
- The `YouTubeExample`, `presentation-capabilities`, and `live-panel`
  sub-surfaces the specs assert against are reproduced as needed (may be
  separate arg-selected stories if cleaner than one mega-fixture).

### E. Retarget Playwright + scripts + CI

- `playwright.config.ts`: `webServer.command` → run `storybook dev` on
  `127.0.0.1:4173` (`--ci`, `--no-open`); `baseURL` unchanged
  (127.0.0.1:4173). Keep `grepInvert: /@real/` gating.
- Rewrite each spec's `page.goto(...)` to the `/iframe.html?id=…&args=…`
  fixture URL. Keep every `page.route(...)`, `window.playdeckHandle` probe,
  testid, and engine-chunk assertion — only the navigation target changes.
  (HLS chunk assertion `/assets/hls-*.js` must still hold under
  `storybook dev` — verify the chunk name/pattern; adjust the assertion if
  the dev-server chunk path differs.)
- Root `package.json`: `test:e2e` → drop `turbo build --filter=@playdeck/docs`
  (the webServer now runs storybook dev). Keep `playwright test`.
- `ci.yml`: `hls-paths` path filter `apps/docs/` → `apps/storybook/`;
  `e2e`/`hls-native-webkit` jobs pick up the new webServer automatically;
  `package`/build job drops the docs build (turbo builds remaining
  workspaces).

### F. Retire apps/docs (final task)

- Remove `apps/docs/` entirely (app, fixtures now in storybook, vite
  config, plugin copy). Remove `@playdeck/docs` from workspace. Confirm no
  dangling references (`turbo.json` generic build task needs no change).
- Only after e2e is green against Storybook in CI.

## Testing & verification

- Mock story suite (`test:storybook`) stays green and still zero-network:
  the new `real-playback`/`!test` stories are excluded; guard test proves
  no leak.
- Retargeted e2e green across chromium/firefox/webkit locally where
  possible; macOS-webkit + real-provider (`@real`) validated in CI.
- Full gate: `format:check`, `lint`, `typecheck`, `test`, `test:e2e`,
  `build`, `test:packages`, `test:bundle`, `test:integrations`,
  `test:storybook`.
- Manual/visual: real videos play in `storybook dev` (native, HLS, live,
  YouTube, Vimeo) — verified by driving the dev server, not just tests.
- Published packages unaffected; `sharp@0.34.5` build allowlist unchanged
  (moving static fixtures + a dev vite plugin adds no published deps).

## Task / commit boundaries (for the plan)

1. Tag-gate `withMockPlayer` + guard test (`!test` on every
   `real-playback` story). No real stories yet — guard passes vacuously,
   mock suite unchanged.
2. Port fixtures (`public/*`) + `live-playlist-plugin` into Storybook;
   wire into viteFinal + `staticDirs`. Verify `/tracer.mp4`,
   `/hls/master.m3u8`, `/live/index.m3u8` serve under `storybook dev`.
3. Real-playback showcase stories (native/HLS/live/YouTube/Vimeo), tagged
   `real-playback`+`!test`. Verify they render + play in `storybook dev`;
   `test:storybook` still green (excluded).
4. `Fixtures/PlayerFixture` story — testids + `window.playdeckHandle` +
   arg-driven sources reproducing the docs fixture contract.
5. Retarget Playwright: `webServer` → `storybook dev`; rewrite every spec
   `goto` to the fixture iframe URL; keep routes/asserts. `test:e2e` green
   locally (non-`@real`).
6. Update `test:e2e` script + `ci.yml` (`hls-paths` path filter). Full
   gate green.
7. Delete `apps/docs` + `@playdeck/docs`; confirm no dangling refs; full gate
   - `storybook build` green. (Only after Task 5–6 e2e green.)

## Out of scope

- Hosting/deploying the static Storybook build.
- Visual regression snapshots.
- New player features or provider changes.
- Changing the mock story suite, `support.ts`, or the drift guard.

## Fail-safe

If the e2e retarget (Tasks 5–6) proves intractable across browsers,
Tasks 1–4 still deliver the user's goal — real video visible in Storybook
alongside mocks/states/docs — and `apps/docs` retirement (Tasks 5–7) is
deferred to a follow-up. Deletion never precedes green e2e.
