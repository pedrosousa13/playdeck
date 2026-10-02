import { expect, test, type Browser, type Page } from '@playwright/test';
import { routeVimeo } from './fixtures/vimeo-fake';

const STORY =
  '/iframe.html?id=fixtures-playerfixture--vimeo-interaction&viewMode=story';

/**
 * The interval from the activation press to the Vimeo adapter reporting
 * `playback: 'playing'`, against `routeVimeo`'s fake embed page (the same
 * fake `e2e/vimeo.spec.ts` drives, `e2e/fixtures/vimeo-embed.html`) rather
 * than the real player -- no request ever leaves the machine. As with the
 * YouTube measurement beside this one, there is no frame to paint: Vimeo is
 * an opaque iframe, so this measures the adapter's own state transition
 * instead of anything `requestVideoFrameCallback` could observe.
 *
 * Same `addInitScript` arming as `press-to-playing-youtube.spec.ts`, for the
 * same reason: `playdeckHandle` does not exist until the story mounts, so
 * attaching after `goto` risks missing a `'playing'` patch that lands before
 * the listener does. It stores the timestamp on a plain `window` property
 * rather than `document.documentElement.dataset`, for the same reason given
 * there: `document.documentElement` is `null` at the point chromium runs an
 * init script, a real cross-engine gap caught only because the resulting
 * thrown error left the dataset entry at its default and the first poll read
 * that absence as a result. A fresh browser context per sample, matching
 * `press-to-first-frame.spec.ts`'s own choice.
 */
const pressToPlaying = async (browser: Browser): Promise<number> => {
  const context = await browser.newContext();
  const page: Page = await context.newPage();
  const vimeoRequests = await routeVimeo(page);

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
  expect(vimeoRequests).toEqual([]);

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
  // See `press-to-playing-youtube.spec.ts`'s identical assertion for why this
  // is checked directly rather than inferred.
  expect(vimeoRequests.length).toBeGreaterThan(0);

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
// note for the standing background load. Chromium: min 206.5ms, median
// 294.5ms, max 553.2ms. Firefox: min 153ms, median 199ms, max 401ms. Same
// shape as the YouTube measurement beside this one and for the same reason --
// a lazily-loaded provider chunk, a routed `oembed` lookup, and a real
// embed document (`vimeo-embed.html`) the iframe navigates to and parses
// before its script posts the player-ready and play-confirmed messages --
// rather than a single already-loaded `<video>` element.
//
// 2000ms, matching `press-to-playing-youtube.spec.ts`'s own threshold and its
// reasoning: about 3.6x the highest sample measured above (chromium's
// 553.2ms) and about 6.8x the higher of the two medians (chromium's
// 294.5ms) -- loose enough to absorb this machine's own spikes, still far
// below a real Vimeo activation's own cost, so this exists to catch a
// regression in the adapter's own command path rather than to model
// real-provider latency.
const THRESHOLD_MS = 2000;

test('presses to the Vimeo adapter reporting playing within budget, against the mocked embed', async ({
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
