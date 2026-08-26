import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

// Wait for a provider to attach, then click play ONCE. Starting playback is a
// precondition of these tests rather than the thing under test: what they
// assert is that cue text reaches the overlay, and a browser updates
// `activeCues` only as time marches on, which never runs while media is
// paused. So a click that does not start playback leaves the overlay present
// and EMPTY rather than absent, which is exactly the failure #480 recorded.
//
// A click landing before a provider attaches is refused with a typed
// `not-ready` and then discarded by the button, so nothing starts and nothing
// says so. That is a product defect, tracked in #484, and this helper does not
// paper over it: it waits for the precondition instead of retrying past it.
// Clicking more than once would be the papering-over, and would be
// indistinguishable from a grown timeout.
//
// `data-provider` is the gate because it is the DOM-observable, documented
// shadow of that precondition. `PlayButton` renders
// `data-provider={provider ?? undefined}`
// (`packages/react/src/transport-controls.tsx:131`), so the attribute is
// absent for exactly the pre-attach window and present from the moment a
// provider is in hand. The contract is stated to consumers, not inferred here:
// the play-button story says `data-provider` is set once a provider attaches,
// and `packages/react/README.md` names it as part of the styling and querying
// surface. Its presence, not its value, is what is asserted — the fixtures
// here are native, but which provider attached is irrelevant to the wait.
//
// The wait carries the 5s default, like every other assertion in this file. No
// timeout anywhere in it is raised.
//
// Measured 2026-08-26 on the maintainer's machine under `@playwright/test`
// 1.61.1, `--repeat-each=15 --retries=0 --workers=6` — 60 chromium runs and 45
// firefox per arm, both arms on the same machine on the same day:
//
//   arm      chromium   firefox
//   ungated  25 failed  16 failed
//   gated     0 failed   0 failed
//
// CONTENTION IS WHAT SURFACES IT, so an idle run is a poor test of this: at
// the default worker count the same ungated spec failed 8 in 60 on chromium
// and 2 in 60 on firefox. #484 measured the gate itself in isolation over 60
// attempts per engine — 6/60 ungated on chromium against 0/60 gated — and
// every one of those 6 had no provider attached at the instant of the click.
//
// WEBKIT IS UNMEASURED: it has no H.264 locally and cannot play `tracer.mp4`
// at all, so every webkit run fails for an unrelated reason and no rate can be
// taken here. The CI rate is unmeasured on all three engines.
const play = async (page: Page) => {
  await expect(playButton(page)).toHaveAttribute('data-provider', /.+/);
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
