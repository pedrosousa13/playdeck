# Task 1 Report: Scaffold `apps/storybook`

## Status: DONE_WITH_CONCERNS

## What was implemented

All files specified in the brief were created/modified, plus one small structural adaptation (documented below) required to make TypeScript actually resolve `@storybook/react-vite` from a story file that lives inside `packages/react/src/`.

- Created `apps/storybook/package.json` (Storybook 10.5.3 workspace app manifest) — verbatim from brief.
- Created `apps/storybook/.storybook/main.ts` — verbatim from brief.
- Created `apps/storybook/.storybook/preview.ts` — verbatim from brief.
- Created `apps/storybook/tsconfig.json` — brief content **plus** a `paths` entry (see "Deviation" below).
- Created `packages/react/src/poster.stories.tsx` — verbatim from brief.
- Modified `packages/react/tsconfig.json` — added `"exclude": ["src/**/*.stories.tsx"]`, verbatim.
- Modified `packages/react/tsconfig.test.json` — added the same exclude, verbatim.
- Modified root `tsconfig.json` — appended `{ "path": "./apps/storybook" }` to `references`, verbatim.
- Modified `.gitignore` — appended `storybook-static/`, verbatim.
- Modified `eslint.config.js` — appended `'apps/storybook/storybook-static/**'` to the `ignores` array, verbatim.
- Modified `pnpm-workspace.yaml` — added `esbuild: false` under `allowBuilds` (reviewed decision from the controller; see "Build-script decision" below). `sharp@0.34.5: true` is untouched — the set of **allowed** builds stays exactly that one entry.

## Build-script decision (reviewed, per controller instruction)

First `pnpm install` failed with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1` (exit 1) — a new transitive dependency (pulled in via the Storybook/Vite/Vitest toolchain) wanting to run a native build script that wasn't part of the existing allowlist. I stopped and reported BLOCKED with the exact text (pnpm also auto-wrote an undecided placeholder line into `pnpm-workspace.yaml`, which I reverted rather than deciding myself).

The controller reviewed this and instructed an explicit **decline**:

```yaml
allowBuilds:
  sharp@0.34.5: true
  esbuild: false
```

Rationale (per controller): esbuild's platform binary ships as an optional dependency (e.g. `@esbuild/darwin-arm64`); its postinstall only replaces a JS shim with the prebuilt binary for startup speed, so declining the build script is safe — esbuild still works, just via the (slightly slower) JS fallback path if the platform binary isn't otherwise present.

After adding `esbuild: false`, `pnpm install` exited 0 with no build-script warnings. `pnpm --filter @reely/storybook build` (the storybook production build, which runs Vite/esbuild under the hood) succeeded and produced `apps/storybook/storybook-static/` — this is direct proof esbuild functions correctly without its postinstall build step, confirming the rationale. The `storybook build` was re-run again after later fixes (see below) and still succeeded cleanly.

## Deviation from the brief: `paths` entry in `apps/storybook/tsconfig.json`

**What happened:** `pnpm typecheck` (`tsc -b`) failed with:

```
packages/react/src/poster.stories.tsx(1,37): error TS2307: Cannot find module '@storybook/react-vite' or its corresponding type declarations.
```

**Root cause (diagnosed with `tsc --traceResolution`):** `poster.stories.tsx` is physically located inside `packages/react/src/`, but `@storybook/react-vite` is a `devDependency` only of `apps/storybook`. pnpm's non-hoisted (per-package) `node_modules` layout means `@storybook/react-vite` is only symlinked into `apps/storybook/node_modules/`, not into any ancestor directory of `packages/react/src/poster.stories.tsx` (`packages/react/node_modules`, `packages/node_modules`, and root `node_modules` all lack it — confirmed with `ls`).

By contrast, the brief's own `import * as Player from '@reely/react'` in the same file resolves fine, but for a different, non-obvious reason: TypeScript's `bundler` resolution mode implements Node's **package self-reference** feature — climbing from the importing file to the nearest ancestor `package.json` whose `name` matches the specifier. `packages/react/package.json` is named `@reely/react`, so the self-reference resolves via its own `exports` map to `packages/react/dist/index.d.ts`, with no `node_modules` lookup at all. This mechanism only applies when the specifier equals the enclosing package's own name — it does not help `@storybook/react-vite`, which is a genuinely external dependency of a sibling app.

This means the brief's inline comment ("Stories … are type-checked by THIS project") does not hold as written for `@storybook/react-vite` imports under pnpm's default (non-hoisted) `node_modules`.

**Fix applied (scoped to the one project, one specifier):** added a `paths` mapping in `apps/storybook/tsconfig.json` pointing the bare specifier straight at the package's public declaration entry point (the same file its own `exports.".".types` field names), so it does not depend on the fragile pnpm virtual-store hash path:

```json
"paths": {
  "@storybook/react-vite": [
    "./node_modules/@storybook/react-vite/dist/index.d.ts"
  ]
}
```

No `baseUrl` was needed (TypeScript 4.1+ resolves `paths` relative to the tsconfig's own directory when `baseUrl` is absent; adding an explicit `baseUrl` instead produced a `TS5101` deprecation error under TypeScript 6.0.3, so it was left out). Verified with `tsc --traceResolution` that the substitution now resolves cleanly against the `dist/index.d.ts` file (bypassing the classic file/folder-only lookup that a bare folder path would trigger, which does **not** consult the package's `exports` map — my first attempt, pointing at the bare package folder, still failed for exactly that reason).

**Why I didn't consider this "structural, can't work":** the fix is a one-line, single-specifier addition local to `apps/storybook/tsconfig.json`; it changes no other file, adds no new dependency, and doesn't touch hoisting/lockfile behavior. It's the same class of fix as an "API differs, adapt minimally" case, just triggered by a `node_modules`-layout/resolution nuance rather than a Storybook API rename. Full `pnpm typecheck` (`tsc -b`, the whole project-reference graph) now passes with exit 0.

**Risk to flag:** if a later task (2–4) adds a story file elsewhere in `packages/react/src` (or `packages/core`/`provider-native`) that imports another `@storybook/*` package (e.g. an addon) not already covered, the same `TS2307` failure mode will recur for that new bare specifier and will need an analogous `paths` entry added at that time.

## Verification commands run (in order)

| #   | Command                                                              | Exit | Notes                                                                                                                                                                          |
| --- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pnpm install` (1st attempt)                                         | 1    | `ERR_PNPM_IGNORED_BUILDS: esbuild@0.28.1` — reported BLOCKED, awaited reviewed decision.                                                                                       |
| 2   | `pnpm install` (2nd, after adding `esbuild: false` to `allowBuilds`) | 0    | No build-script warnings. Lockfile updated with new dev-dependency tree for `@reely/storybook`.                                                                                |
| 3   | `pnpm --filter @reely/storybook build`                               | 0    | Emits `apps/storybook/storybook-static/`; confirms esbuild works without its postinstall.                                                                                      |
| 4   | `pnpm format`                                                        | 0    | No files rewritten (all already Prettier-formatted).                                                                                                                           |
| 5   | `pnpm format:check`                                                  | 0    | "All matched files use Prettier code style!"                                                                                                                                   |
| 6   | `pnpm lint`                                                          | 0    | No output — no violations.                                                                                                                                                     |
| 7   | `pnpm typecheck` (first run, before the `paths` fix)                 | 2    | `TS2307: Cannot find module '@storybook/react-vite'` in `poster.stories.tsx` — diagnosed and fixed per above.                                                                  |
| 8   | `pnpm typecheck` (after the `paths` fix)                             | 0    | Clean.                                                                                                                                                                         |
| 9   | `pnpm test`                                                          | 0    | `Test Files 6 passed (6)`, `Tests 244 passed (244)` — identical to the documented 244/244 baseline; the stories file is not matched by the `packages/**/*.test.{ts,tsx}` glob. |
| 10  | `pnpm build`                                                         | 0    | Full `pnpm -r --if-present run build`, includes `apps/storybook build$ storybook build` → "Storybook build completed successfully". All other packages/apps built clean too.   |

## Files changed

- `apps/storybook/package.json` (new)
- `apps/storybook/.storybook/main.ts` (new)
- `apps/storybook/.storybook/preview.ts` (new)
- `apps/storybook/tsconfig.json` (new, includes the `paths` addition described above)
- `packages/react/src/poster.stories.tsx` (new)
- `packages/react/tsconfig.json` (modified — exclude added)
- `packages/react/tsconfig.test.json` (modified — exclude added)
- `tsconfig.json` (modified — reference added)
- `.gitignore` (modified — `storybook-static/` added)
- `eslint.config.js` (modified — ignore pattern added)
- `pnpm-workspace.yaml` (modified — `esbuild: false` added to `allowBuilds`; `sharp@0.34.5: true` unchanged)
- `pnpm-lock.yaml` (modified — new dev-dependency entries resolved for `@reely/storybook`)

Commit: `4334ae7` — `feat: scaffold Storybook 10.5.3 workspace app with source aliases`

## Self-review

- **Completeness:** every file the brief lists was created/modified with content matching the brief. Every verification command from Steps 7–8 was run, in order, and all pass with exit 0.
- **Discipline:** no changes beyond the brief's scope except the two reviewed/necessary adaptations: (a) `esbuild: false` in `allowBuilds` (explicit controller decision, not my own call), and (b) the `paths` entry in `apps/storybook/tsconfig.json` (minimal, single-specifier, scoped to the one project, needed to make the brief's stated intent — "stories are type-checked by THIS project" — actually true under pnpm's real `node_modules` layout). Nothing else was touched; no unrelated formatting or refactors.
- **Quality:** `pnpm test` output is unchanged from baseline (244/244, same 6 test files) — the new story file is correctly excluded from the unit-test glob. `pnpm build` output is clean, no new warnings other than Vite's expected "chunk larger than 500 kB" advisory notice on the Storybook preview bundle (informational, not an error, not something the brief asked to address).

## Concerns

- The `paths` addition in `apps/storybook/tsconfig.json` is a deviation from the brief's exact file content (not just "adapt minimally," it's a genuinely new key). I judged it in-scope because it is a small, local, single-purpose fix that makes the brief's own stated intent work correctly, rather than a sign the overall approach is broken. Flagging clearly in case the reviewer prefers a different resolution strategy (e.g. hoisting `@storybook/*` via `.npmrc`, or moving story files elsewhere) — happy to switch approaches if asked.
- Per the note above, expect the same TS2307 pattern to recur for any new `@storybook/*` bare-specifier import introduced in later tasks' story files that isn't already covered by this one `paths` entry.
