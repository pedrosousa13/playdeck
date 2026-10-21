/* global URL, document, console, process, window, HTMLMediaElement */

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
//
// Two further red runs, both on chromium, for the request-count-is-not-the-
// claim follow-up (CI's own webkit run requested the matching file twice --
// a legitimate probe-then-range pattern, not a bug -- which a raw count
// could not tell apart from a restart):
//
// (a) same mutation as above (media attribute removed, rebuilt, rerun):
//
//   AssertionError: chromium at a desktop width: expected no request for
//   /mobile.mp4, saw 1 (["/mobile.mp4 (range: bytes=0-)"]).
//
// (b) `attachment.ts`'s `load()` mismatch guard replaced with an
// unconditional `media.load()` in the committed-at-render branch, rebuilt,
// rerun:
//
//   AssertionError: chromium at a phone width: expected media.load() never
//   called, saw 1 (requests: ["/mobile.mp4 (range: bytes=0-)"]).
//
// Both reverted, and the build re-run clean before this file was relied on.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import { runWithCleanup, startNext, terminate } from './harness.mjs';

const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url));

/** @type {Record<string, import('@playwright/test').BrowserType>} */
const BROWSER_TYPES = { chromium, firefox, webkit };

// Which engines this script drives, read from one env var rather than
// guessed -- the same per-run choice `playwright.config.ts`'s `projects`
// gives the e2e suite. Defaults to the two engines that launch on this
// machine; CI's `package` job sets this to `chromium,webkit`
// (`.github/workflows/ci.yml`) because it installs WebKit, not Firefox, and
// WebKit is the engine whose parser-vs-script `<source media>` behaviour
// motivated this path (#913's own brief). An engine named here that cannot
// launch is a failure, not a skip: nothing below catches `engine.launch()`.
const engines = (
  process.env.PLAYDECK_INTEGRATION_BROWSERS ?? 'chromium,firefox'
)
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name.length > 0)
  .map((name) => {
    const engine = BROWSER_TYPES[name];
    if (!engine) {
      throw new Error(
        `PLAYDECK_INTEGRATION_BROWSERS names an unknown engine "${name}" -- expected chromium, firefox or webkit.`
      );
    }
    return /** @type {const} */ ([name, engine]);
  });

/**
 * @typedef {{ path: string; range: string | undefined }} MediaRequest
 */

/**
 * Every same-origin media request while the fixture page loads, hydrates and
 * settles, each with its own `Range` header -- WebKit is documented to probe
 * a byte range before the real one, so the evidence a mismatch (or a
 * correctly-skipped `load()`) actually happened has to be the request
 * pattern itself, never a bare count -- alongside how many times
 * `HTMLMediaElement.prototype.load()` ran and how many `emptied` events the
 * `<video>` fired. Both read `load()` restarting resource selection, the one
 * thing a server-rendered element whose browser already picked correctly
 * must never do: `load()` is this provider's own call, and `emptied` is
 * what the media load algorithm fires at the start of every reset `load()`
 * causes, so either one firing at all means a restart happened, counted
 * through `page.addInitScript` -- installed before any page script runs,
 * ahead of hydration -- rather than through Playwright's own request log,
 * which cannot tell a restart's request from the browser's first one.
 * @param {import('@playwright/test').BrowserType} engine
 * @param {{ width: number; height: number }} viewport
 * @returns {Promise<{ requests: MediaRequest[]; loadCalls: number; emptiedCount: number }>}
 */
const observeFixture = async (engine, viewport) => {
  const { origin, server } = await startNext(fixtureDirectory);
  /** @type {MediaRequest[]} */
  const requests = [];
  /** @type {import('@playwright/test').Browser | undefined} */
  let browser;
  let loadCalls = 0;
  let emptiedCount = 0;
  await runWithCleanup({
    run: async () => {
      browser = await engine.launch();
      const page = await browser.newPage({ viewport });
      await page.addInitScript(() => {
        const instrumented =
          /** @type {Window & { __playdeckLoadCalls: number; __playdeckEmptiedCount: number }} */ (
            /** @type {unknown} */ (window)
          );
        instrumented.__playdeckLoadCalls = 0;
        instrumented.__playdeckEmptiedCount = 0;
        const originalLoad = HTMLMediaElement.prototype.load;
        HTMLMediaElement.prototype.load = function () {
          instrumented.__playdeckLoadCalls += 1;
          return originalLoad.call(this);
        };
        document.addEventListener(
          'emptied',
          () => {
            instrumented.__playdeckEmptiedCount += 1;
          },
          true
        );
      });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin === origin && url.pathname.endsWith('.mp4')) {
          requests.push({
            path: url.pathname,
            range: request.headers().range
          });
        }
      });
      await page.goto(`${origin}/media-query`, { waitUntil: 'commit' });
      await page.waitForFunction(
        () => document.documentElement.dataset.hydrated === 'true',
        undefined,
        { timeout: 10_000 }
      );
      await page.waitForTimeout(1000);
      loadCalls = await page.evaluate(
        () =>
          /** @type {Window & { __playdeckLoadCalls: number }} */ (
            /** @type {unknown} */ (window)
          ).__playdeckLoadCalls
      );
      emptiedCount = await page.evaluate(
        () =>
          /** @type {Window & { __playdeckEmptiedCount: number }} */ (
            /** @type {unknown} */ (window)
          ).__playdeckEmptiedCount
      );
    },
    closeBrowser: async () => browser?.close(),
    terminateServer: () => terminate(server)
  });
  return { requests, loadCalls, emptiedCount };
};

/** @param {MediaRequest[]} requests */
const describeRequests = (requests) =>
  JSON.stringify(
    requests.map(({ path, range }) => `${path} (range: ${range ?? 'none'})`)
  );

for (const [engineName, engine] of engines) {
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
    const { requests, loadCalls, emptiedCount } = await observeFixture(
      engine,
      viewport
    );
    const evidence = describeRequests(requests);
    const unexpectedCount = requests.filter(
      (request) => request.path === unexpected
    ).length;
    const expectedCount = requests.filter(
      (request) => request.path === expected
    ).length;

    // (a) The non-matching file is never requested, whatever pattern the
    // matching one is fetched in.
    assert.equal(
      unexpectedCount,
      0,
      `${engineName} at ${widthName}: expected no request for ${unexpected}, saw ${unexpectedCount} (${evidence}).`
    );
    // (c) The matching file is requested at least once -- how many times,
    // and in what byte ranges, is the browser's own business (WebKit is
    // documented to probe a range before the real one).
    assert.ok(
      expectedCount >= 1,
      `${engineName} at ${widthName}: expected at least one request for ${expected}, saw none (${evidence}).`
    );
    // (b) `load()` never runs, and the media load algorithm never empties
    // the element, when the browser already picked the matching source
    // itself -- the one thing a restart would do that no request count can
    // distinguish from a second, ordinary fetch of the same file.
    assert.equal(
      loadCalls,
      0,
      `${engineName} at ${widthName}: expected media.load() never called, saw ${loadCalls} (requests: ${evidence}).`
    );
    assert.equal(
      emptiedCount,
      0,
      `${engineName} at ${widthName}: expected no "emptied" event, saw ${emptiedCount} (requests: ${evidence}).`
    );
    console.log(
      `OK: ${engineName} at ${widthName} requested only ${expected}, load() and emptied both 0 (${evidence}).`
    );
  }
}
