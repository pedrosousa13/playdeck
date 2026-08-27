import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

// Wait for the play button to exist before asserting anything about it. A test
// that opens on an assertion rather than on an action pays for getting the
// story on screen out of that assertion's budget, and each one below does.
//
// The e2e server is `storybook dev`, which compiles a story on first request,
// so `page.goto` resolves on a document whose story module has not run — the
// button appears some way after it. `playwright.config.ts` provisions for that
// with a 30s test timeout, and a locator method inherits it: `actionTimeout` is
// unset, so `waitFor` runs with no timeout of its own and is bounded by the
// test. An `expect` matcher does not inherit it; it runs on the 5s `expect`
// default whatever the test timeout is. A spec that opens on an assertion
// therefore charges the compile and mount to that assertion's 5s, and what is
// left over is what the player gets to reach the state being asserted.
//
// So this draws a boundary rather than lengthening a wait for the thing under
// test. Nothing about the player is awaited here — the button renders before a
// provider is bound — so binding a provider, attaching, loading and the
// autoplay attempt itself all still have to land inside the untouched 5s
// budget of the assertion that follows.
//
// Measured on this machine, 2026-08-27, under `@playwright/test` 1.61.1 with
// `--repeat-each=30 --retries=0 --workers=6` on a 4-core machine, 30 runs of
// each test per arm:
//
//   arm      firefox muted   firefox blocked   chromium muted   chromium blocked
//   ungated  11 failed       6 failed          0 failed         0 failed
//   gated    0 failed        0 failed          0 failed         0 failed
//
// Only two engines are listed because only those two were run; `--workers=6`
// oversubscribes deliberately, since contention is what makes the compile slow
// and so an idle run is a poor test of this. Instrumented over those firefox
// runs, the button appeared 0.7s to 4.9s after `page.goto` resolved and
// sometimes not inside the budget at all, while the span from the button
// appearing to `data-autoplay-state="started"` stayed between 0.3s and 1.6s.
const mountedPlayButton = async (page: Page) => {
  const play = playButton(page);
  await play.waitFor();
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
