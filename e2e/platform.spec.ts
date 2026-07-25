import { expect, test, type Page } from '@playwright/test';

type PresentationExpectation = {
  fullscreen: string;
  pictureInPicture: string;
  airPlay: string;
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
    const airPlayDenied =
      media.getAttribute('x-webkit-airplay') === 'deny' ||
      media.disableRemotePlayback === true;
    const airPlay =
      typeof media.webkitShowPlaybackTargetPicker !== 'function'
        ? 'unavailable'
        : airPlayDenied
          ? 'unavailable'
          : 'available';
    return { fullscreen, pictureInPicture, airPlay };
  });

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
  await expect(capabilities(page)).toHaveAttribute(
    'data-airplay-status',
    expected.airPlay
  );
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

  // AirPlay availability is API-support driven, so the reported capability must
  // match what the current engine actually exposes. Real route availability and
  // the picker UI are covered by the manual device matrix.
  const expected = await environmentExpectation(page);
  await expect(capabilities(page)).toHaveAttribute(
    'data-airplay-status',
    expected.airPlay
  );
  await expect(page.getByTestId('airplay-picker')).toHaveCount(
    expected.airPlay === 'available' ? 1 : 0
  );

  if (browserName === 'chromium' || browserName === 'firefox') {
    // Only WebKit exposes a programmatic AirPlay route picker; everywhere else
    // the capability is unavailable with reason browser.
    expect(expected.airPlay).toBe('unavailable');
    await expect(capabilities(page)).toHaveAttribute(
      'data-airplay-reason',
      'browser'
    );
  }
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
