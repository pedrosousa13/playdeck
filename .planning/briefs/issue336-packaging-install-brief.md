### Issue #336: the packaging harness runs an unpinned install, in the publishing job

**P0.** Step 1 has landed in #348; Steps 2–4 remain. This is the highest-priority
item in the v1 contract (#344), criterion 14. Read the escalation comment on #336 before starting — the issue body's impact
bound was written before the first release and is wrong in a way that changes
what this work is for.

## What changed since the issue was filed

The body concludes "this is not a route to a poisoned published artifact today —
nothing is published and the registry 404s for every name". Every clause of that
is now false:

- all seven packages are on npm at `0.1.0` (2026-08-18)
- `.github/workflows/release.yml` exists
- `NPM_TOKEN` exists as a repository secret

And `release.yml` runs `pnpm test:packages` **in the same job as
`pnpm publish -r`**. `NODE_AUTH_TOKEN` is step-scoped so the token is not
directly readable from the earlier step, but code executing during
`test:packages` runs before the tarballs are packed, on the same filesystem, in
the same job. It can tamper with what gets published, under a provenance
attestation that would then vouch for the result.

## The three gaps, re-verified against current `scripts/verify-packaging.mjs`

- `:242` — `mkdtempSync(join(tmpdir(), 'playdeck-packaging-fixture-'))` puts the
  fixture outside the repo, so the root `pnpm-workspace.yaml` no longer governs
  it. Confirmed empirically in the issue: `pnpm config get minimumReleaseAge`
  reads `1440` inside the repo and `undefined` outside.
- `:264-271` — the synthesised `pnpm-workspace.yaml` carries only the
  `@playdeck/*` tarball overrides. The six advisory floors are absent.
- `:274` — `pnpm install --no-frozen-lockfile`. A genuine open resolution: the
  fixture carries no lockfile and `pnpm-workspace.yaml` does not glob
  `tests/packaging/*`, so it is not a workspace member either.
- `:277` — `pnpm run build`, which executes the resolved package code. pnpm 10's
  default script blocking does not help: it blocks _lifecycle_ scripts, and this
  is an explicit `run`.

**Files:**

- Modify: `.github/workflows/release.yml` (split the job — Step 1)
- Create: `tests/packaging/fixture/pnpm-lock.yaml` (Step 2)
- Modify: `scripts/verify-packaging.mjs` (Steps 2–3)
- Modify: `pnpm-workspace.yaml` (only if Step 3 needs the floors mirrored)

## Steps

- [x] **Step 1 — split the job. Done in #348.** `pnpm test:packages` now runs in
      a `package-verify` job with `contents: read`, no `id-token`, no
      `registry-url` and no secret, which `release` depends on. This brief
      originally said to move four steps, which was wrong: `git grep` for an
      unpinned install returns exactly one hit (`verify-packaging.mjs:274`), and
      `tests/bundle/*` and `tests/integrations/*` are both globbed by
      `pnpm-workspace.yaml`, so the root lockfile and the advisory floors already
      govern them. Only `test:packages` moved; `test:budgets`, `test:bundle` and
      `test:integrations` stay in `release`, where they keep the attestation
      meaningful. The cost is recorded in the workflow: `release` builds its own
      tarballs, so `package-verify` proves the packaging of an equivalent build
      rather than of the exact bytes that ship. Steps 2–4 remove that tradeoff.

- [ ] **Step 2 — commit a lockfile for the fixture.** The issue establishes the
      flag is a convenience, not a constraint: the tarball paths are
      temp-dir-specific, but the fixture's four fixed dependencies (`react`,
      `react-dom`, `vite`, `@vitejs/plugin-react`) can carry a committed
      lockfile with the `@playdeck/*` entries resolved separately. Work out how
      to keep the tarball overrides out of the committed lockfile — that is the
      design question this step turns on, and it should be answered before any
      code is written.

- [ ] **Step 3 — carry the cooldown and the floors into the fixture.** The
      synthesised workspace file is written by `verify-packaging.mjs:264-271`
      and is the only reason those settings are lost. Copy
      `minimumReleaseAge` and the advisory floors from the root
      `pnpm-workspace.yaml` rather than restating them, so a floor added later
      cannot silently fail to reach here.

- [ ] **Step 4 — prove the install is pinned.** A test that fails if
      `--no-frozen-lockfile` returns, or if the synthesised workspace file omits
      the floors. Without it this regresses the first time somebody finds the
      flag convenient again.

## Acceptance criteria

- [ ] The publishing job does not run the packaging harness. `release.yml` shows
      the packaging work in a separate job the publish depends on.
- [ ] `git grep -n 'no-frozen-lockfile'` returns nothing under `scripts/`.
- [ ] The fixture install resolves from a committed lockfile, and CI proves it
      by failing when the lockfile is stale.
- [ ] `pnpm config get minimumReleaseAge` inside the fixture directory returns
      `1440`, not `undefined`. Verify by execution, the way the issue did — this
      is the claim most likely to be assumed rather than checked.
- [ ] The advisory floors apply inside the fixture.
- [ ] `pnpm test:packages` still does what it exists to do: the packed tarballs
      install into a throwaway project and the Playwright smoke test passes.

## Out of scope

- #335 (the audit gate measuring a rewritten graph) and #337 (the gate script
  being editable by the pull request it gates). Same OWASP family, same v1
  cluster, separate issues.
- #343, the move to OIDC. It removes the token; this removes the adjacency. They
  are independent and either can land first.

## Do not dispatch Release until #348 lands

The workflow is `workflow_dispatch`-only, so nothing fires it by accident, but a
deliberate dispatch before #348 merges runs the unpinned install in the
publishing job again. Once it has merged, Release is safe to dispatch: the
install is still unpinned, but it no longer shares a job with the token or with
the step that packs the tarballs. Steps 2–4 are then ordinary hardening rather
than an operational hold.
