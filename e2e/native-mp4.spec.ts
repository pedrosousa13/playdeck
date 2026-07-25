import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    reelyHandle?: {
      getState: () => { activation: string; playbackRate: number };
      setPlaybackRate: (rate: number) => Promise<{ ok: boolean }>;
    };
  }
}

// The fixture clip is 1.0s long, so at 1x the player is only in its `playing`
// state for about a second (measured: `ended` at ~1030ms). Every assertion
// about playback therefore had to be issued, resolved AND acted on inside that
// window, and under full parallel load the click-to-query round trip has
// exceeded it — which is #64: `element(s) not found` for the Pause button,
// because the clip was already over. Slowing playback widens the window to ~4s
// without a longer asset, and without giving up test parallelism.
//
// Note this is not a timeout problem: raising the expect timeout waits longer
// for a button that has already gone.
const PLAYBACK_RATE = 0.25;

const startSlowPlayback = async (page: Page) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );
  const play = page.getByRole('button', { name: 'Play' });
  await expect(play).toBeVisible();

  // The Play button is visible and clickable while the provider is still
  // loading, and a rate set in that window is silently overwritten when the
  // provider attaches and the React layer applies its default rate of 1
  // (see the product bug filed off this spec). Wait for `ready` first.
  await expect
    .poll(() => page.evaluate(() => window.reelyHandle?.getState().activation))
    .toBe('ready');

  await page.evaluate(
    (rate) => window.reelyHandle?.setPlaybackRate(rate),
    PLAYBACK_RATE
  );
  // Assert the slow rate actually took: if it is ever dropped again, this
  // fails here with a clear cause instead of resurfacing as a flaky Pause
  // button several lines later.
  await expect
    .poll(() =>
      page.evaluate(() => window.reelyHandle?.getState().playbackRate)
    )
    .toBe(PLAYBACK_RATE);

  await play.click();
};

test('plays, pauses, and ends an MP4 with confirmed native states', async ({
  page
}) => {
  await startSlowPlayback(page);

  const pauseButton = page.getByRole('button', { name: 'Pause' });
  await expect(pauseButton).toHaveAttribute('data-state', 'playing');

  await pauseButton.click();
  await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute(
    'data-state',
    'paused'
  );

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute(
    'data-state',
    'ended',
    // The remainder of the clip at a quarter speed, plus headroom.
    { timeout: 15_000 }
  );
});

test('the playing state survives a slow scheduler (#64 regression)', async ({
  page
}) => {
  await startSlowPlayback(page);

  // Stands in for the CPU contention that made this spec fail locally: a delay
  // between the play click and the first assertion that is longer than the
  // unslowed clip. If the playing window ever narrows back to about a second,
  // this fails every run rather than half of them.
  await page.waitForTimeout(1_500);

  await expect(page.getByRole('button', { name: 'Pause' })).toHaveAttribute(
    'data-state',
    'playing'
  );
});
