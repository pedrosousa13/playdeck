import { expect, test, type Browser, type Page } from '@playwright/test';
import { media, playButton } from './locators';

const STORY =
  '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story';

/**
 * The interval from the activation press to the first painted video frame,
 * on the workbench's local, one-second tracer clip.
 *
 * "Painted" is `requestVideoFrameCallback`, not the `playing` event: rVFC
 * fires once the browser has actually composited a frame, where `playing`
 * can fire before that frame has reached the screen. The callback's `now`
 * argument is on the same clock as `performance.now()` (both relative to
 * `performance.timeOrigin`), so subtracting the two needs no unit
 * conversion.
 *
 * Each sample opens a fresh browser context rather than reusing the page and
 * re-navigating: a video decoder reused across navigations in the same
 * context measurably shortens later samples (observed while deriving the
 * threshold below -- reusing the page produced a run of small or negative
 * deltas, which a fresh context per sample did not).
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

  // Armed before the click, not after: `requestVideoFrameCallback` only
  // fires for a frame composited after it is registered, so registering it
  // first is what makes the callback's `now` the *first* frame's timestamp
  // rather than a later one.
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

  // Polled rather than read once: a frame that never paints must fail this
  // test, not report a delta computed from the empty string this dataset
  // entry starts at (`Number('')` is `0`, which would read as a suspiciously
  // fast, wrongly passing measurement rather than an absent one).
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

// How many samples one run takes before reporting their median. Five gives
// the median two samples on each side to reject, without paying for many
// more fresh browser contexts than that -- see THRESHOLD_MS below for why
// the median, rather than the max or a single sample, is what gets compared
// to it.
const SAMPLE_COUNT = 5;

// Measured 2026-09-18, 15 samples per engine, on the maintainer's development
// machine -- not idle: Docker, ClickHouse and a Plausible instance run on it
// permanently, and two to three other Claude Code sessions were active
// through the measurement. Chromium: min 9.4ms, median 42ms, max 209.4ms
// (five of the fifteen landed between 190ms and 210ms, the rest between 9ms
// and 43ms -- a contention spike, not a gradual drift, and it recurred across
// repeated runs). Firefox: min -10.8ms, median 1.5ms, max 11.4ms (the small
// negative readings are cross-process clock skew between the compositor's
// rVFC timestamp and `performance.now()`, not a real negative latency --
// unsurprising for a one-second clip fully buffered before the press). This
// file carries no WebKit measurement: no baseline exists for that engine
// here, so the threshold below is a prediction for it rather than a number
// derived the way the chromium and firefox figures are.
//
// One threshold covers all three engines rather than one per engine.
// WebKit's `requestVideoFrameCallback` support is old enough (Safari 15.4)
// that there is no reason to expect its number to be an order of magnitude
// past chromium's spikes, and this repo's CI has already surfaced
// timing-shaped failures a local run never reproduced -- #746 pinned a
// WebKit state assertion that nobody local could retune and that went red
// on an unrelated pull request. Splitting this threshold now, with nothing
// to check the WebKit half against, would add exactly that kind of number.
// If CI's first run against this spec disagrees with 750ms on WebKit,
// `toBeLessThan`'s failure prints the received value -- that is WebKit's
// real number, and the threshold is re-derived from it then. A red WebKit
// run here is information this file does not yet have, not a defect to
// pre-empt by picking a number large enough never to fire: the repo's
// stated posture is that WebKit's numbers are CI's to establish.
//
// 750ms is about 3.6x the highest single sample measured above (chromium's
// 209.4ms) and about 18x its median (42ms) -- looser than the 1.67x margin
// that still went red in #744 (a 1500ms poll over a 900ms timer that
// restarts on re-render), but far below a threshold sized to survive any
// single sample this machine produced. It is sized against the median
// deliberately rather than the max: SAMPLE_COUNT's median already absorbs
// one contention spike on its own, so sizing the threshold again against
// the worst single sample would be spending the same protection twice. What
// 750ms buys over a much larger number is that it still fails on the
// 42ms-to-500ms class of regression, which a threshold picked to survive
// any single sample, however extreme, would pass without comment.
const THRESHOLD_MS = 750;

test('presses to a painted first frame within budget on the local clip', async ({
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
