import { expect, test, type Page } from '@playwright/test';

type PresentationExpectation = {
  fullscreen: string;
  pictureInPicture: string;
  airPlayCanBeAvailable: boolean;
};

const capabilities = (page: Page) =>
  page.getByTestId('presentation-capabilities');

const awaitCapabilityResolution = async (page: Page): Promise<void> => {
  await expect(capabilities(page)).not.toHaveAttribute(
    'data-fullscreen-status',
    'unknown'
  );
  await expect(capabilities(page)).not.toHaveAttribute(
    'data-pip-status',
    'unknown'
  );
};

const environmentExpectation = (page: Page): Promise<PresentationExpectation> =>
  page.evaluate(() => {
    const media = document.querySelector('video') as HTMLVideoElement &
      Record<string, unknown>;
    const fullscreen =
      typeof media.requestFullscreen === 'function'
        ? document.fullscreenEnabled === false
          ? 'unavailable'
          : 'available'
        : typeof media.webkitEnterFullscreen === 'function' &&
            media.webkitSupportsFullscreen === true
          ? 'available'
          : 'unavailable';
    const supportsWebKitPictureInPicture =
      typeof media.webkitSetPresentationMode === 'function' &&
      typeof media.webkitSupportsPresentationMode === 'function' &&
      (media.webkitSupportsPresentationMode as (mode: string) => boolean)(
        'picture-in-picture'
      ) === true;
    const pictureInPicture =
      media.disablePictureInPicture === true
        ? 'unavailable'
        : typeof media.requestPictureInPicture === 'function'
          ? document.pictureInPictureEnabled === false
            ? 'unavailable'
            : 'available'
          : supportsWebKitPictureInPicture
            ? 'available'
            : 'unavailable';
    // #71: the picker API existing is no longer sufficient — `airPlay` follows
    // `webkitplaybacktargetavailabilitychanged`. So there is no fixed
    // expectation for the *settled* value on WebKit: whether a receiver is on
    // the network is a property of whoever is running the suite, and it is
    // not even stable within one machine (measured: this assertion passed
    // repeatedly and then failed with `available`, because a real receiver
    // was discovered mid-run). `airPlayCanBeAvailable` is what the engine
    // could report given a route, which is the only part that is a browser
    // -support fact and the only part this spec should pin.
    const airPlayDenied =
      media.getAttribute('x-webkit-airplay') === 'deny' ||
      media.disableRemotePlayback === true;
    const airPlayCanBeAvailable =
      typeof media.webkitShowPlaybackTargetPicker === 'function' &&
      !airPlayDenied;
    return { fullscreen, pictureInPicture, airPlayCanBeAvailable };
  });

// Simulates a receiver appearing on the network. playdeck does not check
// `isTrusted`, so a synthetic event exercises the same path a real one does —
// which is what makes the live transition testable in a real engine at all.
// Hardware verification of the real event still belongs to #30's device
// matrix.
const announceAirPlayRoute = async (page: Page): Promise<void> => {
  // The media element mounts independently of the capability readout, so
  // waiting on it here rather than assuming it: `evaluate` racing the mount
  // would throw below and read as a capability regression.
  await page.locator('video').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    const media = document.querySelector('video');
    if (!media) throw new Error('no media element');
    const event = new Event('webkitplaybacktargetavailabilitychanged');
    Object.defineProperty(event, 'availability', {
      configurable: true,
      value: 'available'
    });
    media.dispatchEvent(event);
  });
};

test('platform capability reporting matches what the browser supports', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story',
    { waitUntil: 'domcontentloaded' }
  );
  await awaitCapabilityResolution(page);

  const expected = await environmentExpectation(page);

  await expect(capabilities(page)).toHaveAttribute(
    'data-fullscreen-status',
    expected.fullscreen
  );
  await expect(capabilities(page)).toHaveAttribute(
    'data-pip-status',
    expected.pictureInPicture
  );
  // No `data-airplay-status` assertion here on purpose: since #71 that value
  // depends on whether a receiver is reachable from whoever is running the
  // suite, which is not a browser-support fact and not this test's subject.
  // The next test owns AirPlay.
});

test('platform AirPlay capability is WebKit-only and gates the picker control', async ({
  browserName,
  page
}) => {
  // The demo control is gated behind the `airplay` story arg, so this story is
  // the one place its capability gating is observable.
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--airplay-demo&viewMode=story',
    { waitUntil: 'domcontentloaded' }
  );
  await awaitCapabilityResolution(page);

  const expected = await environmentExpectation(page);

  if (browserName === 'chromium' || browserName === 'firefox') {
    // Only WebKit exposes a programmatic AirPlay route picker; everywhere else
    // the capability is unavailable with reason browser, and no route
    // announcement can change that.
    expect(expected.airPlayCanBeAvailable).toBe(false);
    await expect(capabilities(page)).toHaveAttribute(
      'data-airplay-status',
      'unavailable'
    );
    await expect(capabilities(page)).toHaveAttribute(
      'data-airplay-reason',
      'browser'
    );
    await expect(page.getByTestId('airplay-picker')).toHaveCount(0);
  }

  // The #71 transition, asserted in the direction that is deterministic
  // everywhere: announcing a route can only ever make AirPlay available, so
  // this holds whether or not the machine running the suite already has a
  // receiver on the network. The reverse claim — no receiver means no button
  // — is the one that needs controlled hardware, and stays with #30's device
  // matrix.
  await announceAirPlayRoute(page);
  await expect(capabilities(page)).toHaveAttribute(
    'data-airplay-status',
    expected.airPlayCanBeAvailable ? 'available' : 'unavailable'
  );
  await expect(page.getByTestId('airplay-picker')).toHaveCount(
    expected.airPlayCanBeAvailable ? 1 : 0
  );
});

test('platform capability gating shows presentation controls only when available', async ({
  browserName,
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story',
    { waitUntil: 'domcontentloaded' }
  );
  await awaitCapabilityResolution(page);

  const fullscreenStatus = await capabilities(page).getAttribute(
    'data-fullscreen-status'
  );
  const pictureInPictureStatus =
    await capabilities(page).getAttribute('data-pip-status');
  await expect(page.getByTestId('fullscreen-toggle')).toHaveCount(
    fullscreenStatus === 'available' ? 1 : 0
  );
  await expect(page.getByTestId('pip-toggle')).toHaveCount(
    pictureInPictureStatus === 'available' ? 1 : 0
  );

  if (browserName === 'chromium') {
    expect(fullscreenStatus).toBe('available');
    expect(pictureInPictureStatus).toBe('available');
  }
  if (browserName === 'firefox') {
    expect(fullscreenStatus).toBe('available');
    expect(pictureInPictureStatus).toBe('unavailable');
    await expect(capabilities(page)).toHaveAttribute(
      'data-pip-reason',
      'browser'
    );
  }
});

test('platform fullscreen commands confirm state through fullscreenchange', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName !== 'chromium',
    'Programmatic fullscreen coverage is Chromium-only; Safari and iOS run in the manual device matrix.'
  );
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story',
    { waitUntil: 'domcontentloaded' }
  );
  await awaitCapabilityResolution(page);

  const toggle = page.getByTestId('fullscreen-toggle');
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null))
    .toBe(true);
  await expect(capabilities(page)).toHaveAttribute(
    'data-fullscreen-state',
    'active'
  );

  // Exit through the provider's own exit command. The fullscreen media
  // element sits in the top layer above the toggle, so dispatch the click
  // directly instead of through a pointer; exiting needs no user gesture.
  await expect(toggle).toHaveText('Exit fullscreen');
  await toggle.evaluate((element) => (element as HTMLButtonElement).click());
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  await expect(capabilities(page)).toHaveAttribute(
    'data-fullscreen-state',
    'inline'
  );
});
