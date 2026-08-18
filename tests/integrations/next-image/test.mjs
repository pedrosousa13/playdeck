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
  },
  closeBrowser: async () => browser?.close(),
  terminateServer: () => terminate(server)
});
