import { expect, test, type Page } from '@playwright/test';
import { playButton, qualityTrigger } from './locators';

// Waits for the engine readout to attach before reading its text, the same
// reason `e2e/hls.spec.ts`'s `mountedHlsEngine` does: a locator wait draws on
// the test's wide timeout, absorbing the story's cold compile and mount, so
// the assertion after it keeps its own 5s default.
const mountedHlsEngine = async (page: Page) => {
  const engine = page.getByTestId('hls-engine');
  await engine.waitFor({ state: 'attached' });
  return engine;
};

test('lists the full quality ladder, driven end-to-end on hls.js', async ({
  browserName,
  page
}) => {
  // Forced `engine: 'hls.js'` flows in this repo run on Chromium only --
  // `e2e/hls.spec.ts`'s own forced-hls.js test carries the same restriction.
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--hls-hls-js&viewMode=story'
  );

  const engine = await mountedHlsEngine(page);
  await expect(engine).toHaveText('hls.js');

  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  // The fixture manifest (apps/storybook/public/hls/master.m3u8) carries two
  // variants -- 320x180 and 160x90 -- the same ladder
  // `e2e/reference.spec.ts`'s "swapping MP4 to HLS populates the quality
  // ladder" reads off the same file. The auto row's own parenthesised height
  // reflects whichever rung hls.js had resolved to when the menu opened, so
  // only the two fixed rung labels are asserted by name.
  await qualityTrigger(page).click();
  const menu = page.getByRole('group');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
  await expect(
    menu.getByRole('menuitemradio', { name: '180p', exact: true })
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitemradio', { name: '90p', exact: true })
  ).toBeVisible();

  await menu.getByRole('menuitemradio', { name: '90p', exact: true }).click();

  await qualityTrigger(page).click();
  await expect(
    page
      .getByRole('group')
      .getByRole('menuitemradio', { name: '90p', exact: true })
  ).toHaveAttribute('aria-checked', 'true');
});

test('renders nothing on a native MP4 source', async ({ page }) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );

  await playButton(page).waitFor({ state: 'attached' });
  await expect(playButton(page)).toHaveAttribute('data-provider');

  await expect(qualityTrigger(page)).toHaveCount(0);
});
