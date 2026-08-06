import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

// `playwright.config.ts` (the default `pnpm test:e2e` run) has `testDir:
// './e2e'` with no `testIgnore` for this directory, so its default
// `testMatch` — `**/*.@(spec|test).ts` — recurses straight into
// `e2e/parity/`. A file matching that pattern here — `*.spec.ts` OR
// `*.test.ts` — would therefore run under `chromium`/`firefox`/`webkit` too
// (this guard's own first draft was named `naming.test.ts` and proved it:
// listing `pnpm test:e2e` crashed outright, since Playwright tried to parse
// a vitest file as a spec). Since that config never starts Backpack's dev
// server, a real test file misnamed this way would fail on connection
// refused instead — breaking the invariant that a Backpack checkout is not
// a prerequisite for the default suite. `playwright.parity.config.ts` only
// ever discovers `*.check.ts` (see its own `testMatch`), which is why every
// test file in this directory must use that suffix instead, and why this
// guard itself is `naming.guard.ts` rather than `naming.test.ts`. It runs
// under `pnpm test` (vitest), not `pnpm test:parity`, because it exists to
// catch exactly the file that leaked into the *other* run.
const FORBIDDEN_SUFFIX = /\.(spec|test)\.ts$/;

describe('e2e/parity file naming', () => {
  test('every file uses the .check.ts suffix, never .spec.ts or .test.ts', () => {
    const misnamed = readdirSync(here).filter((name) =>
      FORBIDDEN_SUFFIX.test(name)
    );

    expect(
      misnamed,
      `Found file(s) matching Playwright's default testMatch under e2e/parity/: ${misnamed.join(', ')}. ` +
        "Name it *.check.ts instead: playwright.config.ts's default run " +
        'recurses into this directory and would pick up a *.spec.ts or ' +
        '*.test.ts file, starting the chromium/firefox/webkit projects ' +
        "against it without Backpack's server running. See this file's own comment."
    ).toEqual([]);
  });
});
