/* global URL, document, console */

// #913's code-review follow-up: the e2e story under e2e/ only drives the
// client-created path (the default `loading: 'viewport'`, committed from an
// effect). The other path -- `loading="eager"`, where `@playdeck/react`
// commits at render and the server HTML carries every `sources[].media`
// candidate -- is where the native provider's `load()` fix-up lives
// (`provider-native/src/attachment.ts`'s `expectedMediaQuerySource`), and
// that fix-up depends on real engine behaviour (`matchMedia`, resource
// selection, `currentSrc`) that happy-dom cannot stand in for.
//
// Storybook is client-only (no SSR), so there is no server-rendered markup
// to drive from there. This package already runs a real `next start` with
// Playwright against it for the poster-hydration check in `test.mjs`, which
// is the cheapest existing real-SSR-plus-hydration harness in the repo --
// reused here rather than built again, adding one page and one script to an
// already-gated `pnpm test:integrations` run instead of a new CI job.
//
// Demonstrated red by a substitute mutation (docs/agents/demonstrated-red.md):
// `viewport-media.tsx`'s rendered `<source>` had its `media={media}`
// attribute removed (so the server HTML commits every candidate with no
// `media` at all), then `@playdeck/react` and this fixture were rebuilt and
// run for real against `next start`. Every browser's own selection then
// defaults to the first candidate regardless of viewport, so only the
// phone-width case still passed by coincidence; the desktop-width case
// failed for real, on chromium --
//
//   AssertionError: chromium at a desktop width: expected no request for
//   /mobile.mp4, saw 1 ([...,"/mobile.mp4",...]).
//   1 !== 0
//
// -- reverted, and the build re-run clean before this file was relied on.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '@playwright/test';
import { runWithCleanup, startNext, terminate } from './harness.mjs';

const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url));

/**
 * Every same-origin pathname requested while the fixture page loads,
 * hydrates and settles -- long enough for `load()`'s own reconciliation
 * branch to run and, if it decided the browser's pick was wrong, to issue
 * its corrective request.
 * @param {import('@playwright/test').BrowserType} engine
 * @param {{ width: number; height: number }} viewport
 * @returns {Promise<string[]>}
 */
const requestedPaths = async (engine, viewport) => {
  const { origin, server } = await startNext(fixtureDirectory);
  /** @type {string[]} */
  const paths = [];
  /** @type {import('@playwright/test').Browser | undefined} */
  let browser;
  await runWithCleanup({
    run: async () => {
      browser = await engine.launch();
      const page = await browser.newPage({ viewport });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin === origin) paths.push(url.pathname);
      });
      await page.goto(`${origin}/media-query`, { waitUntil: 'commit' });
      await page.waitForFunction(
        () => document.documentElement.dataset.hydrated === 'true',
        undefined,
        { timeout: 10_000 }
      );
      await page.waitForTimeout(1000);
    },
    closeBrowser: async () => browser?.close(),
    terminateServer: () => terminate(server)
  });
  return paths;
};

for (const [engineName, engine] of /** @type {const} */ ([
  ['chromium', chromium],
  ['firefox', firefox]
])) {
  for (const [
    widthName,
    viewport,
    expected,
    unexpected
  ] of /** @type {const} */ ([
    [
      'a phone width',
      { width: 375, height: 667 },
      '/mobile.mp4',
      '/desktop.mp4'
    ],
    [
      'a desktop width',
      { width: 1280, height: 800 },
      '/desktop.mp4',
      '/mobile.mp4'
    ]
  ])) {
    const paths = await requestedPaths(engine, viewport);
    const expectedCount = paths.filter((path) => path === expected).length;
    const unexpectedCount = paths.filter((path) => path === unexpected).length;

    assert.equal(
      unexpectedCount,
      0,
      `${engineName} at ${widthName}: expected no request for ${unexpected}, saw ${unexpectedCount} (${JSON.stringify(paths)}).`
    );
    // Exactly once, not merely "at least once": a second request for the
    // FILE ALREADY MATCHING would mean `load()`'s reconciliation restarted a
    // correct fetch instead of leaving it alone.
    assert.equal(
      expectedCount,
      1,
      `${engineName} at ${widthName}: expected exactly one request for ${expected}, saw ${expectedCount} (${JSON.stringify(paths)}).`
    );
    console.log(
      `OK: ${engineName} at ${widthName} requested only ${expected}.`
    );
  }
}
