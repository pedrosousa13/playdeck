import { defineConfig } from '@playwright/test';
import { resolveBackpackDir } from './e2e/parity/backpack-dir';

// Thrown here, at config load, rather than left to surface as an opaque
// webServer spawn failure once Playwright is already mid-startup.
const backpackDir = resolveBackpackDir(process.env);

export default defineConfig({
  testDir: './e2e/parity',
  // Playwright's default testMatch is `**/*.@(spec|test).ts`, evaluated
  // relative to `testDir` — but `testDir` is a filter on top of
  // `playwright.config.ts`'s own './e2e', not a separate root, so a file
  // under here named `*.spec.ts` runs under BOTH configs: this one, and every
  // project of the untouched main config (`pnpm test:e2e`), which is exactly
  // what "must not join the default e2e run" rules out. `.check.ts` is
  // outside that default pattern, so only this config ever discovers these.
  testMatch: '**/*.check.ts',
  // Generous like the main config (see its own comment): a cold Backpack
  // storybook dev boot is the expensive part here, not any one test.
  timeout: 30_000,
  // Same idiom as playwright.config.ts (see its comment on this option): one
  // baseline set, produced and compared on the same machine.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: { toHaveScreenshot: { threshold: 0.1 } },
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: [
    // Reely's own Storybook, spawned exactly as playwright.config.ts spawns
    // it — same command, same port — so a story id that resolves there
    // resolves the same way for both suites.
    {
      command:
        'pnpm --filter @reely/storybook exec storybook dev --ci --no-open -p 4173 --host 127.0.0.1',
      url: 'http://127.0.0.1:4173/index.json',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    // Backpack's own Storybook. `storybook dev` alone serves without compiled
    // Tailwind CSS — its own `predev` hook is what runs `build:css` first
    // (see the plan's "Facts verified" section) — so the command chains it
    // explicitly rather than relying on a script this checkout might not run
    // the same way. Measured: build:css ~19s, then "Storybook ready" ~6s
    // more. Playwright's 60s default has no headroom over that cold total, so
    // a first run timing out there is a configuration bug, not a broken
    // prerequisite.
    {
      command: 'npm run build:css && npx storybook dev --ci --no-open -p 6007',
      cwd: backpackDir,
      url: 'http://127.0.0.1:6007/index.json',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000
    }
  ],
  // One project: this harness compares two Storybooks, not this repo's own
  // browser matrix — see playwright.config.ts's `chromium`/`firefox`/`webkit`
  // for that concern.
  projects: [{ name: 'parity' }]
});
