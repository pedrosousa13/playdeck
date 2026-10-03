import { expect, test, type Browser, type Page } from '@playwright/test';
import { routeVimeo } from './fixtures/vimeo-fake';
import { routeYouTube } from './fixtures/youtube-fake';
import { activationButton } from './locators';

/**
 * The interval from a hover-then-press gesture to the adapter reporting
 * `playback: 'playing'`, against one `warmUp` on/off pair of
 * `player-fixture.stories.tsx` stories that otherwise share every other arg.
 * Hovering first, rather than clicking cold the way
 * `press-to-playing-youtube.spec.ts` and `press-to-playing-vimeo.spec.ts` do,
 * is what gives `warmUp`'s early import -- started on the first
 * `pointerenter` `Player.ActivationButton` receives -- time to run before the
 * press it is meant to get ahead of; a cold click fires `pointerenter` and
 * `click` back to back, in the same gesture, leaving the import no head
 * start either way.
 *
 * `route` is left `undefined` for HLS: the local `hls.js`-driven fixture
 * reaches no third-party host at all, so there is nothing to fake and no
 * route needed -- the same reason `press-to-first-frame-hls.spec.ts` does not
 * mock anything either.
 */
const pressToPlaying = async (
  browser: Browser,
  story: string,
  route?: (page: Page) => Promise<unknown>
): Promise<number> => {
  const context = await browser.newContext();
  const page: Page = await context.newPage();
  if (route) await route(page);

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

  await page.goto(story);
  const button = activationButton(page);
  await expect(button).toBeVisible();

  await button.hover();
  await button.evaluate((element) => {
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
  await button.click();

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __playingTime: string }).__playingTime
      )
    )
    .not.toBe('');

  const [pressTime, playingTime] = await page.evaluate(() => [
    Number(document.documentElement.dataset.pressTime),
    Number((window as unknown as { __playingTime: string }).__playingTime)
  ]);

  await context.close();
  return playingTime - pressTime;
};

// Matching every other activation-latency spec's own sample count, for the
// same reason: five gives the median two samples on each side to reject
// without paying for many more fresh browser contexts than that.
const SAMPLE_COUNT = 5;

const median = async (
  browser: Browser,
  story: string,
  route?: (page: Page) => Promise<unknown>
): Promise<number> => {
  const deltas: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    deltas.push(await pressToPlaying(browser, story, route));
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(SAMPLE_COUNT / 2)]!;
};

// Each pair is logged rather than asserted against a threshold: what this
// file exists to report is the before/after comparison itself (recorded in
// the commit that adds it), not a regression budget -- `pressToPlaying`'s own
// two providers already carry one of those, in
// `press-to-playing-youtube.spec.ts` and `press-to-playing-vimeo.spec.ts`.
test('warmUp before/after: YouTube, mocked embed', async ({ browser }) => {
  test.setTimeout(60_000);
  const off = await median(
    browser,
    '/iframe.html?id=fixtures-playerfixture--interaction-youtube&viewMode=story',
    routeYouTube
  );
  const on = await median(
    browser,
    '/iframe.html?id=fixtures-playerfixture--interaction-youtube-warm-up&viewMode=story',
    routeYouTube
  );
  console.log(
    `[warmUp] YouTube press-to-playing median: off ${off}ms, on ${on}ms`
  );
  expect(on).toBeGreaterThanOrEqual(0);
});

test('warmUp before/after: Vimeo, mocked embed', async ({ browser }) => {
  test.setTimeout(60_000);
  const off = await median(
    browser,
    '/iframe.html?id=fixtures-playerfixture--vimeo-interaction&viewMode=story',
    routeVimeo
  );
  const on = await median(
    browser,
    '/iframe.html?id=fixtures-playerfixture--vimeo-interaction-warm-up&viewMode=story',
    routeVimeo
  );
  console.log(
    `[warmUp] Vimeo press-to-playing median: off ${off}ms, on ${on}ms`
  );
  expect(on).toBeGreaterThanOrEqual(0);
});

test('warmUp before/after: HLS, local hls.js fixture', async ({ browser }) => {
  test.setTimeout(60_000);
  const off = await median(
    browser,
    '/iframe.html?id=fixtures-playerfixture--hls-interaction&viewMode=story'
  );
  const on = await median(
    browser,
    '/iframe.html?id=fixtures-playerfixture--hls-interaction-warm-up&viewMode=story'
  );
  console.log(`[warmUp] HLS press-to-playing median: off ${off}ms, on ${on}ms`);
  expect(on).toBeGreaterThanOrEqual(0);
});
