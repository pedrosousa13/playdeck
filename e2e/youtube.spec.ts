import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';
import { routeYouTube } from './fixtures/youtube-fake';

test('youtube interaction activation rejects every YouTube request before the click', async ({
  page
}) => {
  const youtubeRequests = await routeYouTube(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-youtube&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  await expect(page.getByTestId('viewport')).toBeVisible();
  expect(youtubeRequests).toEqual([]);

  await activationButton.click();

  await expect
    .poll(
      () => youtubeRequests.filter((url) => url.endsWith('/iframe_api')).length
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => youtubeRequests.filter((url) => url.includes('/embed/')))
    .toContainEqual(expect.stringContaining('youtube-nocookie.com'));
});

test('youtube one interaction click loads the provider and queues playback', async ({
  page
}) => {
  const youtubeRequests = await routeYouTube(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-youtube&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  expect(youtubeRequests).toEqual([]);

  await activationButton.click();

  const play = playButton(page);
  await expect(play).toBeVisible();
  await expect(play).toHaveAttribute('data-state', 'playing');
  await expect(activationButton).toBeHidden();
  const iframe = page.locator('[data-playdeck-part="media"] iframe');
  await expect(iframe).toHaveAttribute(
    'src',
    /^https:\/\/www\.youtube-nocookie\.com\/embed\//
  );
  await expect(iframe).toHaveAttribute(
    'referrerpolicy',
    'strict-origin-when-cross-origin'
  );
  const overlayParts = await page
    .getByTestId('viewport')
    .locator(
      '[data-playdeck-part="activation"], [data-playdeck-part="controls"]'
    )
    .count();
  expect(overlayParts).toBe(0);
});

// Records every `selectedTextTrackId` the player's own state ever carries, by
// subscribing directly to `playdeckHandle` rather than polling it: a poll
// between two Playwright round trips can miss a value already corrected by
// the time the next poll lands, which is exactly the flash #858 asks be
// falsifiable. `subscribe` misses nothing -- it runs against every `emit()`
// this session makes, from the first. Installed by `addInitScript` (before
// any page script, let alone the story's own mount) and polls for
// `playdeckHandle` itself rather than waiting on a Playwright signal to
// attach it, so the subscription is in place before the fake's own captions
// module has a chance to report anything.
const recordTextTrackSelections = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const selections: Array<string | null> = [];
    (
      window as unknown as { __textTrackSelections: Array<string | null> }
    ).__textTrackSelections = selections;
    const attach = (): void => {
      const handle = (window as unknown as { playdeckHandle?: unknown })
        .playdeckHandle as
        | {
            subscribe: (
              l: (s: { selectedTextTrackId: string | null }) => void
            ) => void;
          }
        | undefined;
      if (!handle) {
        setTimeout(attach, 1);
        return;
      }
      handle.subscribe((state) => {
        selections.push(state.selectedTextTrackId);
      });
    };
    attach();
  });
};

const textTrackSelections = (page: Page): Promise<Array<string | null>> =>
  page.evaluate(
    () =>
      (window as unknown as { __textTrackSelections?: Array<string | null> })
        .__textTrackSelections ?? []
  );

// #858: the observed bug this fixture exists to falsify -- YouTube auto-
// selecting a caption track with no command from the adapter -- reproduces
// under `fakeIframeApi`'s own captions-module simulation whenever
// `cc_load_policy=0` is absent from the embed url.
//
// Red, chromium, with root.tsx's `youtube` bag fold changed to
// `defaultTextTrack: undefined` unconditionally (never 'off'): this test
// failed -- `expect(received).not.toContain(expected) // indexOf`,
// `Expected value: not "youtube:en"`, `Received array: [null, null, null,
// null, null, null, null, "youtube:en", null, null, null]` -- the eighth
// sampled selection is the fake's own captions-module auto-select this
// fixture exists to falsify. The contrast test below passed unfixed either
// way: it asserts the unset-prop default keeps that same auto-select
// standing, which a reverted fold does not disturb. Restoring the fold made
// both pass.
test('defaultTextTrack="off" never selects a caption track on YouTube, not even transiently', async ({
  page
}) => {
  await routeYouTube(page);
  await recordTextTrackSelections(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-youtube-captions-off&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();

  await activationButton.click();

  // Discovery settling is the signal that the fake's captions module has run
  // and reported -- the one moment a flash, if the fix regressed, would
  // already be in `selections`.
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().textTracks.length)
    )
    .toBe(2);

  expect(await textTrackSelections(page)).not.toContain('youtube:en');
  expect(
    await page.evaluate(
      () => window.playdeckHandle?.getState().selectedTextTrackId
    )
  ).toBeNull();
});

// Contrast case: with `defaultTextTrack` left at its `'auto'` default (no
// prop set), YouTube's own default selection stands -- proving the fake's
// bug-path simulation above is real, and that the passing test above is not
// vacuously true.
test("an unset defaultTextTrack leaves YouTube's own default caption selection standing", async ({
  page
}) => {
  await routeYouTube(page);
  await recordTextTrackSelections(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-youtube&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();

  await activationButton.click();

  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().textTracks.length)
    )
    .toBe(2);

  expect(await textTrackSelections(page)).toContain('youtube:en');
});

test('youtube docs example stays dormant while the native fixture is used', async ({
  page
}) => {
  const youtubeRequests = await routeYouTube(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Watch YouTube example',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  await expect(page.getByLabel('Playdeck media', { exact: true })).toHaveCount(
    1
  );
  expect(youtubeRequests).toEqual([]);

  await activationButton.click();

  await expect
    .poll(
      () => youtubeRequests.filter((url) => url.endsWith('/iframe_api')).length
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByTestId('youtube-example').locator('iframe')
  ).toBeVisible();
});

// #854: `ViewportAutoplayScrollLoopMutedYoutube`
// (`player-fixture.stories.tsx`) is `ViewportAutoplayScrollLoopMuted` sourced
// from YouTube instead of the native tracer, with a non-zero `startTime`
// alongside `loop: true` -- a tall scroll page around a `loading: 'viewport'`
// player, so it starts fully outside the observer's root at Playwright's
// default 1280x720 iframe and can be scrolled out of and back into view. The
// `startTime` is what makes `restartsAtStart(loop)` true (`boundary.ts`), so
// each wrap runs through the adapter's own `restartFromBoundary` rather than
// through YouTube's own playlist auto-restart -- the shape this fix targets,
// and the one `fakeIframeApi` above is built to drive.
const viewportScrollLoopYoutubeStory =
  '/iframe.html?id=fixtures-playerfixture--viewport-autoplay-scroll-loop-muted-youtube&viewMode=story';

const mountedPlayButton = async (page: Page) => {
  const play = playButton(page);
  await play.waitFor({ state: 'attached' });
  return play;
};

const scrollPlayerIntoView = (page: Page): Promise<void> =>
  page.getByTestId('viewport').scrollIntoViewIfNeeded();

const scrollPlayerOutOfView = (page: Page): Promise<void> =>
  page.evaluate(() => window.scrollTo(0, 0));

// Polls the fake player's own `getCurrentTime()` (exposed through
// `window.playdeckHandle`'s `currentTime`) for a drop -- the playhead going
// backward is what a loop restart looks like from outside, real playback
// advancing forward the rest of the time -- the same instrument
// `e2e/activation.spec.ts`'s native loop test reads (#673).
// A fixed, fast interval rather than `expect.poll`'s default growing one
// (100ms up to 1000ms): the fake's own wrap cycle is itself close to 1000ms
// (`getDuration()`'s 1 second, in `fakeIframeApi` above), and a poll that
// grows to sample once a second risks aliasing onto nearly the same phase of
// every cycle and never observing the drop at all.
const waitForLoopWrap = async (page: Page): Promise<void> => {
  let previous = await page.evaluate(
    () => window.playdeckHandle?.getState().currentTime ?? 0
  );
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(
          () => window.playdeckHandle?.getState().currentTime ?? 0
        );
        const wrapped = current < previous;
        previous = current;
        return wrapped;
      },
      { timeout: 8_000, intervals: [50] }
    )
    .toBe(true);
};

// The bug's own shape: `restartFromBoundary` (`boundary.ts`) used to leave
// the resulting `playVideo()` confirmation labelled `'provider'`, and #309's
// ownership rule read it as a viewer taking over -- correct on the first
// exit, and never auto-pausing again after the player had looped even once
// (the same shape #673 fixed for the native provider). This crosses the
// viewport boundary twice (`scrollPlayerOutOfView` at each half), with a loop
// wrap awaited in between both, so a fix that only survived the first wrap
// would still fail the second.
test('a looping viewport-autoplayed YouTube player auto-pauses on every exit, even after it has wrapped', async ({
  page
}) => {
  await routeYouTube(page);
  await page.goto(viewportScrollLoopYoutubeStory);
  const play = await mountedPlayButton(page);

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');
  await waitForLoopWrap(page);

  await scrollPlayerOutOfView(page);
  await expect(play).toHaveAttribute('data-state', 'paused');

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');
  await waitForLoopWrap(page);

  await scrollPlayerOutOfView(page);
  await expect(play).toHaveAttribute('data-state', 'paused');
});

// #854: the reporter's own configuration (`ViewportAutoplayScrollLoopMutedYoutubeNoBoundary`
// in `player-fixture.stories.tsx`) -- plain `loop`, no `startTime` and no
// `endTime` -- where YouTube's own playlist loop restarts the embed with no
// command from the adapter, and still fires a real `ended` on every
// iteration (#214's declared divergence from native, `time-boundary.ts`'s
// `restartsAtStart`). That `ended` used to drop viewport ownership to
// `'none'` unconditionally (`use-activation.ts`'s `ended` listener), so a
// player that wrapped even once stopped auto-pausing on exit regardless of
// the wrap's own `play` event's origin. Crosses the wrap twice, the same way
// the boundary-shape test above does.
const viewportScrollLoopYoutubeNoBoundaryStory =
  '/iframe.html?id=fixtures-playerfixture--viewport-autoplay-scroll-loop-muted-youtube-no-boundary&viewMode=story';

test('a plain looping viewport-autoplayed YouTube player with no boundary auto-pauses on every exit', async ({
  page
}) => {
  await routeYouTube(page);
  await page.goto(viewportScrollLoopYoutubeNoBoundaryStory);
  const play = await mountedPlayButton(page);

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');
  await waitForLoopWrap(page);

  await scrollPlayerOutOfView(page);
  await expect(play).toHaveAttribute('data-state', 'paused');

  await scrollPlayerIntoView(page);
  await expect(play).toHaveAttribute('data-state', 'playing');
  await waitForLoopWrap(page);

  await scrollPlayerOutOfView(page);
  await expect(play).toHaveAttribute('data-state', 'paused');
});
