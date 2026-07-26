import { expect, test, type Page } from '@playwright/test';
import {
  activationButton,
  airPlayButton,
  captionsButton,
  controls,
  media,
  muteButton,
  pipButton,
  playButton,
  seekSliderInput,
  settingsMenu,
  settingsTrigger
} from './locators';

// #67's composed example, driven the way a consumer would. The MP4 and HLS legs
// block; YouTube and Vimeo are @real and grep-inverted out of CI, because the
// ledger has already characterised those two (plus hls) as where CPU-saturation
// failures land.
const story = '/iframe.html?id=reference-player--real-sources&viewMode=story';

// Both local fixtures are ~1 SECOND long (measured while driving the story by
// hand in Task 4). So `data-state="playing"` is a state the clip leaves on its
// own within ~2s, and asserting it is a race. `currentTime > 0` is the
// race-free way to say "it actually played" — it stays true once ended.
const played = (page: Page) =>
  expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0);

test('the composed example plays, seeks, mutes and toggles captions on MP4', async ({
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // Seek through the public control, then read the media element: the command
  // has to reach the video, not just move the input. `SeekSlider`'s step is 1
  // and its max is the duration, so on a 1s fixture 0 and 1 are the only
  // reachable targets — and seeking to the end is the deterministic assertion,
  // because arriving there ends the clip rather than racing playback.
  //
  // Measured: WebKit's currentTime after ending is never exactly 1 — it
  // settles a fraction past it (observed 1.000122584-1.000185166 across
  // repeated runs), while Chromium and Firefox report exactly 1. `>= 1` is
  // what's actually true on every engine; `data-state === 'ended'` below is
  // the assertion that actually pins down "reached the end".
  await seekSliderInput(page).fill('1');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThanOrEqual(1);
  await expect(playButton(page)).toHaveAttribute('data-state', 'ended');

  await muteButton(page).click();
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');
  await expect(
    media(page).evaluate((el: HTMLVideoElement) => el.muted)
  ).resolves.toBe(true);

  // The <track> the example declares through Media's children — the API #15
  // shipped without. Its default flag selects it on load.
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'on');
  await captionsButton(page).click();
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'off');
});

test('the settings menu changes the playback rate on the media element', async ({
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  await settingsTrigger(page).click();
  await expect(settingsMenu(page)).toHaveAttribute('data-reely-menu', 'open');
  // exact: true — Playwright name matching is a substring match, and "1.5x"
  // is a substring of nothing here only by luck.
  await page.getByRole('menuitemradio', { name: '1.5×', exact: true }).click();

  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.playbackRate))
    .toBe(1.5);
});

test('swapping MP4 to HLS keeps the controls live and populates the quality ladder', async ({
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  await page.getByTestId('reference-source-hls').click();
  // A source change resets activation to dormant rather than remounting Root,
  // so the overlay returns and the new source needs one more click. Confirmed
  // by hand in Task 4: the overlay genuinely reappears.
  await expect(activationButton(page)).toBeVisible();
  await activationButton(page).click();
  await played(page);

  // The controls survived the swap on the same Root.
  await muteButton(page).click();
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');

  // #81's ladder, from the fixture manifest's two variants (320x180, 160x90).
  // Observed labels under HLS in Task 4: 'Auto (180p)', '90p', '180p'. Assert
  // the two fixed rung labels only — the auto row's parenthesised height
  // reflects whichever rung hls.js had resolved when the menu opened.
  await settingsTrigger(page).click();
  const quality = page.getByRole('group', { name: 'Quality', exact: true });
  await expect(quality).toBeVisible();
  await expect(
    quality.locator('[data-reely-part="menu-radio-item"]')
  ).toHaveCount(3);
  await quality
    .getByRole('menuitemradio', { name: '90p', exact: true })
    .click();

  await settingsTrigger(page).click();
  await expect(
    page
      .getByRole('group', { name: 'Quality', exact: true })
      .getByRole('menuitemradio', { name: '90p', exact: true })
  ).toHaveAttribute('aria-checked', 'true');
});

test('the control row does not overflow at 320px', async ({ page }) => {
  // #32's 1.4.10 reflow check has to pass by construction on the very artifact
  // it is pointed at, not be discovered later. This is also the defect
  // Theme/Theme still admits: at 480 its row overflowed by 49px once
  // AirPlayButton made it six buttons.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  const row = controls(page);
  await expect(row).toBeVisible();
  const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const page320 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(page320.scrollWidth).toBeLessThanOrEqual(page320.clientWidth);
});

// AirPlay is hardcoded unavailable on both iframe providers — a static
// `{ status: 'unavailable', reason: 'provider' }` (Vimeo) / `providerUnavailable`
// constant (YouTube) that is never reassigned in either adapter — so asserting
// it hidden immediately after activation is safe on both, no settle time needed.
for (const provider of ['youtube', 'vimeo'] as const) {
  test(`@real capability gating hides AirPlay on ${provider}`, async ({
    page
  }) => {
    await page.goto(story);
    await page.getByTestId(`reference-source-${provider}`).click();
    await activationButton(page).click();

    await expect(playButton(page)).toHaveAttribute('data-provider', provider);
    await expect(airPlayButton(page)).toHaveCount(0);
  });
}

// PiP is NOT symmetric the way AirPlay is. YouTube hardcodes it unavailable
// (`pictureInPicture: providerUnavailable` in provider-youtube/src/index.ts,
// never reassigned), so — like AirPlay above — it is safe to assert hidden
// immediately.
test('@real capability gating hides PiP on youtube', async ({ page }) => {
  await page.goto(story);
  await page.getByTestId('reference-source-youtube').click();
  await activationButton(page).click();

  await expect(playButton(page)).toHaveAttribute('data-provider', 'youtube');
  await expect(pipButton(page)).toHaveCount(0);
});

// Vimeo's adapter defaults `pictureInPicture` to `available` and only
// downgrades it after a *failed* `requestPictureInPicture` call
// (provider-vimeo/src/index.ts) — Vimeo's SDK genuinely exposes native PiP, so
// the button renders rather than disappearing. Measured across repeated runs:
// it appears ~300-900ms after the `data-provider` match, once the SDK attaches,
// and stays. Asserting it hidden (as AirPlay is) would only pass by the race of
// the assertion running before that attach completes — confirmed flaky by
// sampling the DOM on a tight poll, so this asserts the settled, correct state
// instead, with the same generous timeout the other @real specs use for
// provider round-trips.
test('@real capability gating leaves PiP available on vimeo', async ({
  page
}) => {
  await page.goto(story);
  await page.getByTestId('reference-source-vimeo').click();
  await activationButton(page).click();

  await expect(playButton(page)).toHaveAttribute('data-provider', 'vimeo');
  await expect(pipButton(page)).toBeVisible({ timeout: 30_000 });
});
