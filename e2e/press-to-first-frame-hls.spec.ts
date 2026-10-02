import { expect, test, type Browser, type Page } from '@playwright/test';
import { media, playButton } from './locators';

// `HlsHlsJs` (`player-fixture.stories.tsx`) pins `engine: 'hls.js'` rather than
// `'auto'`: this measures the hls.js-driven path specifically, because that is
// the engine chromium and firefox both resolve to (neither ships native HLS),
// and pinning it keeps the story's own resolution logic from being part of
// what this test measures. The manifest and its renditions
// (`apps/storybook/public/hls/`) are served by the same local Storybook dev
// server every other spec in this file uses, so there is no third-party host
// in the loop for this measurement to route around.
const STORY =
  '/iframe.html?id=fixtures-playerfixture--hls-hls-js&viewMode=story';

/**
 * The interval from the activation press to the first painted video frame, on
 * the local HLS fixture served through hls.js. Same method as
 * `press-to-first-frame.spec.ts`'s `pressToFirstFrame`: hls.js attaches the
 * decoded stream to a real `<video>` element the same way the native provider
 * does, so `requestVideoFrameCallback` measures the same event for both, and
 * "painted", not `playing`, is still the signal -- see that file's comment for
 * why the two can diverge.
 */
const pressToFirstFrame = async (browser: Browser): Promise<number> => {
  const context = await browser.newContext();
  const page: Page = await context.newPage();
  await page.goto(STORY);
  const play = playButton(page);
  await expect(play).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().activation)
    )
    .toBe('ready');

  // Armed before the click, not after -- see `press-to-first-frame.spec.ts`'s
  // identical comment above its own `requestVideoFrameCallback` registration.
  await media(page).evaluate((el: HTMLVideoElement) => {
    document.documentElement.dataset.firstFrameTime = '';
    el.requestVideoFrameCallback((now) => {
      document.documentElement.dataset.firstFrameTime = String(
        performance.timeOrigin + now
      );
    });
  });
  await play.evaluate((element) => {
    document.documentElement.dataset.pressTime = '';
    element.addEventListener(
      'click',
      () => {
        document.documentElement.dataset.pressTime = String(
          performance.timeOrigin + performance.now()
        );
      },
      { capture: true, once: true }
    );
  });

  await play.click();

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.dataset.firstFrameTime)
    )
    .not.toBe('');

  const [pressTime, firstFrameTime] = await page.evaluate(() => [
    Number(document.documentElement.dataset.pressTime),
    Number(document.documentElement.dataset.firstFrameTime)
  ]);

  await context.close();
  return firstFrameTime - pressTime;
};

// Same sample count as `press-to-first-frame.spec.ts`, for the same reason:
// the median of five rejects up to two outliers on each side without paying
// for many more fresh browser contexts per run.
const SAMPLE_COUNT = 5;

// Measured 2026-10-02, 15 samples per engine, on the maintainer's development
// machine -- not idle, see `press-to-first-frame.spec.ts`'s own measurement
// note for the standing background load. Chromium: min 14.9ms, median 28.5ms,
// max 42.2ms. Firefox: min -11.0ms, median -1.2ms, max 3.1ms (small and
// negative readings are cross-process clock skew between the compositor's
// rVFC timestamp and `performance.now()`, the same effect the native file's
// own measurement note explains). Both engines land close to the native
// clip's own numbers, which is expected: hls.js demuxes and feeds a
// `MediaSource` on the same `<video>` element the native provider plays into
// directly, and the fixture's first segment is a few hundred milliseconds of
// video, not meaningfully more to decode than the native tracer clip.
//
// 750ms, matching `press-to-first-frame.spec.ts`'s own threshold and its
// reasoning: one number for chromium and firefox rather than one per engine,
// sized against the median rather than the single worst sample, is about
// 18x the highest sample measured above (chromium's 42.2ms) and about 26x its
// median (28.5ms) -- loose enough to absorb this machine's own contention
// spikes, tight enough to still fail on a regression in the hundreds of
// milliseconds. No WebKit measurement is carried here for the same reason the
// native file carries none: WebKit does not launch on this machine, and CI's
// first run against this spec is where that number comes from.
const THRESHOLD_MS = 750;

test('presses to a painted first frame within budget on the local hls.js fixture', async ({
  browser
}) => {
  test.setTimeout(60_000);

  const deltas: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    deltas.push(await pressToFirstFrame(browser));
  }
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(SAMPLE_COUNT / 2)];

  expect(median).toBeLessThan(THRESHOLD_MS);
});
