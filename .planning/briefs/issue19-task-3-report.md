# Task 3 Report: Mock controller decorator + activation stories + play-function reference

## What was implemented

Per the brief's step order (stories → red → machinery → wiring → green):

1. `packages/react/src/activation.stories.tsx` — five `Player/ActivationButton` stories (`Dormant`, `Eligible`, `LoadingProvider`, `ErrorState`, `ActivatesOnClick`), exactly as specified in the brief, exercising `Player.Root`'s `interaction` loading strategy through play functions.
2. `apps/storybook/src/mock-provider-loader.ts` — the mock loader seam: `MockScenario` type, `setScenario`, `getFakeProviderHandle`, and a `loadProvider` that wraps `createFakeProvider` from the react package's test fixtures, with `resolve` / `pending` / `reject` scenarios and post-subscribe patch flushing.
3. `apps/storybook/src/with-mock-controller.tsx` — the global `withMockController` decorator that reads `parameters.reely` (`rootProps`, `scenario`), resets the mock scenario at render time, and wraps every story in `Player.Root`.
4. Wiring: `apps/storybook/.storybook/main.ts` (alias `./provider-loaders` → the mock module inside `use-activation.ts`'s import graph) and `apps/storybook/.storybook/preview.ts` (registers `withMockController` as a global decorator).

## TDD evidence

### RED

Command: `pnpm test:storybook` (run immediately after writing `activation.stories.tsx`, before any of the mock/decorator machinery existed)

```
 ❯ |storybook (chromium)| ../../packages/react/src/activation.stories.tsx (5 tests | 5 failed) 102ms
   × Dormant 69ms
   × Eligible 7ms
   × Loading Provider 8ms
   × Error State 9ms
   × Activates On Click 9ms

Player hooks and primitives must be used inside Player.Root.
 ❯ usePlayer ../../packages/react/src/index.tsx:138:10
 ❯ Viewport ../../packages/react/src/index.tsx:676:31
...
 Test Files  1 failed | 1 passed (2)
      Tests  5 failed | 1 passed (6)
```

This is exactly the expected failure: a missing-context error (no decorator wraps stories in `Player.Root` yet), not a syntax or import error. Task 1's `Idle` poster story still passed (1 passed), confirming the new stories alone were broken for the right reason.

### GREEN

Command: `pnpm test:storybook` (after implementing the loader, decorator, and wiring)

```
 ✓ |storybook (chromium)| ../../packages/react/src/poster.stories.tsx > Idle 184ms
 ✓ |storybook (chromium)| ../../packages/react/src/activation.stories.tsx > Dormant 176ms
 ✓ |storybook (chromium)| ../../packages/react/src/activation.stories.tsx > Eligible 26ms
 ✓ |storybook (chromium)| ../../packages/react/src/activation.stories.tsx > Loading Provider 21ms
 ✓ |storybook (chromium)| ../../packages/react/src/activation.stories.tsx > Error State 16ms
 ✓ |storybook (chromium)| ../../packages/react/src/activation.stories.tsx > Activates On Click 13ms

 Test Files  2 passed (2)
      Tests  6 passed (6)
```

Confirmed stable across three repeat runs (including a run with a fully cleared `apps/storybook/node_modules/.cache` to rule out cache-dependent flakiness). Task 1's `Idle` poster story kept passing wrapped in the new global `Player.Root` decorator, as required. No story needed the `video-caption` axe-rule contingency — the global `a11y: { test: 'error' }` gate passed on every story, including ones that mount `Player.Media`'s empty `<video>`.

## Verification commands and results

| Command                                                                    | Result                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm test:storybook` (RED, pre-machinery)                                 | 5 activation-story failures for missing `Player.Root` context; `Idle` passed |
| `pnpm test:storybook` (GREEN, post-machinery, ×3 incl. one cold-cache run) | 6/6 passed, stable                                                           |
| `pnpm --filter @reely/storybook build`                                     | exit 0                                                                       |
| `pnpm format`                                                              | no changes (all files already formatted)                                     |
| `pnpm format:check`                                                        | pass                                                                         |
| `pnpm lint`                                                                | pass (after removing the unused mock-loader parameter — see deviations)      |
| `pnpm typecheck`                                                           | pass (after adding a `storybook/test` tsconfig path — see deviations)        |
| `pnpm test` (root workspace)                                               | 244/244 passed, 6 files                                                      |

## Files changed

- Created: `packages/react/src/activation.stories.tsx`
- Created: `apps/storybook/src/mock-provider-loader.ts`
- Created: `apps/storybook/src/with-mock-controller.tsx`
- Modified: `apps/storybook/.storybook/main.ts`
- Modified: `apps/storybook/.storybook/preview.ts`
- Modified: `apps/storybook/tsconfig.json`

Commit: `21f3532 feat: add mock controller decorator and activation stories`

## Self-review

- **Completeness**: all six brief steps executed in order; both TDD checkpoints captured; static build and all repo gates green.
- **YAGNI**: no functionality added beyond the brief's contract. `getFakeProviderHandle` is exported but currently unconsumed by any story — this is intentional per the brief's "Produces" interface list (a seam for later issues), not speculative code added by me.
- **Surgical**: touched only the files the brief named, plus the two config additions strictly required to make the brief's own code path work (see deviations below). No unrelated formatting or refactors.
- **Pristine output**: final `pnpm test:storybook` run is clean (no warnings); build output only has Storybook's stock "chunks larger than 500kB" advisory, unrelated to this change and present independent of it (large `axe`/`iframe` bundles).

## Deviations from the brief's literal snippets (all discovered via the RED→GREEN loop, none touch `packages/react/src` behavior)

1. **Regex alias anchoring (`main.ts`)**: the brief's snippet used `find: /provider-loaders(\.ts)?$/` (unanchored at the start). Vite's alias plugin performs a literal `importee.replace(find, replacement)` — with the regex applied to the _matched substring only_ (`@rollup/plugin-alias` behavior, confirmed by reading `vite/dist/node/chunks/node.js`), an unanchored pattern only swaps the `provider-loaders` text and leaves the original `./` prefix, producing an invalid path (`./` + absolute path concatenated) and a "Failed to resolve import './provider-loaders'" error. Anchored the pattern to `^\.\/provider-loaders(\.ts)?$` so the whole specifier is replaced by the absolute mock-module path. Verified against the RED-run traceback pointing at `use-activation.ts:17` before the fix, and clean resolution after.

2. **New `storybook/test` alias (`main.ts`)**: discovered a second, unrelated resolution gap. Stories live in `packages/react/src`, outside the Storybook app's own root; `storybook/test` is a devDependency declared only in `apps/storybook/package.json`, so Vite's dependency-scan step (which does plain node_modules-style resolution starting from the importing file's directory) cannot find it from that location. The scan failure silently disables dependency prebundling entirely for the whole test run, which then breaks CJS named-export interop for transitively-loaded packages (observed as `SyntaxError: ... does not provide an export named 'elementRoles'` from `aria-query`, pulled in by `@testing-library/dom`) — this failure hit _both_ story files, not just the new one. Fixed by resolving `storybook/test` eagerly inside `main.ts` (where `storybook` is a real dependency, via `createRequire(import.meta.url).resolve(...)`) and aliasing the bare specifier to that absolute path — the same "resolve from a context that actually has the dependency, alias everywhere else" technique the brief anticipated for the analogous typecheck problem (item 3 below). Verified this is required and sufficient by reproducing the failure from a fully-cleared cache both before and after the fix.

3. **`storybook/test` tsconfig path (`apps/storybook/tsconfig.json`)**: as flagged as a known possibility in my task context, `tsc -b` could not resolve `storybook/test`'s type declarations from a story file outside the app root. Added a `paths` entry (`"storybook/test": ["./node_modules/storybook/dist/test/index.d.ts"]`) alongside the existing `@storybook/react-vite` entry, using the identical established pattern — minimal, one line.

4. **Unused parameter removed from the mock `loadProvider` (`mock-provider-loader.ts`)**: the brief's snippet declared an unused `_request` parameter (typed but never read). This repo's `eslint.config.js` uses `@typescript-eslint/recommended`'s default `no-unused-vars` (no `argsIgnorePattern`), which flags a sole unused parameter regardless of the underscore prefix (unlike the pre-existing `_option` in `activation.test.tsx`, which is followed by used parameters and so is exempted by the default `"after-used"` behavior). Since the mock loader's whole point is that the request payload is ignored and only the scenario matters, and TypeScript's structural typing permits a zero-parameter function wherever a one-parameter function is expected, I dropped the parameter entirely rather than adding an inline `eslint-disable` comment — same behavior, no lint suppression needed. Updated the adjacent comment to describe the call-compatibility instead of naming a phantom parameter.

None of these deviations touch `packages/react/src` runtime behavior, weaken the a11y gate, or change the public contract described in the brief (`setScenario`, `getFakeProviderHandle`, `MockScenario`, `parameters.reely`, `withMockController` are all exactly as specified).
