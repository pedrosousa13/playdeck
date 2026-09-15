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

// Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
// additive code has no natural unfixed state, so the part's render was
// gutted -- an unconditional `return null` right after the status gate in
// quality.tsx -- and this test run against it (chromium):
//
//   Error: locator.focus: Test timeout of 30000ms exceeded.
//   Call log:
//     - waiting for locator('[data-playdeck-part="settings-menu-trigger"][aria-label="Quality"]')
//     > await qualityTrigger(page).focus();
//
//   1 failed
//     [chromium] › e2e/quality.spec.ts:58:1 › opens and selects a rung by keyboard, focus returning to the trigger
//
// Reverted, and it passed again (5.8s).
test('opens and selects a rung by keyboard, focus returning to the trigger', async ({
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

  // Driven entirely by keyboard, the same shape `e2e/a11y.spec.ts` drives
  // SettingsMenu and CaptionsMenu in: focus the trigger, ArrowDown opens the
  // menu and lands focus on its first item (roving focus and the open
  // transition are SettingsMenu's own, exercised here through QualityMenu's
  // composition of it), End moves focus to the last item -- a real rung,
  // since the Auto row renders first -- and Enter fires the native click a
  // focused `<button>` answers to, the same activation MenuRadioItem's own
  // `onClick` handles for a mouse.
  await qualityTrigger(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio')).toHaveCount(3);
  await page.keyboard.press('End');
  const selectedLabel = (await page.locator(':focus').textContent())?.trim();
  await page.keyboard.press('Enter');

  // Selecting closes the menu and returns focus to the trigger, the same
  // shape `e2e/a11y.spec.ts`'s own Escape assertion takes for SettingsMenu.
  await expect(qualityTrigger(page)).toBeFocused();

  await qualityTrigger(page).click();
  await expect(
    page.getByRole('menuitemradio', { name: selectedLabel, exact: true })
  ).toHaveAttribute('aria-checked', 'true');
});

// Demonstrated red, substitute mutation (per /review: the natural red
// baseline -- no <Player.QualityMenu/> composed at all -- passes
// vacuously, since "renders nothing" is also what an unbuilt feature does;
// this only discriminates under a mutation that removes the capability
// gate). Deleted `if (status !== 'available') return null;` from
// quality.tsx, so the trigger renders regardless of capability, and ran
// this test on chromium and firefox:
//
//   Error: expect(locator).toHaveCount(expected) failed
//   Locator:  locator('[data-playdeck-part="settings-menu-trigger"][aria-label="Quality"]')
//   Expected: 0
//   Received: 1
//
//   2 failed
//     [chromium] › e2e/quality.spec.ts:101:1 › renders nothing on a native MP4 source
//     [firefox] › e2e/quality.spec.ts:101:1 › renders nothing on a native MP4 source
//
// Reverted, and both projects passed again.
test('renders nothing on a native MP4 source', async ({ page }) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );

  await playButton(page).waitFor({ state: 'attached' });
  await expect(playButton(page)).toHaveAttribute('data-provider');

  await expect(qualityTrigger(page)).toHaveCount(0);
});
