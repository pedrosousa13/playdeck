import { expect, test, type Page } from '@playwright/test';
import { activationButton, media, muteButton } from './locators';

/**
 * #757: `Gestures`' shipped JSDoc says a later sibling stays clickable only
 * if it is itself positioned, and neither shipped stylesheet positions
 * `controls`. This pins the instruction: under `@playdeck/react/docked.css`,
 * with `Gestures` mounted before `Controls` and the bar positioned exactly
 * as the JSDoc's general rule shows (`position: relative`, which leaves the
 * bar where `docked.css` lays it out, below the picture), a real pointer
 * click on the mute button reaches it rather than the full-bleed gesture
 * layer underneath.
 *
 * Fixture: `player-gestures--clickable-under-docked-theme`
 * (`apps/storybook/stories/gestures.stories.tsx`), which mounts the
 * positioning rule in a `<style>` tag alongside the composition. Removing
 * that rule (`Gestures` still before `Controls`) is what this commit's red
 * run reverted.
 */
const story =
  '/iframe.html?id=player-gestures--clickable-under-docked-theme&viewMode=story';

// Same reasoning as `e2e/reference.spec.ts`'s own `played`: the local fixture
// is short, so `data-state === 'playing'` is a state the clip can leave on its
// own within a couple of seconds and asserting it directly would race.
// `currentTime > 0` stays true once playback has started, ended or not.
const played = (page: Page) =>
  expect
    .poll(
      () => media(page).evaluate((el: HTMLVideoElement) => el.currentTime),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0);

test('a real pointer click reaches the mute button through a positioned control bar', async ({
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // A real Playwright pointer click, not `force` and not a dispatched event:
  // if the gesture layer paints on top, the click's own actionability check
  // fails and this line times out, reporting the gesture layer as the
  // interceptor. `force` would bypass exactly that check. The assertions
  // below confirm the click actually took effect.
  await muteButton(page).click();
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');
  await expect(
    media(page).evaluate((el: HTMLVideoElement) => el.muted)
  ).resolves.toBe(true);
});
