import { expect, test, type Page } from '@playwright/test';
import { media, playButton } from './locators';

// Click play until playback has started. A click on the play button is
// sometimes swallowed — the button is present and `play()` is not blocked, but
// the player never acts on the click — so this WORKS AROUND a dropped click
// rather than showing that clicking play is reliable. It is not: the dropped
// click is a product defect, tracked in #484 — tolerated HERE only because
// starting playback is a precondition of these tests rather than the thing
// under test. What they assert is that cue text reaches the overlay, and a
// swallowed click leaves that overlay present and EMPTY rather than absent,
// because a browser updates `activeCues` only as time marches on, which never
// runs while media is paused.
//
// The wait is on the precondition itself because nothing observable stands in
// for it: an activation reaching `ready` is not published to the DOM, and the
// play button's `data-state` is set before a click on it does anything.
// `currentTime > 0` is the signal for the reason `played()` in
// `e2e/a11y-media.spec.ts` gives — a ~1s fixture leaves `playing` on its own,
// while `currentTime` stays true once ended. That file's fixtures are the
// reference stories rather than this one, but `tracer.mp4` behind
// `captions-custom` is 1.000s too, so the reasoning carries.
//
// The click is guarded by that same check rather than repeated blindly: a
// `toPass` body that clicks every iteration toggles a playing video back to
// paused. 15s is a bound on this wait alone and tightens rather than loosens
// anything — `toPass` otherwise runs to the 30s test timeout, and every
// assertion in this file keeps the 5s default.
//
// Measured 2026-08-26 on the maintainer's machine under `@playwright/test`
// 1.61.1, `--repeat-each=15 --retries=0 --workers=6`, 60 chromium runs and 45
// firefox: an ungated click failed 32 on chromium and 10 on firefox, against 0
// here. Contention is what surfaces it — ungated at the default worker count
// the same spec failed 8 in 60 and 2 in 60 — so an idle run is a poor test of
// this. WEBKIT IS UNMEASURED: it has no H.264 locally and cannot play
// `tracer.mp4` at all, so every webkit run fails for an unrelated reason.
const play = async (page: Page) => {
  const started = () =>
    media(page).evaluate((el: HTMLVideoElement) => el.currentTime > 0);
  await expect(async () => {
    if (!(await started())) await playButton(page).click();
    expect(await started()).toBe(true);
  }).toPass({ timeout: 15_000 });
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
