import { expect, test, type Page } from '@playwright/test';
import { media } from './locators';
import { countProviderLoads } from './initial-position';

// #914: the `EagerAutoplayHiddenByCss` story
// (`apps/storybook/stories/player-fixture.stories.tsx`) -- an `eager`,
// muted-autoplay native tracer wrapped in a `display: none` box with a
// `Reveal` button that removes it.
const STORY =
  '/iframe.html?id=fixtures-playerfixture--eager-autoplay-hidden-by-css&viewMode=story';

type PlayCounts = { playdeckPlayCalls?: number };

// Installed before `page.goto`, the same discipline `countProviderLoads`
// (`initial-position.ts`) uses: the hold either runs or doesn't during the
// navigation itself, so a listener added afterwards could miss the one call
// this spec exists to rule out.
const countPlayCalls = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const counts = window as unknown as PlayCounts;
    counts.playdeckPlayCalls = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      counts.playdeckPlayCalls = (counts.playdeckPlayCalls ?? 0) + 1;
      return play.call(this);
    };
  });
};

const playCalls = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as PlayCounts).playdeckPlayCalls ?? 0);

const providerLoads = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (window as unknown as { playdeckProviderLoads?: number })
        .playdeckProviderLoads ?? 0
  );

// #914: a `video` file source commits at render time under `eager`
// (#911/#917), so the server HTML already carries the `<video>` and its
// `<source>` children, and the native element's own preload request already
// left with the HTML parser -- hidden or not. What this spec defends is
// everything downstream of that: Playdeck's own controller never attaches a
// provider or attempts `play()` while the viewport has no layout box, and
// once it does, the player continues exactly as an `eager` player that was
// visible from the start -- including never restarting that server-started
// fetch with `media.load()` (#911's own fix, which the hold must not
// bypass).
test('an eager autoplay player hidden by CSS holds until it has layout', async ({
  page
}) => {
  await countProviderLoads(page);
  await countPlayCalls(page);
  await page.goto(STORY);

  const reveal = page.getByTestId('css-hidden-reveal');
  await expect(reveal).toBeAttached();

  // Sampled repeatedly over a short window rather than once -- the same
  // "stays as it was" discipline `activation.spec.ts`'s own
  // `assertPlaybackHolds` uses. A single read only proves nothing had
  // happened by the moment it was taken, not that nothing happens.
  for (let sample = 0; sample < 4; sample += 1) {
    expect(
      await media(page).evaluate((element: HTMLVideoElement) => element.paused)
    ).toBe(true);
    expect(
      await page.evaluate(() => window.playdeckHandle?.getState().activation)
    ).toBe('dormant');
    expect(await playCalls(page)).toBe(0);
    expect(await providerLoads(page)).toBe(0);
    await page.waitForTimeout(250);
  }

  await reveal.click();

  await expect
    .poll(() => playCalls(page), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // `play()` being called and `paused` actually reading `false` are two
  // different moments on Firefox -- the call is counted synchronously, but
  // the attribute only flips once the engine confirms, which can land a
  // tick later. Polled rather than read once, for that reason.
  await expect
    .poll(
      () => media(page).evaluate((element: HTMLVideoElement) => element.paused),
      { timeout: 15_000 }
    )
    .toBe(false);
  // The hold must never call `media.load()` on an element the server already
  // committed, before or after being revealed (#911).
  expect(await providerLoads(page)).toBe(0);
});

// The other acceptance criterion: a visible `eager` player is unaffected --
// no `Reveal` button, no held activation, autoplay runs the moment the
// provider is ready.
test('a visible eager autoplay player is unaffected', async ({ page }) => {
  await countProviderLoads(page);
  await countPlayCalls(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--eager-autoplay-muted&viewMode=story'
  );

  await expect
    .poll(() => playCalls(page), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // See the companion test above for why this is polled rather than read
  // once: Firefox counts the `play()` call before `paused` flips to `false`.
  await expect
    .poll(
      () => media(page).evaluate((element: HTMLVideoElement) => element.paused),
      { timeout: 15_000 }
    )
    .toBe(false);
  expect(await providerLoads(page)).toBe(0);
});
