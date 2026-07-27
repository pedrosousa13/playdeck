# CI-enforced typechecked docs examples (#18)

**Issue:** #18 (parent #1), the docs-audit half. #18 is labelled `blocked`, but its blockers (#17's device matrix, #32's visual review) gate its _approval_ checkboxes, not this mechanism. Nothing here depends on hardware or an owner review.

## Goal

Make every code example in the published docs a file the compiler reads, and make a drifted example fail CI. Today none of the 20 `ts`/`tsx` blocks across the READMEs and Storybook MDX compiles: `packages/core/README.md:18` leans on an undeclared `videoElement` and a top-level `await`. Prose and code can silently disagree, and for a package nobody has installed yet, the README _is_ the product.

Two acceptance criteria of #18 are in scope:

- Every public export documented with a typechecked example, CI-enforced.
- The docs audit itself — gaps the coverage check names get filled.

Out of scope: release metadata, the packaging harness (#33, already green), the prerelease changeset dry run, release notes, and every HITL box. Those are the rest of #18.

## Scope decision (owner, 2026-07-27)

"Every public export" means **every value export**: `PlayerController`, `detectSource`, each `create*Provider`, every React component and hook. Type exports stay covered by the existing reference tables in each README and by appearing in the fixtures' signatures. The alternative reading — an example per type — multiplies the fixture count roughly fourfold for types that are already exhaustively tabled, and buys no compile coverage the value examples don't already give.

## Architecture

Three pieces, one new command.

### 1. `examples/` — the fixtures

Real `.ts`/`.tsx` files at the repo root, one per doc section, named by doc slug: `core-quickstart.ts`, `react-composition.tsx`, `provider-hls-live.ts`, and so on. Thirteen, listed below.

`examples/tsconfig.json` is a new project referenced from the root `tsconfig.json` — the same shape #109 gave `scripts/` and `tests/`, so `pnpm typecheck` picks the fixtures up with no second command to remember and no CI job to add.

`@reely/*` resolves to `packages/*/dist/index.d.ts` through `paths`, with a project `reference` to each package — exactly what `e2e/tsconfig.json` does. `pnpm typecheck` is `tsc -b`, and every package tsconfig is `composite` + `emitDeclarationOnly`, so the build mode emits those declarations before the examples project is checked. No build step to add, and the fixtures are checked against **the type surface a consumer installs**, not against source. That is the whole point for a docs example: an example that only compiles against `src` can still be wrong for the person who ran `pnpm add @reely/core`.

Fixtures are self-contained: every identifier they use is declared in the file. That is the point of the exercise, not an inconvenience of it.

### 2. Injection into the docs

Each doc fence that mirrors a fixture is wrapped in markers, and the generator writes the fixture body between them.

In `.md`:

    <!-- example:core-quickstart -->

    ```ts
    …generated…
    ```

    <!-- /example -->

In `.mdx`, `{/* example:core-quickstart */}` and `{/* /example */}` — MDX 2 rejects HTML comments, and Storybook's MDX is v3. Only `Theme.mdx` and `CapabilitiesMatrix.mdx` carry `ts` blocks; the other five MDX files and every `sh`/`css` fence are untouched.

The docs stay plain Markdown with the example inline. npm renders a README raw from the tarball — a doc that says "see `examples/core-quickstart.ts`" is worse for exactly the reader #18 targets, and a publish-time build step to inline them is a second thing that can be wrong.

### 3. `scripts/docs-examples.mjs`

One script, two modes, matching the repo's existing `scripts/*.mjs` convention (`.mjs` + JSDoc, typechecked since #109).

- Default: rewrite the marked regions in place. This is how an example change reaches the docs.
- `--check`: do the same rewrite in memory and exit 1 on any byte difference, naming the file and marker. This is the drift gate.

`--check` also runs the **export coverage check**:

- Enumerate each package's public value exports through the TypeScript compiler API — `ts.createProgram` over `packages/*/src/index.ts[x]`, then the entry module's exports filtered to `SymbolFlags.Value`. Source, not `dist`, so the check does not silently pass on stale declarations when run alone; the two agree, and `dist/index.d.ts` was used to confirm it. Not a grep over source files: `packages/react/src/index.tsx:2724` re-exports the icon set with `export *`, while `useActivation` and `loadProvider` are declared `export` in their own modules and are deliberately **not** part of the public entry. A grep gets both of those wrong in opposite directions.
- Tokenize every fixture into a Set of identifiers (`/[A-Za-z_$][\w$]*/g`) and assert each public value export appears in at least one. Whole-token matching, so `Time` is not satisfied by the word "sometimes".
- An uncovered export fails with its name and package. That converts #18's acceptance criterion from a thing somebody audited once into a thing that stays true.

### Wiring

- `"docs:check"`, `"docs:examples"`, and `"test:docs"` in the root `package.json`. The last runs the script's own `node --test` unit tests, following the `tests/integrations/next-image/harness.test.mjs` precedent for testing a `.mjs` harness.
- Appended to the static CI line, `.github/workflows/ci.yml:29`: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:docs && pnpm docs:check`. No new job, no extra runner minutes. `typecheck` runs first because `tsc -b` emits the declarations the examples project resolves through `paths`.
- `examples/` joins the typecheck projects, so a fixture that stops compiling also fails `pnpm typecheck` on its own.

## Fixture inventory

Sized from the real export surface, not guessed:

| Fixture                 | Covers                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `core-quickstart.ts`    | `PlayerController`, `detectSource`, `createNativeProvider`                                                       |
| `core-state.ts`         | `createInitialPlayerState`, `textTrackLabel`                                                                     |
| `core-media-session.ts` | `getMediaSessionCoordinator`, `bindMediaSession`                                                                 |
| `provider-native.ts`    | `createNativeProvider` options surface                                                                           |
| `provider-hls.ts`       | `createHlsProvider`, `detectHlsEnvironment`, `selectHlsEngine`                                                   |
| `provider-hls-live.ts`  | `deriveLiveState`                                                                                                |
| `provider-youtube.ts`   | `createYouTubeProvider`, `loadYouTubeIframeApi`, `PLAYBACK_CONFIRMATION_TIMEOUT_MS`                              |
| `provider-vimeo.ts`     | `createVimeoProvider`, `loadVimeoSdk`, `resetVimeoSdkLoader`                                                     |
| `react-composition.tsx` | `Root`, `Viewport`, `Media`, `Poster`, `Controls`, and the button primitives                                     |
| `react-hooks.tsx`       | `usePlayerState`, `useActiveCues`, `usePlayerActions`                                                            |
| `react-menus.tsx`       | `SettingsMenu` family, `MenuItem`, `MenuRadioGroup`, `MenuRadioItem`, `CaptionsMenu`                             |
| `react-poster.tsx`      | `normalizePoster`, `PosterImage`, `LoadingIndicator`, `ErrorDisplay`, `Captions`, `Gestures`, `ActivationButton` |
| `react-icons.tsx`       | the 14 icon exports                                                                                              |

The coverage check, not this table, is the authority. If it names an export no fixture reaches, a fixture grows to reach it.

## Falsification

No check is trusted until it has been watched to fail. Three deliberate breakages, each reverted:

1. Break a fixture's types → `pnpm typecheck` exits non-zero.
2. Hand-edit an injected block in a README → `pnpm docs:check` exits 1 naming that file and marker.
3. Delete one export's use from its fixture → coverage fails naming that export.

Plus the trap #109 recorded: a `tsconfig.json` with a wrong `include` typechecks nothing and reports success. `examples/tsconfig.json` is confirmed to exit 2 on a deliberate error before it is believed.

## Consequences accepted

- Examples get longer. The core README block gains a `videoElement` declaration and loses its top-level `await`. That is the drift being removed, not a cost.
- Fixtures typecheck against source, not the published `.d.ts` — see the `paths` reasoning above. `test:packages` owns the published surface.
- The generator is one-way: the fixture is the source of truth and a doc edit inside a marked region is reverted by `pnpm docs:examples`, or fails `--check` if committed. Edits go in the fixture.

## Verification

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm docs:check && pnpm test
```

Baselines to hold (as of `c59d626`): 816 unit tests, e2e 160 passed / 20 skipped, storybook 80. Run gates unpiped — a pipe swallows the exit code.

## Changeset

None. No published package _source_ is touched: fixtures, a script, a tsconfig, CI, and doc prose. `.changeset/first-prerelease.md` is corrected in place if that ever stops being true.
