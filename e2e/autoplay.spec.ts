import { expect, test } from '@playwright/test';
import { playButton } from './locators';

test('muted autoplay reaches a confirmed started state', async ({ page }) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--autoplay-muted&viewMode=story'
  );

  const button = page.locator('[data-autoplay-state]');
  await expect(button).toHaveAttribute('data-autoplay-state', 'started');
  await expect(page.getByLabel('Reely media')).toHaveJSProperty('muted', true);
});

test('blocked audible autoplay waits for a user retry without muting', async ({
  page
}) => {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    let firstPlay = true;
    HTMLMediaElement.prototype.play = function () {
      if (firstPlay) {
        firstPlay = false;
        return Promise.reject(
          new DOMException(
            'Autoplay is blocked for this test.',
            'NotAllowedError'
          )
        );
      }
      return nativePlay.call(this);
    };
  });
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--autoplay-audible&viewMode=story'
  );

  const play = playButton(page);
  await expect(play).toHaveAttribute('data-autoplay-state', 'blocked');
  await expect(play).toHaveJSProperty('tabIndex', 0);
  await expect(page.getByLabel('Reely media')).toHaveJSProperty('muted', false);

  await play.click();

  await expect(play).toHaveAttribute('data-state', 'playing');
  await expect(page.getByLabel('Reely media')).toHaveJSProperty('muted', false);
});
