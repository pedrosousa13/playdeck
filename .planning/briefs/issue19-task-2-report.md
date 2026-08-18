# Task 2 report: Story-test infrastructure — every story is a browser test with axe

## What was implemented

Exactly the brief's Step 1–5, no deviations from the code as written:

1. `apps/storybook/vitest.config.ts` (new) — Vitest config using `storybookTest` (addon-vitest vitest-plugin) + `@vitest/browser-playwright` provider, Chromium instance, headless, `setupFiles: ['./.storybook/vitest.setup.ts']`.
2. `apps/storybook/.storybook/vitest.setup.ts` (new) — `setProjectAnnotations([a11yAddonAnnotations, projectAnnotations])`, `beforeAll(annotations.beforeAll)`, and an `afterEach` that asserts (a) no cross-origin `performance` resource entries and (b) no request whose name contains `/media/sample.mp4`.
3. Root `package.json` — added `"test:storybook": "pnpm --filter @playdeck/storybook test"` directly after `test:integrations`.
4. `.github/workflows/ci.yml` — appended `&& pnpm test:storybook` to the single verify `run:` step.

No changes were needed to `apps/storybook/tsconfig.json` — typecheck passed cleanly with the existing Task-1 `paths` entry, so the scoped-paths workaround mentioned as a fallback in the task context was not required.

## Verification commands run (in order)

| Command                                                                           | Result                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:storybook` (initial)                                                   | Exit 0. `Test Files 1 passed (1)`, `Tests 1 passed (1)`. Story `Player/PosterImage > Idle` ran in Chromium via `@vitest/browser-playwright`.                       |
| a11y sanity check (see below) — temporarily broke a11y, ran `pnpm test:storybook` | Exit 1. Test failed with a real axe violation (evidence below).                                                                                                    |
| Reverted the story change, `git diff packages/react/src/poster.stories.tsx`       | Empty diff — clean revert confirmed.                                                                                                                               |
| `pnpm test:storybook` (after revert)                                              | Exit 0. `Test Files 1 passed (1)`, `Tests 1 passed (1)` again.                                                                                                     |
| `pnpm format`                                                                     | No files changed (`apps/storybook/vitest.config.ts` and `.storybook/vitest.setup.ts` reported `(unchanged)` — already Prettier-formatted as written).              |
| `pnpm format:check`                                                               | Exit 0 — "All matched files use Prettier code style!"                                                                                                              |
| `pnpm lint`                                                                       | Exit 0 — no output/errors.                                                                                                                                         |
| `pnpm typecheck` (`tsc -b`)                                                       | Exit 0 — no errors, no tsconfig changes needed.                                                                                                                    |
| `pnpm test` (root, `vitest run --passWithNoTests`)                                | Exit 0 — `Test Files 6 passed (6)`, `Tests 244 passed (244)` (root config only globs `packages/**/*.test.{ts,tsx}`, unaffected by the storybook app, as expected). |

## Evidence the axe gate fails on a real violation

Temporarily changed `packages/react/src/poster.stories.tsx`:

```tsx
export const Idle: Story = {
  render: () => <img src="x" role="img" />
};
```

Ran `pnpm test:storybook`, result: exit code 1, test failed:

```
FAIL  |storybook (chromium)| ../../packages/react/src/poster.stories.tsx > Idle
Error:
expect(received).toHaveNoViolations(expected)

Expected the HTML found at $('img') to have no violations:
<img role="img" src="x">

Received:
"Images must have alternative text (image-alt)"
...
 ❯ afterEach .../@storybook/addon-a11y/dist/_browser-chunks/chunk-P5J2FJ2Z.js:165:25
```

This confirms the a11y addon's `afterEach` axe check is live and gating story tests, not a no-op. The change was reverted immediately after capturing this output (`git diff` on the file is empty, confirmed via `git status` showing a clean tree before commit).

## Files changed (committed in `267475e`)

- `apps/storybook/vitest.config.ts` (new)
- `apps/storybook/.storybook/vitest.setup.ts` (new)
- `package.json` (root) — added `test:storybook` script
- `.github/workflows/ci.yml` — appended `pnpm test:storybook` to the verify step

Commit: `267475e feat: run stories as Vitest browser tests with axe and network guards` on branch `issue-19-storybook` (worktree `/Users/pedrosousa/Documents/projects/experiments/video-player/.worktrees/issue-19-storybook`).

## Self-review

- **Completeness**: All 5 steps done; both new files match the brief verbatim; root script and CI wired exactly as specified; story test passes with axe active; network guard (`afterEach`) exercises real `performance.getEntriesByType('resource')` data (verified passing, not vacuously true, since a working test run produces at least the story's own module/asset resource entries which are same-origin dev-server URLs).
- **Discipline/YAGNI**: No extra files, no extra config beyond the brief. Did not touch `apps/storybook/tsconfig.json` since typecheck passed without it — avoided an unnecessary change.
- **Pristine output**: `git status` clean after commit; `git diff` on `poster.stories.tsx` was empty before committing (temporary a11y-violation edit was fully reverted, never staged/committed). Prettier reports the two new files as already correctly formatted (no rewrite on `pnpm format`).
- **Deviations from the brief's code**: None. The one point of interest is a non-fatal informational banner emitted by `@storybook/addon-vitest` on every run:

  > "Info: Found a setup file with `setProjectAnnotations`. Skipping automatic provisioning of preview annotations to avoid conflicts. Since Storybook 10.3, `@storybook/addon-vitest` applies these automatically. You can safely remove the `setProjectAnnotations` call..."

  This is advisory only (exit code unaffected, tests pass, and the axe gate still measurably fires — see the sanity check above), and the brief's `vitest.setup.ts` content was specified verbatim, so it was kept as-is rather than "simplified" further per the addon's suggestion. Worth a follow-up decision later (could drop `setProjectAnnotations` and only keep the `afterEach` network guard), but out of scope for this task since the brief's exact file content was the requirement and it functions correctly.

## Fix (reviewer finding): drop redundant `setProjectAnnotations`

The reviewer flagged the "Info:" banner as non-pristine output and asked for the fix rather than accepting it as advisory. Applied.

**Change** — `apps/storybook/.storybook/vitest.setup.ts`: removed the `setProjectAnnotations([...])` call, `beforeAll(annotations.beforeAll)`, and the now-unused imports (`a11yAddonAnnotations`, `setProjectAnnotations`, `projectAnnotations`, `beforeAll`). The file now contains only the `afterEach` network guard:

```ts
import { afterEach, expect } from 'vitest';

afterEach(() => {
  const resources = performance.getEntriesByType(
    'resource'
  ) as PerformanceResourceTiming[];
  const names = resources.map((entry) => entry.name);
  const external = names.filter(
    (name) =>
      new URL(name, window.location.href).origin !== window.location.origin
  );
  expect(external).toEqual([]);
  const mediaRequests = names.filter((name) =>
    name.includes('/media/sample.mp4')
  );
  expect(mediaRequests).toEqual([]);
});
```

**Re-verification commands run:**

| Command                                                                                                                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:storybook` (after removing `setProjectAnnotations`)                                                                                                                 | Exit 0. `Test Files 1 passed (1)`, `Tests 1 passed (1)`. **The "Info: Found a setup file with setProjectAnnotations..." banner is gone** — output is now pristine (just the vitest run header and pass summary).                                                                                                                                                      |
| a11y sanity check repeated: temporarily set `Idle: Story = { render: () => <img src="x" role="img" /> }` in `packages/react/src/poster.stories.tsx`, ran `pnpm test:storybook` | Exit 1. Test failed: `expect(received).toHaveNoViolations(expected)` → `"Images must have alternative text (image-alt)"`, thrown from `@storybook/addon-a11y/.../afterEach`. **Confirms the axe gate still fires via addon-vitest's auto-provisioning — no `setProjectAnnotations` needed.** No code restoration was required; auto-provisioning alone is sufficient. |
| Reverted the story change                                                                                                                                                      | `git diff packages/react/src/poster.stories.tsx` → empty, clean revert confirmed before staging anything.                                                                                                                                                                                                                                                             |
| `pnpm format`                                                                                                                                                                  | No changes (files already Prettier-formatted).                                                                                                                                                                                                                                                                                                                        |
| `pnpm format:check`                                                                                                                                                            | Exit 0 — "All matched files use Prettier code style!"                                                                                                                                                                                                                                                                                                                 |
| `pnpm lint`                                                                                                                                                                    | Exit 0 — no output.                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm typecheck` (`tsc -b`)                                                                                                                                                    | Exit 0 — no errors.                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm test` (root)                                                                                                                                                             | Exit 0 — `Test Files 6 passed (6)`, `Tests 244 passed (244)`.                                                                                                                                                                                                                                                                                                         |

**Commit:** `7bab721 fix: drop redundant setProjectAnnotations from storybook vitest setup` (1 file changed, 1 insertion, 11 deletions) on branch `issue-19-storybook`.

**Outcome:** The a11y gate and network guard are both fully functional with a minimal, pristine setup file — no compensating code was needed since Storybook 10.5.3's `addon-vitest` auto-provisions project + addon preview annotations (including the `a11y.test = 'error'` parameter from `.storybook/preview.ts`) once it detects no explicit `setProjectAnnotations` call in the setup file.
