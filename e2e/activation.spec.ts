import {
  expect,
  test,
  type Locator,
  type Page,
  type Request
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { playButton } from './locators';

const providerOrigin = 'https://provider.invalid';
const tracerUrl = `${providerOrigin}/tracer.mp4`;
const sourceAUrl = `${providerOrigin}/source-a.mp4`;
const sourceBUrl = `${providerOrigin}/source-b.mp4`;
const tracerBytes = readFile(
  new URL('../apps/storybook/public/tracer.mp4', import.meta.url)
);

type RecordedRequest = {
  fulfilled: boolean;
  readonly request: Request;
};

const routeProviderMedia = async (
  page: Page,
  beforeFulfill?: Promise<void>
): Promise<RecordedRequest[]> => {
  const requests: RecordedRequest[] = [];
  const body = await tracerBytes;
  await page.route(`${providerOrigin}/**`, async (route) => {
    const request = route.request();
    const recordedRequest = { fulfilled: false, request };
    requests.push(recordedRequest);
    await beforeFulfill;
    await route.fulfill({
      body,
      contentType: 'video/mp4',
      status: 200
    });
    recordedRequest.fulfilled = true;
  });
  return requests;
};

const armClickTimestamp = async (
  button: Locator,
  key: string
): Promise<void> => {
  await button.evaluate((element, datasetKey) => {
    document.documentElement.dataset[datasetKey] = '';
    element.addEventListener(
      'click',
      () => {
        document.documentElement.dataset[datasetKey] = String(
          performance.timeOrigin + performance.now()
        );
      },
      { capture: true, once: true }
    );
  }, key);
};

const readTimestamp = async (page: Page, key: string): Promise<number> =>
  page
    .locator('html')
    .evaluate(
      (element, datasetKey) =>
        Number((element as HTMLElement).dataset[datasetKey]),
      key
    );

const expectRequestsAfter = async (
  page: Page,
  requests: RecordedRequest[],
  clickTime: number,
  expectedUrls: readonly string[]
): Promise<void> => {
  await expect
    .poll(() => requests.every(({ fulfilled }) => fulfilled))
    .toBe(true);
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every(({ request }) => expectedUrls.includes(request.url()))
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (urls) =>
          performance
            .getEntriesByType('resource')
            .filter(({ name }) => urls.includes(name)).length,
        expectedUrls
      )
    )
    .toBeGreaterThan(0);
  const resourceTimings = await page.evaluate(
    (urls) =>
      performance
        .getEntriesByType('resource')
        .filter(({ name }) => urls.includes(name))
        .map(({ name, startTime }) => ({
          startTime: performance.timeOrigin + startTime,
          url: name
        })),
    expectedUrls
  );
  const requestTimings = requests
    .map(({ request }) => ({
      startTime: request.timing().startTime,
      url: request.url()
    }))
    .filter(({ startTime }) => startTime > 0);
  expect(
    [...resourceTimings, ...requestTimings].every(
      ({ startTime }) => startTime >= clickTime
    ),
    JSON.stringify({
      clickTime,
      requestTimings,
      resourceTimings
    })
  ).toBe(true);
};

const countRequests = (requests: RecordedRequest[], url: string): number =>
  requests.filter(({ request }) => request.url() === url).length;

const requestsFor = (
  requests: RecordedRequest[],
  url: string
): RecordedRequest[] => requests.filter(({ request }) => request.url() === url);

test('interaction activation makes no provider request before click', async ({
  page
}) => {
  const providerRequests = await routeProviderMedia(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-external&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  await expect(page.getByTestId('viewport')).toBeVisible();
  await armClickTimestamp(activationButton, 'activationClick');
  expect(providerRequests).toEqual([]);

  await activationButton.click();

  await expect.poll(() => providerRequests.length).toBeGreaterThan(0);
  const clickTime = await readTimestamp(page, 'activationClick');
  await expectRequestsAfter(page, providerRequests, clickTime, [tracerUrl]);
});

test('interaction source change stays dormant until a second click', async ({
  page
}) => {
  const providerRequests = await routeProviderMedia(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-source-change-muted&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  await armClickTimestamp(activationButton, 'sourceAClick');
  expect(providerRequests).toEqual([]);

  await activationButton.click();

  await expect
    .poll(() => countRequests(providerRequests, sourceAUrl))
    .toBeGreaterThan(0);
  const sourceAClick = await readTimestamp(page, 'sourceAClick');
  await expectRequestsAfter(page, providerRequests, sourceAClick, [sourceAUrl]);
  await expect(activationButton).toBeHidden();

  await page
    .getByRole('button', { name: 'Switch to source B', exact: true })
    .click();

  await expect(activationButton).toBeVisible();
  await expect(activationButton).toHaveAttribute('data-state', 'dormant');
  expect(requestsFor(providerRequests, sourceBUrl)).toHaveLength(0);
  await armClickTimestamp(activationButton, 'sourceBClick');

  await activationButton.click();

  await expect
    .poll(() => countRequests(providerRequests, sourceBUrl))
    .toBeGreaterThan(0);
  const sourceBClick = await readTimestamp(page, 'sourceBClick');
  const sourceBRequests = requestsFor(providerRequests, sourceBUrl);
  await expectRequestsAfter(page, sourceBRequests, sourceBClick, [sourceBUrl]);
});

test('interaction preload=none plays from the activation click', async ({
  page
}) => {
  let releaseMediaResponse = () => {};
  const playStarted = new Promise<void>((resolve) => {
    releaseMediaResponse = resolve;
  });
  const providerRequests = await routeProviderMedia(page, playStarted);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-preload-none-external-muted&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  const documentElement = page.locator('html');
  await expect(activationButton).toBeVisible();
  await expect(page.getByLabel('Playdeck media', { exact: true })).toHaveCount(
    0
  );
  await documentElement.evaluate((element) => {
    element.dataset.mediaPlayCount = '0';
    element.dataset.mediaPlayTime = '';
    document.addEventListener(
      'play',
      (event) => {
        if (!(event.target instanceof HTMLMediaElement)) return;
        element.dataset.mediaPlayCount = String(
          Number(element.dataset.mediaPlayCount) + 1
        );
        element.dataset.mediaPlayTime = String(
          performance.timeOrigin + performance.now()
        );
      },
      { capture: true }
    );
  });
  await armClickTimestamp(activationButton, 'preloadNoneClick');
  expect(providerRequests).toEqual([]);

  await activationButton.click();

  await expect.poll(() => providerRequests.length).toBeGreaterThan(0);
  const media = page.getByLabel('Playdeck media', { exact: true });
  await expect(media).toHaveAttribute('preload', 'none');
  await expect(media).toHaveJSProperty('muted', true);
  try {
    await expect(media).toHaveJSProperty('paused', false);
  } finally {
    releaseMediaResponse();
  }
  await expect(documentElement).toHaveAttribute(
    'data-media-play-count',
    /^[1-9]\d*$/
  );
  const clickTime = await readTimestamp(page, 'preloadNoneClick');
  const playTime = await readTimestamp(page, 'mediaPlayTime');
  await expectRequestsAfter(page, providerRequests, clickTime, [tracerUrl]);
  expect(playTime).toBeGreaterThanOrEqual(clickTime);
});

// #309: a `loading: 'viewport'` player pauses the playback it started when it
// scrolls out of view, resumes it on re-entry, and never touches playback a
// viewer started or stopped. `ViewportAutoplayScrollMuted`
// (`player-fixture.stories.tsx`) is `AutoplayMuted` wrapped in a tall scroll
// page -- a spacer above, the player, a spacer below -- so the player starts
// fully outside the observer's root at Playwright's default 1280x720 iframe.
const viewportScrollStory =
  '/iframe.html?id=fixtures-playerfixture--viewport-autoplay-scroll-muted&viewMode=story';

// See `mountedPlayButton` in `e2e/autoplay.spec.ts` for why this wait sits
// ahead of any assertion rather than inside one: it releases at the earliest
// moment the button can be observed, so as little of the player's own work as
// possible is charged to the assertion that follows.
const mountedPlayButton = async (page: Page): Promise<Locator> => {
  const play = playButton(page);
  await play.waitFor({ state: 'attached' });
  return play;
};

const scrollPlayerIntoView = (page: Page): Promise<void> =>
  page.getByTestId('viewport').scrollIntoViewIfNeeded();

// The player sits between two spacers tall enough to clear `loadMargin`'s
// default `'200px 0px'` root expansion (see `SCROLL_SPACER_HEIGHT` in
// `player-fixture.stories.tsx`), so scrolling all the way to the top of the
// document reliably takes it out of view again.
const scrollPlayerOutOfView = (page: Page): Promise<void> =>
  page.evaluate(() => window.scrollTo(0, 0));

// Samples the play button's `data-state` across a real interval instead of
// reading it once, so a pause or resume that lands a moment after the
// assertion starts -- which a single read racing the observer's callback
// could miss -- cannot pass unnoticed. The same technique
// `e2e/theme-idle.spec.ts` uses for a "stays as it was" assertion.
const assertPlaybackHolds = async (
  page: Page,
  state: 'playing' | 'paused'
): Promise<void> => {
  const play = playButton(page);
  for (let sample = 0; sample < 4; sample++) {
    await expect(play).toHaveAttribute('data-state', state);
    await page.waitForTimeout(250);
  }
};

// Demonstrated red (docs/agents/demonstrated-red.md). The two below assert a
// crossing #309's fix has to newly produce, so they were run against
// `packages/react/src/use-activation.ts` as it stood at 92f3e60~1 (before
// #309): both failed on chromium and firefox, `data-state` stuck at
// `"playing"` where the assertion asked for `"paused"` --
//
//   Error: expect(locator).toHaveAttribute(expected) failed
//   Expected: "paused"
//   Received: "playing"
//     13 × locator resolved to <button ... data-state="playing" ...>
//
// (identical on both engines, for both "pauses when it scrolls out of view"
// and "resumes when it scrolls back into view").
//
// The other two assert a value ("still playing", "still paused") that an
// unfixed tree also produces, by never touching playback at all -- exactly
// the trap the same doc names -- so the substitute mutation route applies:
// the ownership guards in `use-activation.ts`'s observer callback were each
// inverted (`=== 'autoplaying'` to `!== 'autoplaying'`, `=== 'auto-paused'`
// to `!== 'auto-paused'`), which makes the guard act on exactly the playback
// it must leave alone. Run against that mutation, both failed on chromium and
// firefox:
//
//   1) "the viewer takes over from autoplay keeps playing when it scrolls out
//      of view"
//      Expected: "playing"
//      Received: "paused"
//
//   2) "a viewer paused deliberately stays paused across a scroll out and
//      back in"
//      Expected: "paused"
//      Received: "playing"
//
// All four pass again with the mutation reverted and the real fix restored.
test('a viewport-autoplayed player pauses when it scrolls out of view', async ({
  page
}) => {
  await page.goto(viewportScrollStory);
  const play = await mountedPlayButton(page);

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');

  await scrollPlayerOutOfView(page);
  await expect(play).toHaveAttribute('data-state', 'paused');
});

test('a player auto-paused by leaving the viewport resumes when it scrolls back into view', async ({
  page
}) => {
  await page.goto(viewportScrollStory);
  const play = await mountedPlayButton(page);

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');
  await scrollPlayerOutOfView(page);
  await expect(play).toHaveAttribute('data-state', 'paused');

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');
});

test('a player the viewer takes over from autoplay keeps playing when it scrolls out of view', async ({
  page
}) => {
  await page.goto(viewportScrollStory);
  const play = await mountedPlayButton(page);

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');

  // The viewer takes over: a pause and a play the viewer pressed, both
  // carrying the `'user'` origin, leave `playbackOwnership` at `'none'` --
  // the state a viewer's own play or pause always reads (#309) -- so the
  // playback now running is unambiguously the viewer's, not the viewport's.
  await play.click();
  await expect(play).toHaveAttribute('data-state', 'paused');
  await play.click();
  await expect(play).toHaveAttribute('data-state', 'playing');

  await scrollPlayerOutOfView(page);
  await assertPlaybackHolds(page, 'playing');
});

test('a player a viewer paused deliberately stays paused across a scroll out and back in', async ({
  page
}) => {
  await page.goto(viewportScrollStory);
  const play = await mountedPlayButton(page);

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');

  await play.click();
  await expect(play).toHaveAttribute('data-state', 'paused');

  await scrollPlayerOutOfView(page);
  await assertPlaybackHolds(page, 'paused');

  await scrollPlayerIntoView(page);
  await assertPlaybackHolds(page, 'paused');
});
