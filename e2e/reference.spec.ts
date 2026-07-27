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

// Shared by both HLS-swap tests below. The example no longer forces an
// engine (`source: { type: 'hls', src: '/hls/master.m3u8' }`), so this swap
// lets each browser resolve HLS the way a consumer's would, via
// `HTMLVideoElement.canPlayType`. Measured directly (see the quality-ladder
// test below): both Chromium and WebKit report non-empty support for the HLS
// MIME type and resolve to the native engine; only Firefox reports none and
// resolves to hls.js.
const swapToHls = async (page: Page): Promise<void> => {
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
};

test('swapping MP4 to HLS keeps the controls live', async ({ page }) => {
  await swapToHls(page);

  // The controls survived the swap on the same Root.
  await muteButton(page).click();
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');
});

test('swapping MP4 to HLS populates the quality ladder', async ({
  browserName,
  page
}) => {
  // Only the hls.js engine populates `PlayerState.qualities` (see
  // provider-hls); native HLS leaves it empty by design, so the menu section
  // is legitimately absent there. The example no longer forces `engine:
  // 'hls.js'` (that put an hls.js flow on WebKit, see e2e/hls.spec.ts:28,46-49
  // for why this repo doesn't rely on that combination) — auto-detection asks
  // each browser's own `HTMLVideoElement.canPlayType`, and measured directly:
  // Chromium and WebKit both report non-empty support for the HLS MIME type,
  // so `selectHlsEngine` resolves them to 'native' the same as forced native
  // would; only Firefox reports no native support and resolves to hls.js.
  // Scoped to the one browser where that's actually true, rather than
  // Chromium as `hls.spec.ts:28`'s *forced*-engine comment might suggest.
  test.skip(
    browserName !== 'firefox',
    "Only the hls.js engine enumerates PlayerState.qualities; under auto-detection, Firefox is the only project whose canPlayType reports no native HLS support, so it's the only one that resolves to hls.js here."
  );

  await swapToHls(page);

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

test('the control row does not overflow at 320px, and hides the volume slider below the 420px breakpoint', async ({
  page
}) => {
  // #32's 1.4.10 reflow check has to pass by construction on the very artifact
  // it is pointed at, not be discovered later. This is also the defect
  // Theme/Theme still admits: at 480 its row overflowed by 49px once
  // AirPlayButton made it six buttons.
  //
  // The overflow assertions below hold at 320px regardless of the
  // `@media (max-width: 420px)` volume-slider rule, because
  // `.reely-example-row-buttons` sets `flex-wrap: wrap` — the row cannot
  // overflow horizontally either way. What actually exercises that
  // breakpoint is the volume-slider visibility check that follows: hidden at
  // 320px, visible again at 480px (comfortably above the breakpoint).
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

  const volumeSlider = page.locator('[data-reely-part="volume-slider"]');
  await expect(volumeSlider).toBeHidden();

  await page.setViewportSize({ width: 480, height: 640 });
  await expect(volumeSlider).toBeVisible();
});

test('the volume slider hides on the player width, not the viewport width', async ({
  page
}) => {
  // The breakpoint test above resizes the viewport, which narrows the player
  // too, so it cannot tell a viewport query from a container query. This can:
  // the viewport stays wide and only the player is narrow, which is what an
  // embedded player in a sidebar actually looks like. Against a
  // `@media (max-width: 420px)` rule the slider stays visible and this fails.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(story);
  // Constrain the CONTAINING element, not the player: that is what an embed in
  // a narrow column does, and the player's own `width: 100%` then resolves to
  // 320px. Styling `.reely-example` directly does not work anyway — the story
  // injects its stylesheet from the body, so a rule added here loses on
  // document order at equal specificity (measured: the player stayed 768px).
  await page.addStyleTag({ content: '#storybook-root { width: 320px; }' });
  await expect
    .poll(() =>
      page
        .locator('.reely-example')
        .evaluate((el) => el.getBoundingClientRect().width)
    )
    .toBeLessThanOrEqual(320);

  await activationButton(page).click();
  await played(page);

  await expect(page.locator('[data-reely-part="volume-slider"]')).toBeHidden();

  // And the viewport really was wide throughout — otherwise this would be the
  // same assertion as the test above, passing for the wrong reason.
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(width).toBeGreaterThan(420);
});

test('a narrow container keeps the 16:9 floor and puts the row in flow', async ({
  page
}) => {
  // #114. The container query used to fire alone here: the volume slider hid,
  // but the box stayed locked to `aspect-ratio: 16 / 9` and the row stayed an
  // absolutely-positioned overlay covering 153px of those 180 — measured, with
  // the media element itself only 150px tall underneath it. The 320px viewport
  // path has always stacked instead (measured 336 = 180 media + 153 row),
  // because `Player.Media` is in flow; this is that outcome, on the axis that
  // an embed in a narrow column actually varies.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(story);
  await page.addStyleTag({ content: '#storybook-root { width: 320px; }' });

  const player = page.locator('.reely-example');
  await expect
    .poll(() => player.evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThanOrEqual(320);

  await activationButton(page).click();
  await played(page);

  // The media and the row both take part in flow, so the box is the sum of
  // them rather than a 16:9 lid clamped over both: 320 x 9 / 16 = 180 was the
  // old ceiling and the row alone is 153 of it. Measured at 303 after the fix;
  // asserted as a relation, because the media element's own height depends on
  // the fixture's intrinsic ratio.
  const height = await player.evaluate((el) =>
    Math.round(el.getBoundingClientRect().height)
  );
  expect(height).toBeGreaterThan(180);

  const mediaHeight = await media(page).evaluate((el) =>
    Math.round(el.getBoundingClientRect().height)
  );
  const rowHeight = await controls(page).evaluate((el) =>
    Math.round(el.getBoundingClientRect().height)
  );
  // Stacked, not overlaid: neither one is hidden behind the other.
  expect(height).toBeGreaterThanOrEqual(mediaHeight + rowHeight);

  expect(
    await controls(page).evaluate((el) => getComputedStyle(el).position)
  ).toBe('relative');

  // And the viewport really was wide throughout, or this is the 320px viewport
  // test again, passing for the wrong reason.
  expect(
    await page.evaluate(() => document.documentElement.clientWidth)
  ).toBeGreaterThan(420);
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
