import { expect, test, type Page } from '@playwright/test';
import { chaptersTrigger, playButton } from './locators';

// #64's fix, restated here rather than imported: a play issued before the
// provider attaches is refused as `not-ready` and dropped, so a click has to
// wait for `activation: 'ready'` first -- `e2e/native-mp4.spec.ts`'s own
// `startPlayback` takes the identical wait for the identical reason.
const story =
  '/iframe.html?id=fixtures-playerfixture--native-chapters&viewMode=story';

const gotoReady = async (page: Page): Promise<void> => {
  await page.goto(story);
  await expect(playButton(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().activation)
    )
    .toBe('ready');
};

// Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
// additive code has no natural unfixed state, so the part's render was
// gutted -- an unconditional `return null` right after the status/empty-list
// gate in chapters.tsx -- and this whole file run against it (chromium). All
// three tests in this file failed the same way, each timing out on the same
// locator:
//
//   Error: locator.click: Test timeout of 30000ms exceeded.
//   Call log:
//     - waiting for locator('[data-playdeck-part="settings-menu-trigger"][aria-label="Chapters"]')
//
//   3 failed
//     [chromium] › e2e/chapters.spec.ts:21:1 › lists the published chapters, marks the current one from currentTime, and seeks end-to-end on select, driven on the native chapters fixture
//     [chromium] › e2e/chapters.spec.ts:65:1 › the current-chapter marking moves as real playback crosses a chapter boundary
//     [chromium] › e2e/chapters.spec.ts:102:1 › opens and selects a chapter by keyboard, focus returning to the trigger
//
// Reverted, and all six -- on chromium and firefox both -- passed again.
test('lists the published chapters, marks the current one from currentTime, and seeks end-to-end on select, driven on the native chapters fixture', async ({
  page
}) => {
  await gotoReady(page);

  await chaptersTrigger(page).click();
  const menu = page.getByRole('group');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
  const intro = menu.getByRole('menuitemradio', {
    name: 'Intro · 0:00',
    exact: true
  });
  const middle = menu.getByRole('menuitemradio', {
    name: 'Middle · 0:03',
    exact: true
  });
  const outro = menu.getByRole('menuitemradio', {
    name: 'Outro · 0:06',
    exact: true
  });
  // Playback has not started, so `currentTime` is still 0 -- inside "Intro".
  await expect(intro).toHaveAttribute('aria-checked', 'true');
  await expect(middle).toHaveAttribute('aria-checked', 'false');
  await expect(outro).toHaveAttribute('aria-checked', 'false');

  await middle.click();

  // The real state moved, not just the menu -- the acceptance criterion this
  // proves is "driven end-to-end", which a menu that merely opens does not.
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().currentTime)
    )
    .toBeGreaterThanOrEqual(3);

  await chaptersTrigger(page).click();
  await expect(
    page.getByRole('group').getByRole('menuitemradio', {
      name: 'Middle · 0:03',
      exact: true
    })
  ).toHaveAttribute('aria-checked', 'true');
});

test('the current-chapter marking moves as real playback crosses a chapter boundary', async ({
  page
}) => {
  await gotoReady(page);

  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  await chaptersTrigger(page).click();
  const menu = page.getByRole('group');
  const intro = menu.getByRole('menuitemradio', {
    name: 'Intro · 0:00',
    exact: true
  });
  const middle = menu.getByRole('menuitemradio', {
    name: 'Middle · 0:03',
    exact: true
  });
  await expect(intro).toHaveAttribute('aria-checked', 'true');

  // Real elapsed playback, not a synthetic seek: waits for the provider's
  // own `currentTime` to actually cross the 3s boundary between "Intro" and
  // "Middle" in `chapters.vtt`.
  await expect
    .poll(
      () => page.evaluate(() => window.playdeckHandle?.getState().currentTime),
      { timeout: 10_000 }
    )
    .toBeGreaterThanOrEqual(3);

  // The menu was already open and never re-clicked: the marking moved on its
  // own as `currentTime` advanced, which is the whole of what this test is
  // for.
  await expect(middle).toHaveAttribute('aria-checked', 'true');
  await expect(intro).toHaveAttribute('aria-checked', 'false');
});

test('opens and selects a chapter by keyboard, focus returning to the trigger', async ({
  page
}) => {
  await gotoReady(page);

  // Driven entirely by keyboard, the same shape `e2e/quality.spec.ts`'s own
  // keyboard test drives QualityMenu in (and `e2e/playback-rate.spec.ts`'s
  // own for PlaybackRateMenu): focus the trigger, ArrowDown opens the menu
  // and lands focus on its first item, End moves to the last rung, and Enter
  // fires the native click a focused `<button>` answers to.
  await chaptersTrigger(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio')).toHaveCount(3);
  await page.keyboard.press('End');
  const selectedLabel = (await page.locator(':focus').textContent())?.trim();
  await page.keyboard.press('Enter');

  await expect(chaptersTrigger(page)).toBeFocused();

  await chaptersTrigger(page).click();
  await expect(
    page.getByRole('menuitemradio', { name: selectedLabel, exact: true })
  ).toHaveAttribute('aria-checked', 'true');

  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().currentTime)
    )
    .toBeGreaterThanOrEqual(6);
});
