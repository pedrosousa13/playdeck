### Task 5: Conventions doc + full verification gate

**Files:**

- Create: `apps/storybook/README.md`
- Verify (no expected change): `pnpm-workspace.yaml` allowlist, published package manifests.

**Interfaces:**

- Consumes: everything above; this is the documentation + final-gate task.

- [ ] **Step 1: Write the conventions README**

`apps/storybook/README.md`:

````markdown
# @playdeck/storybook

Component workbench and story-based test runner for `@playdeck/react`.

## Commands

| Command                                 | What it does                                   |
| --------------------------------------- | ---------------------------------------------- |
| `pnpm --filter @playdeck/storybook dev` | Storybook dev server on port 6006              |
| `pnpm test:storybook` (root)            | Runs every story as a Chromium Vitest test     |
| `pnpm build` (root)                     | Includes the static `storybook build` CI check |

## Conventions

- **Stories live next to their component:** `packages/react/src/<part>.stories.tsx`.
- **One story per meaningful state.** A component with four `data-state`
  values gets four stories, named after the state.
- **Stories are tests.** Every story runs in a real browser with an axe
  check (`a11y.test = 'error'`). A story's `play` function is its
  interaction test — see `ActivatesOnClick` in
  `packages/react/src/activation.stories.tsx` for the reference pattern:
  arrange via `parameters.playdeck`, act with `userEvent`, assert on
  `data-state`.
- **No real media, no network.** A global `afterEach` fails any story test
  that touches an external origin or the fake media source. Use data-URI
  images; use `/__playdeck/hang.png` for perpetual-loading states.

## Dialing player state

The global `withMockController` decorator wraps every story in
`Player.Root` backed by a fake provider (the same fixture the contract
tests use). Control it per story:

```ts
parameters: {
  playdeck: {
    rootProps: { loading: 'interaction' },   // any Player.Root props
    scenario: { kind: 'pending' }            // provider-load scenario
  }
}
```

Scenarios:

- `{ kind: 'resolve', patches?: [...] }` (default) — provider loads;
  optional `ProviderStatePatch` list dials post-ready state
  (e.g. `{ buffering: true }`).
- `{ kind: 'pending' }` — provider load never settles
  (`loading-provider`).
- `{ kind: 'reject', message? }` — provider load fails (`error`).

Pre-provider activation states come from real strategy behavior: use
`loading="interaction"` and click (or omit `Player.Media` to hold
`eligible`). In `play` functions, `getFakeProviderHandle()` from
`apps/storybook/src/mock-provider-loader.ts` exposes the live fake
provider for further `emit()` patches.

## Adding stories for a new issue

1. Create `packages/react/src/<part>.stories.tsx`.
2. Cover every visual state the issue defines, one story each.
3. Add at least one `play` interaction story if the component has
   interaction semantics.
4. Run `pnpm test:storybook` — new stories are picked up automatically.
````

- [ ] **Step 2: Confirm the dependency policy held**

```sh
git diff main -- pnpm-workspace.yaml packages/core/package.json packages/provider-native/package.json packages/react/package.json
```

Expected: NO diff (allowlist unchanged, published manifests unchanged).

- [ ] **Step 3: Run the full verification gate (serially, fresh)**

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm test:packages
pnpm test:bundle
pnpm test:integrations
pnpm test:storybook
```

Expected: every command exits 0. `pnpm test` count matches main's baseline (244) — stories add no happy-dom tests. `test:bundle` proves published bundles unaffected.

- [ ] **Step 4: Commit**

```sh
git add -A
git commit -m "docs: document story conventions for later issues"
```

---

## Acceptance-criteria trace (from issue #19)

| Criterion                                                             | Where satisfied                            |
| --------------------------------------------------------------------- | ------------------------------------------ |
| Storybook 10.5.x + Vite 8 + React 19; build green in CI               | Task 1 (build via root `pnpm build` in CI) |
| Mock decorator dials any `PlayerState`, proof of no network           | Tasks 2 (guard) + 3 (decorator/scenarios)  |
| Stories for all poster + activation states                            | Tasks 3 + 4                                |
| Every story = browser-mode Vitest test with axe, in root scripts + CI | Task 2                                     |
| ≥1 play-function reference story                                      | Task 3 (`ActivatesOnClick`)                |
| Conventions documented                                                | Task 5                                     |
| Storybook only in devDependencies; published pkgs unaffected          | Task 1 + Task 5 Step 2 + bundle gate       |
