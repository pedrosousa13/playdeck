import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

// Wait for the play button to attach before asserting anything about it. A test
// that opens on an assertion charges getting the story on screen to that
// assertion's budget, and the two below open on one.
//
// The budgets differ, which is the whole of it. A locator method is bounded by
// the test timeout, which `playwright.config.ts` sets wide and says why. An
// `expect` matcher is not: it runs on its own 5s default however wide the test
// timeout is. So the wait can absorb a cost the assertion cannot, and what the
// assertion is left with is what the player gets to reach the state asserted.
//
// `attached` and not the default `visible`, because it releases at the earliest
// moment the button can be observed. That matters: the button renders before a
// provider is bound, so the earlier this releases, the more of the player's own
// work stays inside the assertion that follows rather than being absorbed here.
// It does not stay wholly outside. Probed over 20 chromium and firefox runs,
// this released before a provider was bound in 13 of them, and in the rest the
// compile was fast enough that binding had already happened — an `attached`
// gate narrows that overlap rather than removing it.
//
// Measured under `@playwright/test` 1.61.1, `--retries=0 --workers=6` on a
// 4-core machine, 30 firefox runs per arm against an already-compiled story:
//
//   arm      firefox muted
//   ungated  2 of 30 failed
//   gated    0 of 30 failed
//
// Both arms ran warm deliberately, so the figure is a floor: a cold compile is
// what makes this fail, and warming the story removes most of the cost being
// measured. `--workers=6` oversubscribes for the same reason — contention is
// what surfaces it, so an idle run understates it.
//
// Firefox is the only engine listed because it is the only one that reproduced
// it here; chromium did not fail either arm. Webkit, which is where CI reported
// it, does not launch on this machine and is unmeasured — the mechanism above
// is read across to it rather than observed there.
const mountedPlayButton = async (page: Page) => {
  const play = playButton(page);
  await play.waitFor({ state: 'attached' });
  return play;
};

test('muted autoplay reaches a confirmed started state', async ({ page }) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--autoplay-muted&viewMode=story'
  );

  const play = await mountedPlayButton(page);
  await expect(play).toHaveAttribute('data-autoplay-state', 'started');
  await expect(
    page.getByLabel('Playdeck media', { exact: true })
  ).toHaveJSProperty('muted', true);
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

  const play = await mountedPlayButton(page);
  await expect(play).toHaveAttribute('data-autoplay-state', 'blocked');
  await expect(play).toHaveJSProperty('tabIndex', 0);
  await expect(
    page.getByLabel('Playdeck media', { exact: true })
  ).toHaveJSProperty('muted', false);

  await play.click();

  await expect(play).toHaveAttribute('data-state', 'playing');
  await expect(
    page.getByLabel('Playdeck media', { exact: true })
  ).toHaveJSProperty('muted', false);
});
