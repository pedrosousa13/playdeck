import { expect, test, type Browser, type Page } from '@playwright/test';
import { routeYouTube } from './fixtures/youtube-fake';

const STORY =
  '/iframe.html?id=fixtures-playerfixture--interaction-youtube&viewMode=story';

/**
 * The interval from the activation press to the YouTube adapter reporting
 * `playback: 'playing'`, against `routeYouTube`'s fake `iframe_api` (the same
 * fake `e2e/youtube.spec.ts` drives) rather than the real embed -- no request
 * ever leaves the machine. There is no frame to paint here the way
 * `press-to-first-frame.spec.ts` has one: YouTube is an opaque iframe, so
 * `requestVideoFrameCallback` has nothing to attach to, and this measures the
 * adapter's own state transition instead -- a different, and looser, thing
 * than a painted frame.
 *
 * The subscription below is armed through `addInitScript`, before any page
 * script runs, the same way `e2e/youtube.spec.ts`'s `recordTextTrackSelections`
 * arms its own: `playdeckHandle` does not exist until the story mounts, and
 * attaching after `goto` would risk missing a `'playing'` patch that lands
 * before the listener does. It stores the timestamp on a plain `window`
 * property rather than `document.documentElement.dataset`, as that same
 * function does, and not as a style choice: `document.documentElement` is
 * `null` at the point chromium runs an init script (confirmed by a thrown
 * `TypeError` reading `.dataset` off it there), where firefox's does not hit
 * this -- a real cross-engine gap, not a hypothetical one, caught only
 * because the thrown error left `__playingTime` sitting at its default
 * `undefined` and the first poll read that absence as a result (the trap
 * `docs/agents/demonstrated-red.md` names). A fresh browser context per
 * sample, matching `press-to-first-frame.spec.ts`'s own choice, for the same
 * reason given there.
 */
const pressToPlaying = async (browser: Browser): Promise<number> => {
  const context = await browser.newContext();
  const page: Page = await context.newPage();
  const youtubeRequests = await routeYouTube(page);

  await page.addInitScript(() => {
    const win = window as unknown as { __playingTime: string };
    win.__playingTime = '';
    const attach = (): void => {
      const handle = window.playdeckHandle;
      if (!handle) {
        setTimeout(attach, 1);
        return;
      }
      handle.subscribe((state) => {
        if (state.playback === 'playing' && win.__playingTime === '') {
          win.__playingTime = String(
            performance.timeOrigin + performance.now()
          );
        }
      });
    };
    attach();
  });

  await page.goto(STORY);
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  expect(youtubeRequests).toEqual([]);

  await activationButton.evaluate((element) => {
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

  await activationButton.click();

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __playingTime: string }).__playingTime
      )
    )
    .not.toBe('');
  // Confirms the fake was actually exercised, not merely armed: a route that
  // never matched would leave `playback` to reach `'playing'` some other way,
  // if it could -- it cannot, since nothing but the fake's own `playVideo()`
  // confirmation ever sets it here, but asserting it directly is cheaper than
  // reasoning about it.
  expect(youtubeRequests.length).toBeGreaterThan(0);

  const [pressTime, playingTime] = await page.evaluate(() => [
    Number(document.documentElement.dataset.pressTime),
    Number((window as unknown as { __playingTime: string }).__playingTime)
  ]);

  await context.close();
  return playingTime - pressTime;
};

// Same sample count as `press-to-first-frame.spec.ts`, for the same reason.
const SAMPLE_COUNT = 5;

// Measured 2026-10-02, 15 samples per engine, on the maintainer's development
// machine -- not idle, see `press-to-first-frame.spec.ts`'s own measurement
// note for the standing background load. Chromium: min 84.4ms, median
// 154.7ms, max 593.9ms. Firefox: min 139ms, median 344ms, max 548ms. Higher,
// and far noisier, than the native clip's own numbers despite the fake's
// `playVideo()` confirming on its own next tick (`fakeIframeApi`'s
// `setTimeout(..., 0)`): unlike the native and HLS measurements beside this
// one, what this samples is a fresh browser context's first request for a
// lazily-loaded provider chunk (`provider-youtube`), two separate routed
// round trips (the `iframe_api` script, then the embed document) and a nested
// iframe's own navigation, not a single already-loaded `<video>` element --
// more there for this machine's contention to land in, which the wide spread
// between chromium's and firefox's own numbers reflects.
//
// 2000ms -- looser than `press-to-first-frame.spec.ts`'s 750ms because the
// margin that number carries over its own median (18x) would leave almost
// none here: 750ms is only about 1.26x the highest sample measured above
// (chromium's 593.9ms) and about 2.2x the higher of the two medians
// (firefox's 344ms), close enough to the kind of margin that already went red
// once on this codebase (the 1.67x margin `press-to-first-frame.spec.ts`
// cites from #744). 2000ms restores a comparable margin instead: about 3.4x
// the highest sample measured above and about 5.8x the higher median -- loose
// enough to absorb this machine's own spikes, still far below a real
// YouTube activation's own latency (DNS, TLS, the real iframe's own script
// evaluation), so it still catches a regression in the adapter's own command
// path rather than modelling the real provider's latency.
const THRESHOLD_MS = 2000;

test('presses to the YouTube adapter reporting playing within budget, against the mocked embed', async ({
  browser
}) => {
  test.setTimeout(60_000);

  const deltas: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    deltas.push(await pressToPlaying(browser));
  }
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(SAMPLE_COUNT / 2)];

  expect(median).toBeLessThan(THRESHOLD_MS);
});
