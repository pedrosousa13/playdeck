# Task 4 Report: Full poster stories, hanging endpoint, loading-indicator stories

## Follow-up fix 2: hang endpoint dead in `storybook dev` + workbench chrome

### Item 1: hang endpoint dead in dev mode

**Diagnosis.** Added a temporary `console.log` to `hangEndpointPlugin`'s
`configureServer` and started `storybook dev` (both via `pnpm exec storybook
dev --port 6006 --ci` from `apps/storybook`, and via `pnpm --filter
@reely/storybook dev` from the repo root, with `node_modules/.vite` and
`apps/storybook/node_modules/.cache` cleared for a genuinely cold start).
`configureServer` fired exactly once at boot, and repeated `curl`/Playwright
checks against the running server all showed the endpoint hanging correctly
(`curl` exit `28`, Playwright saw `data-state="loading"` held for >1.2s) — I
could not reproduce the reported instant-404 through direct testing.

However, comparing the reported 404 response headers
(`Cache-Control: no-store`, `Vary: Origin`) against a deliberately-wrong path
on my own server (`curl .../__reely/does-not-exist.png`) produced an
**identical** header set — i.e. those are the generic fallback-404 headers
Vite's dev server core emits for any unmatched request, confirming the
reviewer's request was, in their run, genuinely never reaching our plugin's
middleware at all (not some other 404 source).

Reading Storybook 10.5's own dev-server bootstrap
(`storybook/dist/core-server/index.js`, `storybookDevServer`) showed the
actual request-handling order for `storybook dev`:

```
app.use(hostValidation); app.use(accessControl); app.use(caching);
registerIndexJsonRoute(...);
(await getMiddleware(configDir))(app);     // <-- .storybook/middleware.*
await options.presets.apply('experimental_devServer', app);
...
getPreviewBuilder(...)                      // Vite preview server attached later
```

`getMiddleware` (`core-server/utils/middleware.ts`) loads
`.storybook/middleware.{js,mjs,cjs}` (note: **not** `.ts` — `fileExists` only
checks those three extensions, no transform step) and applies it to the
**same shared connect `app`** that Storybook's CLI dev-server owns, strictly
**before** the Vite preview builder (our `viteFinal`/plugin config) is even
constructed. This is Storybook's own documented dev-server extension point,
and it is structurally immune to whatever ordering/addon-interaction issue
caused the reviewer's Vite-plugin path to be bypassed — it's not a
theoretical fix, I verified it directly (below).

**Fix.** Added `apps/storybook/.storybook/middleware.js` (plain JS — this
loader doesn't transform TypeScript) registering the same
`/__reely/hang.png` never-respond handler directly on Storybook's top-level
router. Kept `apps/storybook/src/hang-endpoint-plugin.ts` and its
registration in `main.ts` unchanged, since `pnpm test:storybook` (the Vitest
addon) builds its own Vite server straight from `viteFinal` and never goes
through `storybook dev`'s CLI bootstrap — `middleware.js` never loads there,
so the existing Vite plugin remains the mechanism vitest-mode relies on.
Removed the temporary diagnostic `console.log` before committing.

**Load-bearing evidence:**

1. Combined (both mechanisms), fresh `storybook dev`:

   ```
   $ curl -s -o /dev/null --max-time 4 http://localhost:6006/__reely/hang.png; echo $?
   28
   ```

   Playwright (`chromium.launch()` → `page.goto('.../iframe.html?id=player-poster--loading&viewMode=story')` → wait 1.2s → read `data-state`):

   ```
   data-state after >=1s: loading
   ```

2. **Isolation proof** — temporarily set `plugins: []` in `main.ts` (Vite
   plugin disabled), keeping only `middleware.js`, restarted `storybook dev`
   fresh:

   ```
   $ curl -s -o /dev/null --max-time 4 http://localhost:6006/__reely/hang.png; echo $?
   28
   data-state after >=1s: loading
   ```

   This proves `middleware.js` alone is sufficient — the fix does not depend
   on the Vite plugin registration succeeding in dev mode at all. Reverted
   `plugins: []` back to `plugins: [hangEndpointPlugin()]` immediately after
   (`git diff` on `main.ts` showed no diff afterward).

3. `pnpm test:storybook` re-run after the isolation test and after
   restoring `main.ts`: `Test Files 3 passed (3)`, `Tests 12 passed (12)` —
   confirms `middleware.js`'s presence doesn't interfere with vitest-mode and
   the Vite-plugin path there is untouched.

Dev server was killed (`lsof -ti:6006 | xargs kill -9`) after each
diagnostic/verification run; confirmed port free before finishing.

### Item 2: workbench chrome

Extended the local `viewportStyle` const in all three story files
(`poster.stories.tsx`, `loading-indicator.stories.tsx`,
`activation.stories.tsx` — each declares its own copy, no shared module) to
add:

```ts
border: '1px dashed #94a3b8',
background: '#f1f5f9'
```

kept `width`/`height` unchanged. No changes to `packages/react/src`
non-story files. Verified with a Playwright screenshot of
`player-loadingindicator--buffering-state`: the dashed border and light
background render as expected, "Buffering" text is clearly visible against
the new background (no longer floating on plain white/indistinguishable from
broken). `pnpm test:storybook` (which runs axe via `a11y.test: 'error'`)
stayed at 12/12 green after the change — no color-contrast violations, so no
rule exception was needed.

### Gates after both fixes

| Command                                | Result                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:storybook`                  | 12/12 pass                                                                                                                                            |
| dev-mode curl (`--max-time 4`)         | exit `28` (genuine hang)                                                                                                                              |
| dev-mode Playwright persistence check  | `data-state="loading"` held ≥1.2s                                                                                                                     |
| `pnpm --filter @reely/storybook build` | exit 0                                                                                                                                                |
| `pnpm format`                          | only the intended 3 story files + new `middleware.js` touched                                                                                         |
| `pnpm format:check`                    | pass                                                                                                                                                  |
| `pnpm lint`                            | pass (initially caught unused `_req`/`_res` params in `middleware.js`; fixed by dropping the param names, matching `hang-endpoint-plugin.ts`'s style) |
| `pnpm typecheck`                       | pass, no output                                                                                                                                       |
| `pnpm test` (root)                     | 244/244 passed                                                                                                                                        |

Commit: `26990c2 fix: hang endpoint in dev mode and add workbench chrome to stories`

## Follow-up fix: `Loading` story now asserts persistence (reviewer-mandated)

The task reviewer confirmed the RED-capture gap noted below (deviation
"RED-capture evidence gap") as an Important, plan-mandated finding: the
design's contract is that `data-state="loading"` **holds** deterministically,
so the story must assert persistence over a real time window, not just the
trivially-true initial render. Fixed in `packages/react/src/poster.stories.tsx`,
`Loading` story only:

```ts
export const Loading: Story = {
  args: { src: HANGING_SRC },
  play: async ({ canvasElement }) => {
    await posterImage('loading', canvasElement);
    // The initial synchronous check above is trivially true the instant the
    // component mounts (before any network event could possibly land), so it
    // alone can't prove the endpoint hangs. Wait a real ~300ms and re-check:
    // a 404 (or any other response) would flip data-state to 'error' well
    // within this window — this asserts the endpoint genuinely never
    // responds, not just that the state started out 'loading'.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = canvasElement.querySelector(
      '[data-reely-part="poster-image"]'
    );
    await expect(image).toHaveAttribute('data-state', 'loading');
  }
};
```

The shared `posterImage` helper is unchanged and still used by the other
poster stories; `Loading` inlines the re-check since the helper's single
`waitFor`-based check doesn't fit a "wait, then assert persistence" shape.

### Load-bearing evidence: gates on the plugin

**GREEN, plugin intact** (`pnpm test:storybook`):

```
 Test Files  3 passed (3)
      Tests  12 passed (12)
   Duration  2.61s
```

**RED, plugin disabled** — temporarily changed
`apps/storybook/.storybook/main.ts`'s `plugins: [hangEndpointPlugin()]` to
`plugins: []`, then ran `pnpm test:storybook`:

```
 ❯ |storybook (chromium)| ../../packages/react/src/poster.stories.tsx (5 tests | 1 failed) 711ms
   × Loading 313ms

 FAIL  |storybook (chromium)| ../../packages/react/src/poster.stories.tsx > Loading
expect(element).toHaveAttribute("data-state", "loading")
Expected the element to have attribute:
  data-state="loading"
Received:
  data-state="error"

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 11 passed (12)
```

This confirms the endpoint 404s without the plugin and the story now catches
the regression, as designed.

**Reverted cleanly** — restored `plugins: [hangEndpointPlugin()]`,
`git diff apps/storybook/.storybook/main.ts` showed no diff, then reran
`pnpm test:storybook`:

```
 Test Files  3 passed (3)
      Tests  12 passed (12)
   Duration  2.25s
```

### Gates after the fix

| Command                      | Result                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `pnpm format`                | only `poster.stories.tsx` touched by the actual edit; no reformat side effects |
| `pnpm format:check`          | pass                                                                           |
| `pnpm lint`                  | pass, no output                                                                |
| `pnpm typecheck`             | pass, no output                                                                |
| `pnpm test` (root, packages) | 244 tests / 6 files passed                                                     |

Commit: `3667ff2 fix: assert Loading poster story holds data-state across a real delay`

## What was implemented

- `apps/storybook/src/hang-endpoint-plugin.ts` (new): a Vite plugin exposing
  `/__reely/hang.png` via `configureServer` middleware that never responds and
  never calls `next()`.
- `apps/storybook/.storybook/main.ts` (modified): imports and registers
  `hangEndpointPlugin()` in the `plugins` array of the object passed to
  `mergeConfig`, alongside the existing `resolve` block.
- `packages/react/src/poster.stories.tsx` (replaced): full poster story
  inventory — `Idle`, `Loading` (hanging endpoint), `Loaded` (inline SVG data
  URI), `ErrorState` (broken data URI), `CustomChildren` — exactly per brief.
- `packages/react/src/loading-indicator.stories.tsx` (new): `LoadingProviderState`
  and `BufferingState` stories, with one deviation from the brief's literal
  code (see Deviations below).

## TDD evidence

### RED (as literally specified) — did not reproduce

Command: `pnpm test:storybook`, run immediately after writing both story files
verbatim per the brief, before implementing the plugin.

Result: `BufferingState` failed (see below); all 5 poster stories, including
`Loading`, **passed** — contrary to the brief's stated expectation that
`Loading` would fail with `data-state="error"`.

```
 FAIL  |storybook (chromium)| ../../packages/react/src/loading-indicator.stories.tsx > Buffering State
Error:
expect(element).toHaveAttribute("data-state", "buffering")
Received:
  data-state="loading-provider"

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 11 passed (12)
```

**Why `Loading` didn't fail as predicted:** `PosterImage`'s state starts
synchronously as `'loading'` at mount (`initialPosterImageState` returns
`'loading'` whenever `src` is set, computed in a `useRef` initializer, no
event needed — `packages/react/src/index.tsx:854-857,876-882`). Separately,
`@testing-library/dom`'s `waitFor` invokes its callback **synchronously on
first call**, before any timer/interval (`node_modules/.../dist/wait-for.js:97`,
`checkCallback()` called immediately). So the assertion
`posterImage('loading', canvasElement)` is satisfied at the very first,
synchronous check — before the browser can complete any network round trip
(success, 404, or otherwise) and dispatch `onError`/`onLoad`. This holds
regardless of whether `/__reely/hang.png` hangs or 404s; the plugin cannot
change this specific assertion's outcome.

**Empirical confirmation that the plugin is still necessary:** I temporarily
added `await new Promise((resolve) => setTimeout(resolve, 200));` before the
assertion in the `Loading` story (diagnostic only, reverted before
committing) and reran `pnpm test:storybook` without the plugin:

```
 FAIL  ... > Loading
Expected the element to have attribute:
  data-state="loading"
Received:
  data-state="error"
```

This confirms the endpoint does 404 and does flip `data-state` to `'error'`
shortly after mount without the plugin — the hang endpoint is genuinely
required for the poster to hold `loading` deterministically over time (e.g.
under any future timing skew, slower CI, or a story that asserts persistence).
The literal brief assertion just happens to be satisfied before that flip is
observable. I reverted the diagnostic edit; the committed `Loading` story
play function is exactly as specified in the brief.

### GREEN

Command: `pnpm test:storybook`, after implementing the plugin and fixing
`BufferingState` (see Deviations):

```
 Test Files  3 passed (3)
      Tests  12 passed (12)
   Duration  2.61s
```

All 12 stories pass (poster x5, activation x5, loading-indicator x2),
including axe (`a11y.test: 'error'` in `preview.ts`) and the network guard
(`vitest.setup.ts` `afterEach`).

## Verification commands run (all serial)

| Command                                                                          | Result                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm test:storybook` (pre-plugin, RED capture)                                  | 1 failed (`BufferingState`), 11 passed — see RED section                                               |
| `pnpm test:storybook` (after `BufferingState` fix, pre-plugin)                   | 12 passed (confirms `Loading` passes independent of the plugin — see RED discussion)                   |
| Diagnostic: `pnpm test:storybook` with 200ms delay added to `Loading`, no plugin | `Loading` fails, `data-state="error"` (proves endpoint necessity) — diagnostic reverted, not committed |
| `pnpm test:storybook` (post-plugin, GREEN)                                       | 12 passed                                                                                              |
| `pnpm test:storybook` (final confirmation after revert)                          | 12 passed                                                                                              |
| `pnpm --filter @reely/storybook build`                                           | exit 0                                                                                                 |
| `pnpm format`                                                                    | all unchanged                                                                                          |
| `pnpm format:check`                                                              | pass                                                                                                   |
| `pnpm lint`                                                                      | pass, no output                                                                                        |
| `pnpm typecheck`                                                                 | pass, no output                                                                                        |
| `pnpm test` (root, packages)                                                     | 244 tests / 6 files passed                                                                             |

## Files changed

- `apps/storybook/src/hang-endpoint-plugin.ts` — new
- `apps/storybook/.storybook/main.ts` — modified (import + `plugins` array)
- `packages/react/src/poster.stories.tsx` — replaced, exactly per brief
- `packages/react/src/loading-indicator.stories.tsx` — new, one deviation (below)

Commit: `6f37f7d feat: add poster and loading-indicator stories with hanging endpoint`

## Self-review findings

- No a11y exception was needed for either new story file (both render
  `Player.Media`, matching Task 3's activation stories, which also needed
  none) — the brief's contingency did not apply. Verified axe ran (it's
  wired to fail the test on violation via `a11y.test: 'error'`) and all
  tests still passed, so this is a real pass, not a skip.
- The static build emits a pre-existing-pattern warning: "One or more
  extensionless imports detected: `../src/hang-endpoint-plugin`" (Storybook's
  own lint about `main.ts` imports specifically). The brief's exact code
  specifies the import without an extension, and the existing codebase
  already uses extensionless relative imports elsewhere (e.g.
  `with-mock-controller.tsx` imports `./mock-provider-loader`). Kept as
  specified; it's a warning, not an error — build exits 0 and the warning
  doesn't fail any gate.
- Confirmed `git diff` against the brief's literal code for
  `poster.stories.tsx` and `main.ts`: identical except for the deviation
  below.

## Deviations from the brief, and why

**`loading-indicator.stories.tsx` — `BufferingState` scenario patches.**

Brief specified:

```ts
scenario: { kind: 'resolve', patches: [{ buffering: true }] }
```

This fails: `LoadingIndicator`'s state derivation
(`packages/react/src/index.tsx:821-826`) is
`activation === 'loading-provider' ? 'loading-provider' : (activation !== 'error' && buffering ? 'buffering' : null)`
— i.e. it reports `'loading-provider'` unconditionally while `activation`
hasn't advanced to `'ready'`, regardless of `buffering`. The mock provider's
`resolve` scenario (`apps/storybook/src/mock-provider-loader.ts`) never emits
an implicit `ready` transition on its own — unlike the real native provider,
whose `ready` is driven by actual media events, the fake adapter only emits
whatever patches a story scripts. Task 3's existing `activation.stories.tsx`
never needed `ready`, so this gap was never exercised before.

Per `packages/react/test/activation.test.tsx` (e.g. lines 907-908, 929-930,
1210-1223), the established pattern for reaching a post-ready state with the
fake provider is to `emit({ activation: 'ready', lifecycle: 'ready' })`
explicitly before any subsequent patch. I applied the same pattern to the
story's scripted `patches` array:

```ts
patches: [{ activation: 'ready', lifecycle: 'ready' }, { buffering: true }];
```

This is a change only to the story file's `parameters.reely.scenario` data
(not to `packages/react/src` or to any Task 3 interface), consistent with the
brief's own guidance: "if they fail, fix before proceeding... consult
`packages/react/test/activation.test.tsx` mechanics first; do not modify
`packages/react/src`." No other file needed changes for this fix.

**RED-capture evidence gap (documented above, no code deviation).** The
`Loading` poster story, as specified verbatim by the brief, does not actually
fail before the plugin exists, due to a timing property of `waitFor`'s
synchronous first check versus the component's synchronous initial `loading`
state — not a flaw in the implementation. I verified the plugin's necessity
via a temporary, reverted diagnostic (200ms delay) rather than changing the
committed story. No production or story code was altered to force a
different RED outcome — the committed `Loading` story matches the brief
exactly.
