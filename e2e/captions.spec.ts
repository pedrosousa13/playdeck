import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

// Wait for a provider to attach, then click play ONCE. Starting playback is a
// precondition of these tests rather than the thing under test: what they
// assert is that cue text reaches the overlay, and a browser updates
// `activeCues` only as time marches on, which never runs while media is
// paused. So a click that does not start playback leaves the overlay present
// and EMPTY rather than absent — a caption failure to read, and not one.
//
// The wait is the point. A click landing before a provider attaches is refused
// and starts nothing, so clicking again until something happens would retry
// past the precondition rather than establish it, and a retry is
// indistinguishable from a grown timeout. Waiting for it instead leaves every
// assertion below on its 5s default.
//
// `data-provider` is the signal because it is the DOM-observable, documented
// shadow of that precondition: `PlayButton` renders it only once a provider is
// in hand (`packages/react/src/transport-controls.tsx`), the play-button story
// states the contract — "`data-provider` is set once a provider attaches" —
// and `packages/react/README.md` names it on provider-bound controls. Presence
// is what is asserted, not a value: the gate is that some provider attached,
// not which one, so it holds if these fixtures ever move off native.
//
// Measured 2026-08-26 under `@playwright/test` 1.61.1, `--repeat-each=15
// --retries=0 --workers=6` on a 4-core machine, both arms the same day:
//
//   arm      chromium      firefox
//   ungated  25 of 60      16 of 45
//   gated     0 of 60       0 of 45
//
// Firefox is 45 rather than 60 because the safe-area test below is
// chromium-only. `--workers=6` oversubscribes deliberately: contention is what
// surfaces this, so an idle run is a poor test of it.
const play = async (page: Page) => {
  await expect(playButton(page)).toHaveAttribute('data-provider');
  await playButton(page).click();
};

test('custom captions render the discovered track once playing', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-custom&viewMode=story'
  );

  await play(page);

  const captionsButton = page.locator('[data-playdeck-part="captions-button"]');
  await expect(captionsButton).toHaveAttribute('data-state', 'on');

  const captions = page.locator('[data-playdeck-part="captions"]');
  await expect(captions).toContainText('Playdeck caption one');
});

test('the captions button toggles the overlay off and back on', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-custom&viewMode=story'
  );

  await play(page);

  const captionsButton = page.locator('[data-playdeck-part="captions-button"]');
  const captions = page.locator('[data-playdeck-part="captions"]');
  await expect(captions).toContainText('Playdeck caption one');

  await captionsButton.click();
  await expect(captionsButton).toHaveAttribute('data-state', 'off');
  await expect(
    captions.locator('[data-playdeck-part="caption-cue"]')
  ).toHaveCount(0);

  await captionsButton.click();
  await expect(captionsButton).toHaveAttribute('data-state', 'on');
  await expect(captions).toContainText('Playdeck caption one');
});

test('native caption rendering leaves the custom overlay empty', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-native&viewMode=story'
  );

  await play(page);

  const captionsButton = page.locator('[data-playdeck-part="captions-button"]');
  await expect(captionsButton).toHaveAttribute('data-state', 'on');

  await expect(page.locator('[data-playdeck-part="captions"]')).toHaveCount(0);
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
  await play(page);
  const captions = page.locator('[data-playdeck-part="captions"]');
  const cue = page.locator('[data-playdeck-part="caption-cue"]').first();
  await expect(cue).toHaveText(/Playdeck caption one/);
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
