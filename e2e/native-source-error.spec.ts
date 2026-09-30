import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { errorDisplay, playButton } from './locators';

// #857: `Player.Media` renders every candidate as a `<source>` child, and a
// failed `<source>` fires `error` on itself -- never on the media element --
// leaving `media.error` null even once nothing is left to try. A CORS block
// and a 404 both produce exactly that shape, with nothing in the DOM events
// to tell them apart, so both are exercised here.
const CROSS_ORIGIN_STORY =
  '/iframe.html?id=fixtures-playerfixture--native-source-error-cross-origin&viewMode=story';
const NOT_FOUND_STORY =
  '/iframe.html?id=fixtures-playerfixture--native-source-error-404&viewMode=story';
const MULTI_STORY =
  '/iframe.html?id=fixtures-playerfixture--native-source-error-multi&viewMode=story';

const EXTERNAL_SOURCE = 'https://provider.invalid/tracer.mp4';
const FIRST_MULTI_SOURCE = 'https://source-a.invalid/clip.mp4';
const SECOND_MULTI_SOURCE = 'https://source-b.invalid/clip.mp4';

// Served by `e2e/fixtures/no-cors-server.mjs`, started once for the whole
// run by `playwright.config.ts`'s `webServer` array -- a real local origin
// distinct from the storybook dev server's, rather than a `page.route`
// fulfilment: Chromium does not apply the opaque-response filter to a
// response CDP injected for an intercepted request, so a routed response
// missing `access-control-allow-origin` loaded the media anyway in an
// earlier draft of this test. Only a genuine cross-origin network round trip
// reproduces the CORS block this issue reports, and a server every project
// shares avoids chromium, firefox and a retry racing to bind the same port
// (`no-cors-server.mjs`'s header has the rest of that reasoning).
const NO_CORS_SOURCE = 'http://127.0.0.1:4174/tracer.mp4';

const clip = fileURLToPath(
  new URL('../apps/storybook/public/tracer.mp4', import.meta.url)
);

const readError = (page: Page) =>
  page.evaluate(() => window.playdeckHandle?.getState().error ?? null);

test('publishes a source error when crossOrigin blocks the only candidate on CORS', async ({
  page
}) => {
  await page.goto(CROSS_ORIGIN_STORY);

  await expect.poll(() => readError(page)).not.toBeNull();
  const error = await readError(page);
  if (!error) throw new Error('expected a published error');

  // Ties this spec's `NO_CORS_SOURCE` to the story's own `'no-cors'`
  // resolution, so the two cannot drift apart in silence. After the error,
  // not before: the `<source>` element is not guaranteed mounted the instant
  // `goto` resolves.
  expect(await page.evaluate(() => document.querySelector('source')?.src)).toBe(
    NO_CORS_SOURCE
  );

  // `'source'` on both engines, measured directly rather than assumed: the
  // category is hard-coded by `sourceExhausted` and never inferred from an
  // engine's own signals, so there is no path to `'network'` here on either
  // one -- that category belongs to the pre-existing element-level `onError`
  // handler this fix leaves alone.
  expect(error.category).toBe('source');
  expect(error.fatal).toBe(true);
  expect(error.recoverable).toBe(false);
  expect(error.message).toContain('crossOrigin="anonymous"');

  await expect(errorDisplay(page)).toHaveAttribute('role', 'alert');
  await expect(errorDisplay(page)).toHaveAttribute(
    'data-state',
    error.category
  );
});

test('publishes a source error when the only candidate 404s', async ({
  page
}) => {
  await page.route(EXTERNAL_SOURCE, (route) => route.fulfill({ status: 404 }));

  await page.goto(NOT_FOUND_STORY);

  await expect.poll(() => readError(page)).not.toBeNull();
  const error = await readError(page);

  // Measured on both engines the same way the CORS case above was: category
  // `'source'`, never `'network'` (see the comment there).
  expect(error?.category).toBe('source');
  expect(error?.fatal).toBe(true);
});

test('publishes no error and plays when the first candidate 404s and the second loads', async ({
  page
}) => {
  const body = await readFile(clip);
  await page.route(FIRST_MULTI_SOURCE, (route) =>
    route.fulfill({ status: 404 })
  );
  await page.route(SECOND_MULTI_SOURCE, (route) =>
    route.fulfill({
      body,
      headers: {
        'content-length': String(body.byteLength),
        'content-type': 'video/mp4'
      },
      status: 200
    })
  );

  await page.goto(MULTI_STORY);
  const play = playButton(page);
  await expect(play).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().activation)
    )
    .toBe('ready');

  expect(await readError(page)).toBeNull();

  await play.click();
  await expect(play).toHaveAttribute('data-state', 'playing');
  expect(await readError(page)).toBeNull();
});
