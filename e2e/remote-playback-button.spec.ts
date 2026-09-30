import { expect, test } from '@playwright/test';

// Chromium only, per the issue's acceptance criteria: the button is gated on
// `capabilities.remotePlayback`, and CI's chromium never has a receiver on
// the network, so `RealProviderNoDevice` below is the honest default rather
// than a contrived one.
//
// That default alone is unfalsifiable (docs/agents/demonstrated-red.md's
// "three shapes that read a default as a result"): a button that always
// rendered nothing -- because the feature was never built, or because it was
// built and gated wrong -- would pass the same way. `Available` is the
// companion: a mock fixture (`ready({ remotePlayback: available })`,
// `apps/storybook/stories/remote-playback-button.stories.tsx`) that proves
// the button can render at all once a device is reported, since chromium in
// CI has no real device to report one.

test('renders nothing against a real native provider with no receiver on the network', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName !== 'chromium',
    "This issue's acceptance criteria name chromium."
  );

  await page.goto(
    '/iframe.html?id=player-remoteplaybackbutton--real-provider-no-device&viewMode=story'
  );

  // Waits for the real native provider to attach and settle ready, so the
  // absence below is read once the capability has actually resolved rather
  // than before the media element exists at all -- the `client:only`-hydration
  // shape demonstrated-red.md warns a negative assertion can pass for free.
  await expect(page.locator('video')).toBeVisible();
  await expect(
    page.locator('[data-playdeck-part="remote-playback-button"]')
  ).toHaveCount(0);
});

test('renders the button once the capability reports a device available', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName !== 'chromium',
    "This issue's acceptance criteria name chromium."
  );

  await page.goto(
    '/iframe.html?id=player-remoteplaybackbutton--available&viewMode=story'
  );

  const button = page.locator('[data-playdeck-part="remote-playback-button"]');
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName('Cast');
});
