import { expect, test, type Page } from '@playwright/test';
import { audioTrackTrigger, playButton } from './locators';

// Waits for the engine readout to attach before reading its text, the same
// reason `e2e/hls.spec.ts`'s `mountedHlsEngine` does: a locator wait draws on
// the test's wide timeout, absorbing the story's cold compile and mount, so
// the assertion after it keeps its own 5s default.
const mountedHlsEngine = async (page: Page) => {
  const engine = page.getByTestId('hls-engine');
  await engine.waitFor({ state: 'attached' });
  return engine;
};

// Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
// additive code has no natural unfixed state, so `MenuRadioGroup`'s
// `onValueChange` in audio-tracks.tsx was replaced with a no-op (dropping
// the `controller.selectAudioTrack(value)` call), and this test run against
// it (chromium):
//
//   Error: expect(locator).toHaveAttribute(expected) failed
//   Locator:  getByRole('group').getByRole('menuitemradio', { name: 'Español', exact: true })
//   Expected: "true"
//   Received: "false"
//   Timeout:  5000ms
//   Call log:
//     - Expect "toHaveAttribute" with timeout 5000ms
//     - waiting for getByRole('group').getByRole('menuitemradio', { name: 'Español', exact: true })
//       14 × locator resolved to <button …aria-checked="false"…>…</button>
//          - unexpected value "false"
//
//   1 failed
//     [chromium] › e2e/audio-tracks.spec.ts:30:1 › lists both alternate-audio renditions, driven end-to-end on hls.js (8.2s)
//
// Reverted, and it passed again (3.2s).
test('lists both alternate-audio renditions, driven end-to-end on hls.js', async ({
  browserName,
  page
}) => {
  // Forced `engine: 'hls.js'` flows in this repo run on Chromium only --
  // `e2e/hls.spec.ts`'s own forced-hls.js test carries the same restriction.
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--hls-audio-tracks&viewMode=story'
  );

  const engine = await mountedHlsEngine(page);
  await expect(engine).toHaveText('hls.js');

  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  // The fixture manifest (apps/storybook/public/hls/audio.m3u8) carries two
  // `EXT-X-MEDIA:TYPE=AUDIO` renditions -- English (`DEFAULT=YES`) and
  // Español -- the same file `e2e/hls-audio-tracks.spec.ts` drives at the
  // adapter level.
  await audioTrackTrigger(page).click();
  const menu = page.getByRole('group');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
  await expect(
    menu.getByRole('menuitemradio', { name: 'English', exact: true })
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    menu.getByRole('menuitemradio', { name: 'Español', exact: true })
  ).toHaveAttribute('aria-checked', 'false');

  await menu
    .getByRole('menuitemradio', { name: 'Español', exact: true })
    .click();

  await audioTrackTrigger(page).click();
  const reopened = page.getByRole('group');
  await expect(
    reopened.getByRole('menuitemradio', { name: 'Español', exact: true })
  ).toHaveAttribute('aria-checked', 'true');
  // The provider is expected to enforce exclusivity itself (see the comment
  // above `activeId`, audio-tracks.tsx) -- this is what actually tests it,
  // rather than only checking the row that was clicked.
  await expect(
    reopened.getByRole('menuitemradio', { name: 'English', exact: true })
  ).toHaveAttribute('aria-checked', 'false');
});

// Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
// additive code has no natural unfixed state, so the part's render was
// gutted -- an unconditional `return null` right after the status gate in
// audio-tracks.tsx -- and this test run against it (chromium):
//
//   Error: locator.focus: Test timeout of 30000ms exceeded.
//   Call log:
//     - waiting for locator('[data-playdeck-part="settings-menu-trigger"][aria-label="Audio track"]')
//
//   1 failed
//     [chromium] › e2e/audio-tracks.spec.ts:97:1 › opens and selects a track by keyboard, focus returning to the trigger (30.0s)
//
// Reverted, and it passed again (3.2s).
//
// That mutation only proves the trigger exists; it says nothing about
// whether `End` actually moves roving focus, which is what
// `expect(selectedLabel).toBe('Español')` below exists to catch. Demonstrated
// separately: `SettingsMenu`'s `case 'End'` handler in settings-menu.tsx
// changed to focus `items[0]` instead of `items[items.length - 1]` (focus
// never leaves the first, already-active item), and this test run against
// it (chromium):
//
//   Error: expect(received).toBe(expected) // Object.is equality
//   Expected: "Español"
//   Received: "English"
//
//   1 failed
//     [chromium] › e2e/audio-tracks.spec.ts:97:1 › opens and selects a track by keyboard, focus returning to the trigger (3.1s)
//
// Reverted, and it passed again.
test('opens and selects a track by keyboard, focus returning to the trigger', async ({
  browserName,
  page
}) => {
  // Forced `engine: 'hls.js'` flows in this repo run on Chromium only --
  // `e2e/hls.spec.ts`'s own forced-hls.js test carries the same restriction.
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--hls-audio-tracks&viewMode=story'
  );
  const engine = await mountedHlsEngine(page);
  await expect(engine).toHaveText('hls.js');
  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  // Driven entirely by keyboard, the same shape `e2e/quality.spec.ts`'s own
  // keyboard test drives `QualityMenu` in: focus the trigger, ArrowDown opens
  // the menu and lands focus on its first item (roving focus and the open
  // transition are SettingsMenu's own, exercised here through
  // AudioTrackMenu's composition of it), End moves focus to the last item,
  // and Enter fires the native click a focused `<button>` answers to, the
  // same activation MenuRadioItem's own `onClick` handles for a mouse.
  await audioTrackTrigger(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio')).toHaveCount(2);
  await page.keyboard.press('End');
  const selectedLabel = (await page.locator(':focus').textContent())?.trim();
  // English renders first and is already active, so without this the test
  // cannot tell End moving focus from End doing nothing -- unlike
  // `e2e/quality.spec.ts`'s own keyboard test, there is no Auto row here to
  // guarantee the last item differs from the first.
  expect(selectedLabel).toBe('Español');
  await page.keyboard.press('Enter');

  // Selecting closes the menu and returns focus to the trigger, the same
  // shape `e2e/a11y.spec.ts`'s own Escape assertion takes for SettingsMenu.
  await expect(audioTrackTrigger(page)).toBeFocused();

  await audioTrackTrigger(page).click();
  await expect(
    page.getByRole('menuitemradio', { name: selectedLabel, exact: true })
  ).toHaveAttribute('aria-checked', 'true');
});

// Demonstrated red, substitute mutation. The natural red baseline -- no
// <Player.AudioTrackMenu/> composed at all -- would pass vacuously, since
// "renders nothing" is also what an unbuilt feature does; this only
// discriminates under a mutation that removes the capability gate instead.
// Deleted `if (status !== 'available') return null;` from audio-tracks.tsx,
// so the trigger renders regardless of capability, and ran this test on
// chromium:
//
//   Error: expect(locator).toHaveCount(expected) failed
//   Locator:  locator('[data-playdeck-part="settings-menu-trigger"][aria-label="Audio track"]')
//   Expected: 0
//   Received: 1
//   Call log:
//     - Expect "toHaveCount" with timeout 5000ms
//     - waiting for locator('[data-playdeck-part="settings-menu-trigger"][aria-label="Audio track"]')
//       14 × locator resolved to 1 element
//          - unexpected value "1"
//
//   1 failed
//     [chromium] › e2e/audio-tracks.spec.ts:176:1 › renders nothing on a native MP4 source (7.9s)
//
// Reverted, and it passed again (2.8s).
test('renders nothing on a native MP4 source', async ({ page }) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );

  await playButton(page).waitFor({ state: 'attached' });
  await expect(playButton(page)).toHaveAttribute('data-provider');

  await expect(audioTrackTrigger(page)).toHaveCount(0);
});
