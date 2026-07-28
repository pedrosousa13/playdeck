# Task 5 Report: Conventions doc + full verification gate

Worktree: `.worktrees/issue-19-storybook` (branch `issue-19-storybook`).
Pre-flight: killed a stray dev server on port 6006 (`lsof -ti:6006 | xargs kill`)
before running the gate, per instructions. Did not restart it afterward.

## 1. README — what was written and reality-corrections applied

Wrote `apps/storybook/README.md` following the brief's structure (Commands
table, Conventions, Dialing player state, Adding stories for a new issue),
verifying each "reality" note against the actual code before writing:

1. **Hang endpoint duality.** Verified `apps/storybook/src/hang-endpoint-plugin.ts`
   (Vite plugin, used by `pnpm test:storybook` since the Vitest addon builds
   its own Vite server) and `apps/storybook/.storybook/middleware.js`
   (Storybook's own dev-server middleware hook, used by `storybook dev`)
   both serve `/__reely/hang.png` and never respond. Added a convention bullet
   naming both mechanisms and flagging the path as duplicated across three
   places (stories, plugin, middleware) that must stay in sync.
2. **Shared workbench chrome.** Verified `viewportStyle` in all three story
   files (`activation.stories.tsx`, `loading-indicator.stories.tsx`,
   `poster.stories.tsx`) uses `border: '1px dashed #94a3b8'` and
   `background: '#f1f5f9'`. Added a one-line convention noting this is
   workbench-only scaffolding (component styling is issue #10's job).
3. **Patches idiom.** Verified the real `BufferingState` story in
   `loading-indicator.stories.tsx` uses
   `patches: [{ activation: 'ready', lifecycle: 'ready' }, { buffering: true }]`.
   Used this real example in the Scenarios section instead of the brief's
   outdated `[{ buffering: true }]`-only example.
4. **rootProps re-declaration.** Verified every story needing non-default
   `rootProps` (in `activation.stories.tsx` and `loading-indicator.stories.tsx`)
   repeats the full `rootProps` object in its own `parameters.reely` rather
   than relying on `meta.parameters` + story-level deep-merge. Added a
   one-line convention noting this is safer given Storybook's parameter
   merge semantics.

Also confirmed accurate before writing: `a11y: { test: 'error' }` in
`.storybook/preview.ts`, the `ActivatesOnClick` reference story pattern in
`activation.stories.tsx`, `getFakeProviderHandle` export in
`mock-provider-loader.ts`, and the root `package.json` scripts table
(`dev`, `test:storybook`, `build`).

Note: `pnpm format` reflowed the Commands table's column widths (cosmetic,
Prettier-driven) after the initial write — final committed content reflects
that.

## 2. Dependency-policy diff check (Step 2)

```
git diff main -- pnpm-workspace.yaml packages/core/package.json packages/provider-native/package.json packages/react/package.json
```

Actual: `pnpm-workspace.yaml` shows exactly one line added —
`esbuild: false` under `allowBuilds` (the controller-approved decline) —
no other lines touched. `packages/core/package.json`,
`packages/provider-native/package.json`, `packages/react/package.json`:
**no diff** (published manifests unaffected). This matches the corrected
expectation given in the task (not the brief's original "NO diff" for the
workspace file).

## 3. Full verification gate (Step 3, serial, fresh)

| #   | Command                  | Exit | Key output                                                                                                                                                               |
| --- | ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pnpm format`            | 0    | Reformatted `apps/storybook/README.md`; all other files unchanged                                                                                                        |
| 2   | `pnpm format:check`      | 0    | "All matched files use Prettier code style!"                                                                                                                             |
| 3   | `pnpm lint`              | 0    | No output (clean)                                                                                                                                                        |
| 4   | `pnpm typecheck`         | 0    | No output (clean, `tsc -b`)                                                                                                                                              |
| 5   | `pnpm test`              | 0    | 6 test files, **244 passed** (matches main baseline exactly)                                                                                                             |
| 6   | `pnpm test:e2e`          | 0    | docs build ok; Playwright: 31 passed, 2 skipped (Chromium-only fullscreen test), 0 failed                                                                                |
| 7   | `pnpm build`             | 0    | All packages/apps built; `storybook build` completed successfully (`storybook-static/` produced)                                                                         |
| 8   | `pnpm test:packages`     | 0    | core/provider-native/react built clean                                                                                                                                   |
| 9   | `pnpm test:bundle`       | 0    | core/provider-native/react/bundle-native-only built; bundle test ran clean (exit 0)                                                                                      |
| 10  | `pnpm test:integrations` | 0    | react build, Next.js integration build, `node --test` harness: 4/4 pass                                                                                                  |
| 11  | `pnpm test:storybook`    | 0    | 3 test files, **12 tests passed** (matches 12 `export const` stories across `activation.stories.tsx` (5), `poster.stories.tsx` (5), `loading-indicator.stories.tsx` (2)) |

All 11 commands green. `pnpm test` count (244) matches the stated baseline —
stories add no happy-dom tests. `test:bundle` confirms published bundles
unaffected. One pre-existing, unrelated Storybook warning noted in the
`test:storybook` log ("extensionless imports detected" for
`hang-endpoint-plugin` import in `main.ts`) — not touched, out of scope for
this task (no code changes involved, doc-only task).

Full logs saved under the session scratchpad (`gate-1-format.log` through
`gate-11-test-storybook.log`) for reference during this session.

## 4. Files changed

- `apps/storybook/README.md` (new, 80 lines)

No other files touched. `git status` before commit showed only this
untracked file; no tracked files were modified by the gate run.

## 5. Commit

```
872495f docs: document story conventions for later issues
```

## 6. Self-review

- Re-read the committed README against the four reality-checks: all four
  are reflected accurately and each traces to a specific line in the actual
  source (cited above).
- Cross-checked story/test counts: 3 story files, 12 stories, matches
  `test:storybook` output (3 files / 12 tests) and matches the issue's
  "12 stories across three files" framing.
- Confirmed the dependency-policy diff matches the task's corrected
  expectation (non-empty `pnpm-workspace.yaml` diff = only `esbuild: false`;
  empty diff on the three package manifests).
- No unrelated files staged; commit contains only the README.
- No deviations from the brief beyond the four instructed corrections and
  the (out-of-scope, pre-existing) Prettier reflow of the table.

## 7. Whole-branch review fix-up (post-report)

Applied exactly the three findings from the final whole-branch review.
Pre-flight: killed a stray dev server on port 6006 (`lsof -ti:6006 | xargs kill`)
before running tests; did not restart it.

### Changes

1. **(Important) Resource-timing buffer overflow guard**
   (`apps/storybook/.storybook/vitest.setup.ts`): added a `beforeAll` that
   calls `performance.setResourceTimingBufferSize(10_000)`, and added
   `performance.clearResourceTimings()` at the end of the existing
   `afterEach`, after the two existing assertions, so each test is checked
   against only its own resource-timing entries. Existing assertions
   unchanged.
2. **(Minor) Depth-assumption comment** (`apps/storybook/.storybook/main.ts`):
   added a comment on the `/^\.\/provider-loaders(\.ts)?$/` alias entry
   noting the pattern assumes the importer sits directly in
   `packages/react/src` — a `../provider-loaders` import from a future
   subdirectory would bypass the mock, and the pending/reject stories would
   then fail loudly.
3. **(Minor) README caveat** (`apps/storybook/README.md`): added a sentence
   to the no-network convention bullet noting the `/media/sample.mp4`
   assertion only covers the decorator's default source — a story
   overriding `rootProps.source` with a different same-origin path is only
   caught by the external-origin check, so keep story sources on the
   default unless there's a reason not to.

### Verification (serial)

| #   | Command                          | Exit         | Key output                                                                                                                                                                                                                                    |
| --- | -------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm test:storybook`            | 0            | 3 test files, **12 passed (12)**                                                                                                                                                                                                              |
| 2   | negative-proof probe (see below) | 1 (expected) | `activation.stories.tsx`: 5 tests failed; `Dormant` failed with `AssertionError: expected [ 'https://example.com/probe.png' ] to deeply equal []` at the `expect(external).toEqual([])` line — confirms the guard still gates after hardening |
| 3   | `git diff --stat` after revert   | —            | only the 3 intended files, 18 insertions / 1 deletion, matching the pre-negative-proof diff exactly                                                                                                                                           |
| 4   | `pnpm format`                    | 0            | all files unchanged (no reformatting needed)                                                                                                                                                                                                  |
| 5   | `pnpm format:check`              | 0            | "All matched files use Prettier code style!"                                                                                                                                                                                                  |
| 6   | `pnpm lint`                      | 0            | no output (clean)                                                                                                                                                                                                                             |
| 7   | `pnpm typecheck`                 | 0            | no output (clean, `tsc -b`)                                                                                                                                                                                                                   |
| 8   | `pnpm test`                      | 0            | 6 test files, **244 passed** (matches root baseline exactly)                                                                                                                                                                                  |

**Negative-proof procedure:** temporarily added to `Dormant`'s `play`
function in `packages/react/src/activation.stories.tsx`:

```ts
await fetch('https://example.com/probe.png').catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 500));
```

Ran `pnpm test:storybook`; captured failure:

```
 ❯ |storybook (chromium)| ../../packages/react/src/activation.stories.tsx (5 tests | 5 failed) 1205ms
   × Dormant 1119ms
   × Eligible 20ms
   × Loading Provider 19ms
   × Error State 25ms
   × Activates On Click 21ms

 FAIL  |storybook (chromium)| ../../packages/react/src/activation.stories.tsx > Dormant
AssertionError: expected [ 'https://example.com/probe.png' ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "https://example.com/probe.png",
+ ]

 ❯ .storybook/vitest.setup.ts:20:19
     18|   );
     19|   // Stories must never contact an external origin — no media, SDKs, o…
     20|   expect(external).toEqual([]);

 Test Files  1 failed | 2 passed (3)
      Tests  5 failed | 7 passed (12)
```

The subsequent four tests in the same file also fail: the external-origin
assertion throws before `clearResourceTimings()` runs, so the probe entry
persists in the buffer across the rest of that file's tests (each `afterEach`
re-checks the same accumulated entries until a passing run clears it) —
expected given the fix only clears _after_ the assertions succeed, not on
failure.

Reverted the temporary probe cleanly; `git diff` after revert showed only
the three intended finding changes (confirmed via `git diff --stat`: 3 files
changed, 18 insertions(+), 1 deletion(-), matching pre-probe state exactly).
Re-ran `pnpm test:storybook` post-revert: 12/12 passed again.

### Commit

```
f7a8fd3 fix: harden story network guard against resource buffer overflow
```

### Self-review

- All three findings applied exactly as specified — no scope creep.
- Negative proof confirms the hardened guard still catches external-origin
  requests; the cascading failure across the rest of the file is a
  side-effect of assertions throwing before the new `clearResourceTimings()`
  call, not a defect in the fix.
- `git diff` before commit matched the three-file, 18-insertion/1-deletion
  shape exactly — no stray changes from the temporary negative-proof edit
  survived the revert.
- Root test baseline held at 244 (unchanged from Task 5's report).
