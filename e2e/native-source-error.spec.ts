import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
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

// The fixed port `source: 'no-cors'` resolves to in
// `player-fixture.stories.tsx`. A real local origin rather than a
// `page.route` fulfilment: Chromium does not apply the opaque-response
// filter to a response CDP injected for an intercepted request, so a routed
// response missing `access-control-allow-origin` loads the media anyway --
// only a genuine cross-origin network round trip reproduces the CORS block
// this issue reports.
const NO_CORS_PORT = 4174;

const clip = fileURLToPath(
  new URL('../apps/storybook/public/tracer.mp4', import.meta.url)
);

const readError = (page: Page) =>
  page.evaluate(() => window.playdeckHandle?.getState().error ?? null);

// Serves the tracer clip on `NO_CORS_HOST`, deliberately without
// `access-control-allow-origin`, so a `crossOrigin="anonymous"` fetch of it
// from the storybook origin (a different port, so a different origin) is
// genuinely subject to CORS.
const serveWithoutCors = async (body: Buffer): Promise<Server> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-length': body.byteLength,
      'content-type': 'video/mp4'
    });
    response.end(body);
  });
  await new Promise<void>((resolve) =>
    server.listen(NO_CORS_PORT, '127.0.0.1', resolve)
  );
  return server;
};

test('publishes a source error when crossOrigin blocks the only candidate on CORS', async ({
  page
}) => {
  const server = await serveWithoutCors(await readFile(clip));
  try {
    await page.goto(CROSS_ORIGIN_STORY);

    await expect.poll(() => readError(page)).not.toBeNull();
    const error = await readError(page);
    if (!error) throw new Error('expected a published error');

    expect(['source', 'network']).toContain(error.category);
    expect(error.fatal).toBe(true);
    expect(error.recoverable).toBe(false);
    expect(error.message).toContain('crossOrigin="anonymous"');

    await expect(errorDisplay(page)).toHaveAttribute('role', 'alert');
    await expect(errorDisplay(page)).toHaveAttribute(
      'data-state',
      error.category
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('publishes a source error when the only candidate 404s', async ({
  page
}) => {
  await page.route(EXTERNAL_SOURCE, (route) => route.fulfill({ status: 404 }));

  await page.goto(NOT_FOUND_STORY);

  await expect.poll(() => readError(page)).not.toBeNull();
  const error = await readError(page);

  expect(['source', 'network']).toContain(error?.category);
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
