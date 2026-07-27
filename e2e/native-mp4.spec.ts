import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

const STORY =
  '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story';

// #64: this spec failed most full local runs and passed every isolated one.
//
// The cause is not the assertion budget, and not the length of the clip. The
// Play button renders while the player is still `dormant` -- about 50ms before
// the provider attaches -- and a play issued in that window is refused with
// `not-ready` and dropped, because nothing queues commands before the provider
// is there. Under full parallel load the provider's dynamic import slows down
// while Playwright's click latency does not, so the click lands in the refusal
// window and playback never starts. Instrumented failures show `currentTime: 0`
// and `paused: true` at the point the Pause button is missing: the clip had not
// ended, it had never begun.
//
// That is why raising the expect timeout could not have fixed it, which was
// issue #64's first suggestion. The button is not late; it never arrives.
//
// So the fix is to click once the player will accept the command. The refusal
// window itself is real product behaviour, covered by the second test below and
// tracked in #69.
const startPlayback = async (page: Page) => {
  await page.goto(STORY);
  const play = playButton(page);
  await expect(play).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.reelyHandle?.getState().activation))
    .toBe('ready');
  await play.click();
};

test('plays, pauses, and ends an MP4 with confirmed native states', async ({
  page
}) => {
  await startPlayback(page);

  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'paused');

  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'ended');
});

// The behaviour that caused #64, pinned deliberately instead of being waited
// past. The button is on screen and enabled before the player can act on it,
// and clicking it there does nothing at all -- no playback, no feedback.
//
// This documents today's behaviour rather than endorsing it; #69 covers the
// gap. When that is resolved -- by queueing the command, or by disabling the
// control until it works -- this test should be changed deliberately, which is
// the point of having it.
test('a play issued before the player is ready is dropped (#69)', async ({
  page
}) => {
  await page.goto(STORY);

  // Asserted through the handle rather than by clicking the button. Clicking is
  // what a user does, but the refusal window is tens of milliseconds wide and
  // the provider can attach between reading the state and dispatching the
  // click -- which it does on webkit and firefox, so the button version of this
  // test passes for the wrong reason about half the time. Reaching for the
  // command directly is the same code path the button uses
  // (`togglePlaybackWithOrigin` -> `playWithOrigin`) with the race removed.
  const outcome = await page.evaluate(async () => {
    const handle = () => window.reelyHandle;
    const start = Date.now();
    while (!handle() && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const activation = handle()?.getState().activation;
    return { activation, result: await handle()?.play() };
  });

  // Refused, not queued, while the Play button is already on screen.
  expect(outcome.activation).not.toBe('ready');
  expect(outcome.result).toEqual({ ok: false, reason: 'not-ready' });

  await expect(playButton(page)).toHaveAttribute('data-state', 'paused');
});
