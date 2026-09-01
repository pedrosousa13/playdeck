import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

// Under `storybook dev`, Vite's dependency optimizer serves hls.js from its
// deps cache (e.g. /node_modules/.cache/storybook/<version>/<hash>/sb-vite/deps/hls__js.js),
// not the production build's content-hashed /assets/hls-*.js chunk name.
const hlsLibraryChunk = /\/deps\/hls__js\.js$/;

const recordRequests = (page: Page): string[] => {
  const requests: string[] = [];
  page.on('request', (request) => {
    requests.push(new URL(request.url()).pathname);
  });
  return requests;
};

// The live fixture is a sliding media playlist with no #EXT-X-ENDLIST, served by
// the docs Vite plugin. Liveness is derived from stream data, so a neutral URL
// (/live/index.m3u8, nothing "live" about the path beyond the folder name is
// load-bearing) is still detected through the hls.js live flag or an infinite
// duration.

test('detects a live stream and adapts controls on the hls.js engine', async ({
  browserName,
  page
}) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  const requests = recordRequests(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--live-hls-js&viewMode=story'
  );

  await expect(page.getByTestId('hls-engine')).toHaveText('hls.js');

  // Live status is derived, not guessed from the URL.
  const panel = page.getByTestId('live-panel');
  await expect(panel).toHaveAttribute('data-live-known', 'true');
  await expect(panel).toHaveAttribute('data-live-status', 'live');

  // The time display never shows a fixed duration or NaN while live.
  const time = page.getByTestId('live-time');
  await expect(time).not.toContainText('NaN');
  await expect(time).not.toContainText('/');

  expect(requests).toContain('/live/index.m3u8');
  expect(requests.some((path) => hlsLibraryChunk.test(path))).toBe(true);
});

test('surfaces a behind-edge seek within the live window on the hls.js engine', async ({
  browserName,
  page
}) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');
  // The window has to fill and settle at the live edge before a behind-edge
  // seek is meaningful, which takes longer than the default per-test budget.
  test.setTimeout(30_000);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--live-hls-js&viewMode=story'
  );
  await expect(page.getByTestId('hls-engine')).toHaveText('hls.js');

  const panel = page.getByTestId('live-panel');
  await expect(panel).toHaveAttribute('data-live-status', 'live');

  // Once the buffer fills, hls.js parks the position at the live edge.
  await expect(panel).toHaveAttribute('data-live-edge', 'at-edge', {
    timeout: 15_000
  });

  // Jumping to the oldest available position stays inside the window and reads
  // as behind the live edge.
  await page.getByTestId('live-seek-back').click();
  await expect(panel).toHaveAttribute('data-live-edge', 'behind-edge');
  const time = page.getByTestId('live-time');
  await expect(time).not.toContainText('NaN');
  await expect(time).toContainText('-');

  // Jumping back to the live edge returns to at-edge.
  await page.getByTestId('live-seek-edge').click();
  await expect(panel).toHaveAttribute('data-live-edge', 'at-edge');
});

// #465: a `startTime` on a live source. The offset is bounded by the media's
// duration and then only written where the seekable window covers it, so on a
// live stream it either lands on the offset or is reported as refused — the
// outcome it can no longer have is the playhead pulled onto the edge of the
// window with success reported.
//
// This fixture reaches the first half of that and not the second. Its window
// starts at 0 and grows from there rather than sliding its front edge forward
// — sampled on 2026-09-01 on chromium and firefox, `seekable` went
// `[[0, 20]]` to `[[0, 26]]` over six samples with the start never leaving 0 —
// so an offset below the window is not expressible against it, and the case
// where it is below one (`startTime: 5` against `[[100, 200]]`) is pinned by
// the unit test 'writes no initial position onto the nearest seekable edge' in
// `packages/provider-native/test/index.test.ts`.
test('applies a start offset inside the live window on the hls.js engine', async ({
  browserName,
  page
}) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--live-hls-js-start-time&viewMode=story'
  );
  await expect(page.getByTestId('hls-engine')).toHaveText('hls.js');

  const panel = page.getByTestId('live-panel');
  await expect(panel).toHaveAttribute('data-live-status', 'live');

  // Polled rather than read once, and the outcome is a moment rather than a
  // resting state: the offset is applied on the first `loadedmetadata`, and
  // hls.js then does its own live-edge sync over the top of it — sampled on
  // 2026-09-01, the playhead sat at 5 and was at the live edge (19.0) less
  // than 1.5s later, where it stayed. So this asks whether the offset was ever
  // reached, not where the playhead came to rest, and the polling interval has
  // to stay well inside that second. The element is paused throughout, so it
  // cannot pass through the offset by playing to it.
  //
  // A silent drop fails this by timing out with neither half true, which is
  // the intended failure and the slow one.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = window.playdeckHandle?.getState();
          return (
            Math.abs((state?.currentTime ?? -1) - 5) <= 0.25 ||
            state?.error?.category === 'configuration'
          );
        }),
      { intervals: [100], timeout: 15_000 }
    )
    .toBe(true);
});

test('detects a live stream and never shows a fixed duration on native HLS', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName !== 'webkit' || process.platform !== 'darwin',
    'Native HLS requires WebKit on macOS; Linux WebKit lacks native HLS.'
  );

  const requests = recordRequests(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--live-native&viewMode=story'
  );

  await expect(page.getByTestId('hls-engine')).toHaveText('native');
  await playButton(page).click();

  const panel = page.getByTestId('live-panel');
  await expect(panel).toHaveAttribute('data-live-status', 'live');

  const time = page.getByTestId('live-time');
  await expect(time).not.toContainText('NaN');
  await expect(time).not.toContainText('/');

  expect(requests).toContain('/live/index.m3u8');
  // Native HLS never downloads hls.js.
  expect(requests.some((path) => hlsLibraryChunk.test(path))).toBe(false);
});
