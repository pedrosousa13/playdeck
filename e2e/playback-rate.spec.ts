import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { playButton, playbackRateTrigger } from './locators';

// #64's fix, restated here rather than imported: a play issued before the
// provider attaches is refused as `not-ready` and dropped, so a click has to
// wait for `activation: 'ready'` first -- `e2e/native-mp4.spec.ts`'s own
// `startPlayback` takes the identical wait for the identical reason.
const startNativePlayback = async (page: Page): Promise<void> => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );
  const play = playButton(page);
  await expect(play).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().activation)
    )
    .toBe('ready');
  await play.click();
};

test('lists the default rate list, driven end-to-end on native', async ({
  page
}) => {
  await startNativePlayback(page);
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  await playbackRateTrigger(page).click();
  const menu = page.getByRole('group');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(4);
  const rate1x = menu.getByRole('menuitemradio', { name: '1×', exact: true });
  await expect(rate1x).toHaveAttribute('aria-checked', 'true');

  await menu.getByRole('menuitemradio', { name: '2×', exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().playbackRate)
    )
    .toBe(2);

  await playbackRateTrigger(page).click();
  await expect(
    page
      .getByRole('group')
      .getByRole('menuitemradio', { name: '2×', exact: true })
  ).toHaveAttribute('aria-checked', 'true');
});

// Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
// additive code has no natural unfixed state, so the part's render was
// gutted -- an unconditional `return null` right after the status gate in
// playback-rate.tsx -- and this whole file run against it (chromium). All
// three tests in this file failed the same way, each timing out on the same
// locator:
//
//   Error: locator.focus: Test timeout of 30000ms exceeded.
//   Call log:
//     - waiting for locator('[data-playdeck-part="settings-menu-trigger"][aria-label="Playback rate"]')
//     > await playbackRateTrigger(page).focus();
//
//   3 failed
//     [chromium] › e2e/playback-rate.spec.ts:23:1 › lists the default rate list, driven end-to-end on native
//     [chromium] › e2e/playback-rate.spec.ts:63:1 › opens and selects a rate by keyboard, focus returning to the trigger
//     [chromium] › e2e/playback-rate.spec.ts:128:1 › chooses a rate end-to-end on a rate-capable embed (Vimeo)
//
// Reverted, and all three -- on chromium and firefox both -- passed again.
test('opens and selects a rate by keyboard, focus returning to the trigger', async ({
  page
}) => {
  await startNativePlayback(page);
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  // Driven entirely by keyboard, the same shape `e2e/quality.spec.ts`'s own
  // keyboard test drives QualityMenu in: focus the trigger, ArrowDown opens
  // the menu and lands focus on its first item, End moves to the last rung,
  // and Enter fires the native click a focused `<button>` answers to.
  await playbackRateTrigger(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio')).toHaveCount(4);
  await page.keyboard.press('End');
  const selectedLabel = (await page.locator(':focus').textContent())?.trim();
  await page.keyboard.press('Enter');

  await expect(playbackRateTrigger(page)).toBeFocused();

  await playbackRateTrigger(page).click();
  await expect(
    page.getByRole('menuitemradio', { name: selectedLabel, exact: true })
  ).toHaveAttribute('aria-checked', 'true');
});

// A fully offline stand-in for https://player.vimeo.com/video/<id> -- the
// same technique e2e/vimeo.spec.ts's own `routeVimeo` uses -- so this proves
// setPlaybackRate end-to-end on a real embed adapter without a real Vimeo
// request. e2e/fixtures/vimeo-embed.html already answers `setPlaybackRate`
// and emits `playbackratechange`, which is what @playdeck/provider-vimeo
// reads to publish `PlayerState.playbackRate` back.
const isVimeoHostname = (hostname: string): boolean =>
  /(^|\.)(vimeo\.com|vimeocdn\.com)$/i.test(hostname);

const routeVimeo = async (page: Page): Promise<void> => {
  const body = await readFile(
    new URL('./fixtures/vimeo-embed.html', import.meta.url),
    'utf8'
  );
  await page.route(/vimeo/i, async (route) => {
    const url = new URL(route.request().url());
    if (!isVimeoHostname(url.hostname)) {
      await route.fallback();
      return;
    }
    if (url.hostname === 'vimeo.com' && url.pathname === '/api/oembed.json') {
      await route.fulfill({
        body: JSON.stringify({ account_type: 'pro' }),
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        status: 200
      });
      return;
    }
    if (
      url.hostname === 'player.vimeo.com' &&
      url.pathname.startsWith('/video/')
    ) {
      await route.fulfill({ body, contentType: 'text/html', status: 200 });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
};

test('chooses a rate end-to-end on a rate-capable embed (Vimeo)', async ({
  page
}) => {
  await routeVimeo(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--vimeo-interaction&viewMode=story'
  );
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  await playbackRateTrigger(page).click();
  await page.getByRole('menuitemradio', { name: '0.5×', exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().playbackRate)
    )
    .toBe(0.5);
});
