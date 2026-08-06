# e2e/parity

The BackpackVideo-vs-Backpack comparison harness (SIDEPRO-211). Run it with
`pnpm test:parity`; see `playwright.parity.config.ts` at the repo root for
what it spawns and why.

## Naming rule: test files here end in `.check.ts`, never `.spec.ts` or `.test.ts`

`playwright.config.ts` (the default `pnpm test:e2e` run) has `testDir:
'./e2e'` and no `testIgnore` for this directory, so its default `testMatch`
— `**/*.@(spec|test).ts` — recurses straight into `e2e/parity/`. A file named
`*.spec.ts` **or** `*.test.ts` here would run under that config too: either
alongside `chromium`/`firefox`/`webkit`, or — as this guard's own first draft
proved — crash `pnpm test:e2e --list` outright by handing Playwright a vitest
file it can't parse as a spec. Since the default run never starts Backpack's
dev server, a real test misnamed this way would fail on connection refused
instead — breaking the invariant that a Backpack checkout is not a
prerequisite for `pnpm test:e2e`.

`playwright.parity.config.ts` only ever discovers `*.check.ts` files (see its
`testMatch`). Name every test file in this directory that way — including
this directory's own guard, which is why it is `naming.guard.ts` and not
`naming.test.ts`. A `*.spec.ts` or `*.test.ts` file here is checked for and
fails `pnpm test` (see `naming.guard.ts`) — not just `pnpm test:parity` —
specifically to catch a misnamed file before it can join the default suite.
