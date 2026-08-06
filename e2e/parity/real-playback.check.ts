import { expect, test, type Page } from '@playwright/test';
import { activationButton, media } from '../locators';
import { ROOT_SELECTOR, story } from './measure';
import { fetchStoryIndex } from './story-index';

/**
 * The one thing the measurement sweep cannot show. `measurements.check.ts`
 * reads geometry and structure, and it reads most of them off
 * `Backpack parity/Mock/*` — stories that stage `activation: 'ready'` and
 * never commit a source, so no provider ever attaches there and nothing ever
 * decodes a frame. A wrapper that mounted nothing at all would still measure
 * identically on those rows. This file closes that hole: one
 * `Backpack parity/Real/*` story, driven end to end against the provider's own
 * network, asserting that a real embed attached and that its playhead moved.
 *
 * The `!test` tag on those stories excludes them from `pnpm test:storybook`,
 * Storybook's own runner. It is not a Playwright concept and does not stop a
 * navigation, which is why the story is driven here by its id.
 *
 * This runs under `playwright.parity.config.ts` only (hence `.check.ts`, per
 * this directory's README), so it never joins `pnpm test:e2e` — the same
 * reason the repo's other real-provider tests carry `@real` and
 * `grepInvert` in `playwright.config.ts`. It needs Reely's Storybook and the
 * open internet; it does not need Backpack's server, but the parity config
 * spawns both.
 */

const REELY_ORIGIN = 'http://127.0.0.1:4173';

/**
 * Wistia, and not Vimeo or YouTube, for three reasons.
 *
 * First, and decisively: it is the only one of the three whose media element
 * lives in the page. `Player.Media` mounts `<wistia-player>` as a real custom
 * element under `[data-reely-part="media"]`
 * (`packages/react/src/viewport-media.tsx:215-228`), and that element carries a
 * live API handle (`element.api`, `packages/provider-wistia/src/loader.ts:93`)
 * whose `time()` is the engine's own playhead. Vimeo and YouTube mount
 * cross-origin iframes, and `BackpackVideo` publishes no `window.reelyHandle`
 * the way `PlayerFixture` does for `e2e/vimeo.spec.ts` — so on those two the
 * strongest available claim is a state word, where here it is a number that
 * only a decode can produce. "Playback progressed" has to be provable, not
 * asserted.
 *
 * Second, this story passes `light: false`, so nothing here fetches an oEmbed
 * thumbnail. That keeps this test clear of the condition Task 3 recorded —
 * noembed.com answering Vimeo URLs with HTTP 200 and `{"error":"403
 * Forbidden"}` — and of oEmbed availability generally.
 *
 * Third, reachability, measured rather than assumed: `fast.wistia.com` answers
 * this media's embed JSON with HTTP 200 from here, while `player.vimeo.com`
 * answers 401 to a request carrying no embed referer, and `youtube-real.spec.ts`
 * already records YouTube as the provider that cannot reach confirmed playback
 * wherever the network is constrained.
 */
const STORY_TITLE = 'Backpack parity/Real/Video';
const STORY_NAME = 'Wistia';

/** The media `backpack-video-real.stories.tsx` points that story at. Asserted
 * on the attached element, so a story edited to a different clip fails here
 * rather than silently proving playback of something else. */
const MEDIA_ID = 'oifkgmxnkb';

/** Wistia's engine is fetched from `fast.wistia.com` at click time and the
 * media is only then decoded, so every wait here is generous — the parity
 * config's own 30s test timeout is nowhere near enough for a cold run. */
const TEST_TIMEOUT_MS = 180_000;
const ATTACH_TIMEOUT_MS = 90_000;
const PLAYBACK_TIMEOUT_MS = 90_000;
/** Past this many seconds, no amount of buffering or metadata probing explains
 * the reading: frames were decoded and presented. `e2e/wistia-smoke.spec.ts`
 * draws the same line at the same value. */
const PLAYHEAD_THRESHOLD_S = 3;

interface EngineReading {
  /** Seconds, as the engine reports them; `null` when it has none yet. */
  time: number | null;
  duration: number | null;
}

/**
 * What the live Wistia engine says about itself, or `null` while no handle is
 * available yet. Read through the element's own API rather than off a
 * `<video>` in its shadow root: the handle is the surface Wistia documents and
 * the one `packages/provider-wistia` itself reads (`playback.ts`'s
 * `player.time()` and `player.duration()`), so this measures the same thing
 * the adapter does.
 */
const engineReading = (page: Page): Promise<EngineReading | null> =>
  page.evaluate((selector) => {
    type Handle = { time?: () => number; duration?: () => number };
    const element = document.querySelector(selector) as
      | (Element & {
          api?: Handle | 'removed' | null;
          wistiaApi?: Handle | 'removed' | null;
          deprecatedApiDoNotUse?: Handle | 'removed' | null;
        })
      | null;
    if (element === null) return null;
    const handle =
      element.api ?? element.wistiaApi ?? element.deprecatedApiDoNotUse;
    if (!handle || handle === 'removed' || typeof handle.time !== 'function') {
      return null;
    }
    const time = handle.time();
    const duration = handle.duration?.();
    return {
      time: Number.isFinite(time) ? time : null,
      duration:
        typeof duration === 'number' && Number.isFinite(duration)
          ? duration
          : null
    };
  }, `${ROOT_SELECTOR} wistia-player`);

test('the wrapper attaches a real provider from one click and its playhead advances', async ({
  page
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);

  const index = await fetchStoryIndex(REELY_ORIGIN);
  const entry = index.find(
    (candidate) =>
      candidate.title === STORY_TITLE && candidate.name === STORY_NAME
  );
  // Resolved from `/index.json` rather than hand-written, for the reason the
  // plan gives for the matrix: a renamed or deleted story must fail loudly
  // here instead of turning into a blank page a weaker assertion could still
  // pass against.
  expect(
    entry,
    `No story titled "${STORY_TITLE}" named "${STORY_NAME}" in Reely's index.json`
  ).toBeDefined();

  await page.goto(`${REELY_ORIGIN}${story(entry?.id ?? '')}`);
  const root = page.locator(ROOT_SELECTOR);
  await expect(root).toBeVisible();

  // Before the click there is no provider and no media element at all:
  // `Player.Media` returns `null` until a source is committed
  // (`viewport-media.tsx:184`). Asserted so the attachment below is a change
  // this test caused, not a state the story was already staged into — which is
  // exactly the difference between this file and the Mock suite.
  await expect(media(page)).toHaveCount(0);
  await expect(root).toHaveAttribute('data-playing', 'false');

  await activationButton(page).click();

  // A provider attached, and it is the real Wistia element for this media —
  // not a mock, and not some other clip.
  const player = page.locator(`${ROOT_SELECTOR} wistia-player`);
  await expect(player).toHaveAttribute('media-id', MEDIA_ID, {
    timeout: ATTACH_TIMEOUT_MS
  });
  await expect(player).toBeInViewport();

  // Playback progressed. The playhead, not a state word: `playing` can be
  // published by a provider that never decoded a frame, where a playhead past
  // a threshold cannot — the argument `e2e/wistia-smoke.spec.ts` makes for the
  // same assertion, and the reason this test picks the one provider whose
  // playhead is readable from the page at all.
  await expect
    .poll(async () => (await engineReading(page))?.time ?? 0, {
      timeout: PLAYBACK_TIMEOUT_MS
    })
    .toBeGreaterThan(PLAYHEAD_THRESHOLD_S);

  // And the media answered for its own shape, which only a decode can. Logged
  // as well as asserted, in the sweep's own style: a run of this file should
  // leave the numbers it saw on record, not only the fact that it passed.
  const reading = await engineReading(page);
  console.log(
    `    wistia engine: time=${reading?.time}s duration=${reading?.duration}s`
  );
  expect(reading?.duration ?? 0).toBeGreaterThan(60);

  // And the wrapper knows. `data-playing` is Backpack's own root attribute
  // (`Video/VideoPlayer.tsx`), which this wrapper reproduces from the player's
  // *confirmation* rather than from the click — `backpack-video.tsx`'s
  // `playerReported` folds `state.playback === 'playing'` back into the
  // component's own state, and `Player.ActivationButton` has no optimistic
  // `onClick` of its own (SIDEPRO-212). So `true` here can only have come from
  // the attached provider, and the label the surface offers moved with it.
  await expect(root).toHaveAttribute('data-playing', 'true');
  await expect(page.locator('.ef-video-controller')).toHaveAttribute(
    'aria-label',
    'Pause video'
  );

  // A masked baseline of the story canvas with a real provider playing in it.
  // The video region has to be masked — it is a live decode, and no two runs
  // share a frame — and `Player.Media` fills the whole player box, so what is
  // left after masking is not the inside of the frame but where the frame is:
  // the player's position, size and aspect ratio within the layout, plus
  // anything the story draws around it. That is why this captures the page
  // rather than the player element, which would reduce to a bare mask
  // rectangle and pin only two numbers.
  //
  // Narrow on purpose. The plan rules out pixel comparison against Backpack
  // (the two stacks style differently, so every pixel would differ and say
  // nothing), so this is a baseline of Reely against itself: it catches the
  // player box moving or resizing when a real embed attaches, and claims
  // nothing about what the embed looks like. Lands in
  // `e2e/parity/__screenshots__/` via the parity config's
  // `snapshotPathTemplate`, alongside the repo's other baselines.
  await expect(page).toHaveScreenshot(
    'backpack-video-real-wistia-playing.png',
    { mask: [media(page)] }
  );
});
