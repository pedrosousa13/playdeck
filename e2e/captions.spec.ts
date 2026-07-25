import { expect, test } from '@playwright/test';
import { playButton } from './locators';

test('custom captions render the discovered track once playing', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-custom&viewMode=story'
  );

  await playButton(page).click();

  const captionsButton = page.locator('[data-reely-part="captions-button"]');
  await expect(captionsButton).toHaveAttribute('data-state', 'on');

  const captions = page.locator('[data-reely-part="captions"]');
  await expect(captions).toContainText('Reely caption one');
});

test('the captions button toggles the overlay off and back on', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-custom&viewMode=story'
  );

  await playButton(page).click();

  const captionsButton = page.locator('[data-reely-part="captions-button"]');
  const captions = page.locator('[data-reely-part="captions"]');
  await expect(captions).toContainText('Reely caption one');

  await captionsButton.click();
  await expect(captionsButton).toHaveAttribute('data-state', 'off');
  await expect(captions.locator('[data-reely-part="caption-cue"]')).toHaveCount(
    0
  );

  await captionsButton.click();
  await expect(captionsButton).toHaveAttribute('data-state', 'on');
  await expect(captions).toContainText('Reely caption one');
});

test('native caption rendering leaves the custom overlay empty', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-native&viewMode=story'
  );

  await playButton(page).click();

  const captionsButton = page.locator('[data-reely-part="captions-button"]');
  await expect(captionsButton).toHaveAttribute('data-state', 'on');

  await expect(page.locator('[data-reely-part="captions"]')).toHaveCount(0);
});

// #59: the SafeArea story cannot observe this — env() resolves to its fallback
// unless the engine reports a real inset. Chromium's CDP can set one, so the
// behaviour IS reachable off-device, and the assertion the story could only
// state structurally ("the padding mentions the inset") is made observable
// here: a 34px bottom inset must move the cue box up by exactly 34px.
test('a device safe-area inset lifts the cue box clear of the chrome', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName !== 'chromium',
    'Safe-area inset overrides are a Chromium CDP command; WebKit and iOS, where these insets are actually non-zero in production, run in the manual device matrix.'
  );
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-custom&viewMode=story'
  );
  await playButton(page).click();
  const captions = page.locator('[data-reely-part="captions"]');
  const cue = page.locator('[data-reely-part="caption-cue"]').first();
  await expect(cue).toHaveText(/Reely caption one/);
  const before = (await cue.boundingBox())!;

  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { bottom: 34, left: 21 }
  });

  await expect
    .poll(async () => Math.round((await cue.boundingBox())!.y))
    .toBe(Math.round(before.y) - 34);

  // The left inset is asserted on the padding rather than on the cue's x: the
  // cue box is centred, so a 21px left inset moves it by half that, which
  // would be asserting the centring rather than the inset. Measured: x goes
  // 333 -> 343.
  await expect
    .poll(() =>
      captions.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        return { left: style.paddingLeft, right: style.paddingRight };
      })
    )
    .toEqual({ left: '21px', right: '0px' });

  // Page-scoped: leaving it set would leak into anything else on this page.
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
  await session.detach();
});
