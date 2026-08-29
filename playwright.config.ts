import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The e2e server is `storybook dev`, which compiles each story on first
  // request. On slower CI runners (notably Linux WebKit) that cold compile can
  // push the first interaction past a tight budget, so allow generous headroom.
  timeout: 30_000,
  // Retry on CI: a first attempt warms Storybook's on-demand story compile, so
  // the retry hits a compiled story and runs fast. Also absorbs known
  // CPU-contention flakiness under full parallel load. Locally, no retries.
  retries: process.env.CI ? 2 : 0,
  // Tests tagged @real hit third-party networks and are nondeterministic, so
  // they never block; opt in with PLAYDECK_REAL_PROVIDERS=1.
  grepInvert: process.env.PLAYDECK_REAL_PROVIDERS ? undefined : /@real/,
  // One baseline set, not one per platform. The default template appends
  // `-{projectName}-{platform}`, which here would mean a darwin set nobody can
  // regenerate on linux and a linux set nobody can regenerate on darwin. There
  // is no docker on the maintainer's machine, so the images are produced where
  // CI runs and compared where CI runs; see
  // `.github/workflows/visual-baselines.yml`.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  // Playwright's default screenshot threshold is 0.2, and pixelmatch turns that
  // into `maxDelta = 35215 * threshold ** 2` = 1408.6 in YIQ space
  // (`playwright-core/lib/coreBundle.js:6792`). Measured: repainting the whole
  // reference control bar from rgb(4, 6, 10) to rgb(90, 6, 10) is a delta of
  // 1184.1 — under the default it passed, and a falsification run went green
  // against a visibly red bar. At 0.1 the same change fails with room to spare,
  // while pixelmatch's own antialiasing detection still absorbs edge noise.
  expect: { toHaveScreenshot: { threshold: 0.1 } },
  use: { baseURL: 'http://127.0.0.1:4173' },
  // Two servers, and `baseURL` above names the first: the workbench is what
  // almost every spec here drives, so a relative `page.goto` stays a story.
  // `site-ledger.spec.ts` writes its address out in full for that reason.
  webServer: [
    {
      command:
        'pnpm --filter @playdeck/storybook exec storybook dev --ci --no-open -p 4173 --host 127.0.0.1',
      url: 'http://127.0.0.1:4173/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    /*
     * The built site, for `e2e/site-search.spec.ts` (#525). A second server
     * rather than a second Playwright project: it serves a different artifact,
     * not a different engine, and the specs that use it want the same three
     * engines as everything else.
     *
     * It is built rather than served by `astro dev` because the search index is
     * a build artifact — `apps/site/package.json` runs Pagefind over `dist/`
     * after Astro has finished — so the dev server would serve a site with no
     * index in it and the search tests would fail for a reason that is not a
     * defect.
     *
     * Two builds, at two prefixes, from the same source. The site ships from
     * the apex so `base` is `/`, which is the one prefix at which a path
     * written as a literal and a path derived from `import.meta.env.BASE_URL`
     * are the same string. The second build is what makes the difference
     * observable; `scripts/serve-site.mjs` mounts both at once so one server
     * answers for both.
     */
    {
      command:
        'pnpm exec turbo run build --filter=@playdeck/site... && pnpm --filter @playdeck/site run build:based && node scripts/serve-site.mjs --port 4322 --mount /=apps/site/dist --mount /playdeck/=apps/site/dist-base',
      url: 'http://127.0.0.1:4322/playdeck/reference/',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
      reuseExistingServer: !process.env.CI,
      timeout: 300_000
    }
  ],
  projects: [
    // `visual` runs chromium only, so a visual test is +1 to the suite, not
    // +3. The three engine projects ignore it explicitly rather than relying
    // on a grep, so `pnpm test:e2e --project=chromium` keeps its exact count.
    //
    // `*.contract.test.ts` files are vitest unit tests for a seam extracted
    // out of a spec in this directory (e.g. background-image-scan.ts), run by
    // `pnpm test` instead — Playwright's default testMatch would otherwise
    // also collect them, since it matches any `*.test.ts`.
    {
      name: 'chromium',
      testIgnore: [/visual\.spec\.ts/, /\.contract\.test\.ts$/],
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      testIgnore: [/visual\.spec\.ts/, /\.contract\.test\.ts$/],
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      testIgnore: [/visual\.spec\.ts/, /\.contract\.test\.ts$/],
      use: { ...devices['Desktop Safari'] }
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
