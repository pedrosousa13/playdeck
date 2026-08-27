/* global URL, document, getComputedStyle */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { runWithCleanup, startNext, terminate } from './harness.mjs';

const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url));

/**
 * @typedef {{ x: number; y: number; width: number; height: number }} Rectangle
 */

/**
 * @param {Rectangle} actual
 * @param {Rectangle} expected
 */
const equalRectangles = (actual, expected) => {
  for (const key of /** @type {const} */ (['x', 'y', 'width', 'height'])) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 0.01,
      `${key} differs: ${actual[key]} !== ${expected[key]}`
    );
  }
};

/** @param {import('@playwright/test').Page} page */
const readPosterMarkup = (page) =>
  page
    .locator('[data-playdeck-part="poster"]')
    .evaluate((/** @type {HTMLElement} */ poster) => {
      const image = poster.querySelector('img[alt=""]');
      if (!image) throw new Error('Expected a poster image in the live DOM.');
      return {
        hydrated: document.documentElement.dataset.hydrated === 'true',
        imageConnected: image.isConnected,
        posterConnected: poster.isConnected,
        position: getComputedStyle(image).position,
        srcset: image.getAttribute('srcset'),
        sizes: image.getAttribute('sizes'),
        image: image.getBoundingClientRect().toJSON(),
        poster: poster.getBoundingClientRect().toJSON()
      };
    });

/** @type {import('@playwright/test').Browser | undefined} */
let browser;
const { origin, server } = await startNext(fixtureDirectory);

await runWithCleanup({
  run: async () => {
    browser = await chromium.launch();
    const page = await browser.newPage();
    /** @type {string[]} */
    const failures = [];
    let scriptsReleased = false;
    /** @type {() => void} */
    let resolveHeldScripts = () => {};
    const heldScriptsReleased = new Promise((resolve) => {
      resolveHeldScripts = () => resolve(undefined);
    });
    const releaseHeldScripts = () => {
      if (scriptsReleased) return;
      scriptsReleased = true;
      resolveHeldScripts();
    };

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && url.protocol !== 'data:') {
        failures.push(`External request: ${url.href}`);
        await route.abort();
        return;
      }
      if (
        url.origin === origin &&
        route.request().resourceType() === 'script'
      ) {
        await heldScriptsReleased;
      }
      await route.continue();
    });
    page.on('console', (message) => {
      if (message.type() === 'error')
        failures.push(`Console error: ${message.text()}`);
    });
    page.on('pageerror', (error) =>
      failures.push(`Page error: ${error.message}`)
    );

    try {
      const firstScriptRequest = page.waitForRequest(
        (request) =>
          new URL(request.url()).origin === origin &&
          request.resourceType() === 'script',
        { timeout: 10_000 }
      );
      await Promise.all([
        firstScriptRequest,
        page.goto(`${origin}/`, { waitUntil: 'commit' })
      ]);
      await page
        .locator('[data-playdeck-part="poster"] img[alt=""]')
        .waitFor({ state: 'attached', timeout: 10_000 });

      const beforeHydration = await readPosterMarkup(page);
      assert.equal(beforeHydration.hydrated, false);
      assert.equal(beforeHydration.posterConnected, true);
      assert.equal(beforeHydration.imageConnected, true);
      assert.equal(beforeHydration.position, 'absolute');
      assert.ok(
        beforeHydration.srcset,
        'Expected pre-hydration Next Image responsive srcset markup.'
      );
      assert.ok(
        beforeHydration.sizes,
        'Expected pre-hydration Next Image sizes markup.'
      );
      equalRectangles(beforeHydration.image, beforeHydration.poster);

      releaseHeldScripts();
      await page.waitForFunction(
        () => document.documentElement.dataset.hydrated === 'true'
      );
      await page.waitForLoadState('networkidle');

      const afterHydration = await readPosterMarkup(page);
      assert.equal(afterHydration.hydrated, true);
      assert.equal(afterHydration.posterConnected, true);
      assert.equal(afterHydration.imageConnected, true);
      assert.equal(afterHydration.position, 'absolute');
      assert.ok(
        afterHydration.srcset,
        'Expected post-hydration Next Image responsive srcset markup.'
      );
      assert.ok(
        afterHydration.sizes,
        'Expected post-hydration Next Image sizes markup.'
      );
      equalRectangles(afterHydration.image, afterHydration.poster);
      equalRectangles(afterHydration.image, beforeHydration.image);
      equalRectangles(afterHydration.poster, beforeHydration.poster);
      assert.deepEqual(failures, []);
    } finally {
      releaseHeldScripts();
    }

    // The RSC route. `app/rsc/page.tsx` is a server component that imports the
    // primitives with no `'use client'` of its own, so the build that produced
    // this page is already most of the evidence: without the directive
    // @playdeck/react ships on its entry, `next build` fails on that file and
    // there is nothing here to drive. What is left to observe is that the
    // boundary works in both directions -- the server pass renders the
    // primitives into the streamed HTML, and the client pass hydrates them into
    // something that answers a click.
    const rscPage = await browser.newPage();
    /** @type {string[]} */
    const rscFailures = [];
    await rscPage.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && url.protocol !== 'data:') {
        rscFailures.push(`External request: ${url.href}`);
        await route.abort();
        return;
      }
      await route.continue();
    });
    rscPage.on('console', (message) => {
      if (message.type() === 'error')
        rscFailures.push(`Console error: ${message.text()}`);
    });
    rscPage.on('pageerror', (error) =>
      rscFailures.push(`Page error: ${error.message}`)
    );

    const served = await rscPage.goto(`${origin}/rsc`, { waitUntil: 'commit' });
    // Read off the response body rather than the DOM, so this is the markup the
    // server produced and not a post-hydration reading of it. The attribute
    // carries a value `@playdeck/core`'s `detectSource` computed in the server
    // graph, where that package has no client boundary and needs none.
    assert.match(
      (await served?.text()) ?? '',
      /data-source-status="success"/,
      'Expected @playdeck/core to have run in the server graph.'
    );

    const activation = rscPage.locator('[data-playdeck-part="activation"]');
    await activation.waitFor({ state: 'attached', timeout: 10_000 });
    assert.equal(await activation.getAttribute('data-state'), 'dormant');
    // A click the DOM answers is what separates hydrated primitives from
    // server-rendered markup that only looks like them: `data-state` is written
    // from `usePlayerState`, and nothing moves it off `dormant` until React has
    // attached this button's handler on the client.
    await activation.click();
    await rscPage.waitForFunction(
      () =>
        document
          .querySelector('[data-playdeck-part="activation"]')
          ?.getAttribute('data-state') !== 'dormant',
      undefined,
      { timeout: 10_000 }
    );
    assert.deepEqual(rscFailures, []);
  },
  closeBrowser: async () => browser?.close(),
  terminateServer: () => terminate(server)
});
