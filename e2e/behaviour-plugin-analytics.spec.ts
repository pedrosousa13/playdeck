import { expect, test } from '@playwright/test';

const STORY =
  '/iframe.html?id=behaviour-plugins-analytics-events--sequence&viewMode=story';

// `apps/storybook/stories/react-behaviour-plugin.stories.tsx` is tagged
// `real-playback` + `!test` (`real-playback.contract.test.ts` requires the
// pair), which keeps it out of `pnpm test:storybook`'s zero-network suite the
// same way `e2e/supplied-provider.spec.ts` keeps `SuppliedProviderFixture`
// out of it. This is that story's own proof, run in a real browser, for
// #664's AC2: the workbench story runs and prints every event
// `examples/react-behaviour-plugin.tsx` maps.
//
// Demonstrated red (docs/agents/demonstrated-red.md's fallback -- the change
// is additive, so nothing stood to be reverted): with the story's `seekTo`
// changed to emit no `event` argument (`.storybook/mock-player.tsx`'s own
// mistake, reproduced on purpose), `npx playwright test --project=chromium
// e2e/behaviour-plugin-analytics.spec.ts` failed at the seek assertion --
// `expect(locator).toContainText(expected)` against `getByRole('list', {
// name: 'Mapped events' })`, expected substring "seek (user)", received
// "playpauseseek (provider)" -- `seekOrigin` fell back to `'provider'`
// with no confirming event to consume the pending origin the test's
// `'user'`-tagged command set. Reverted afterwards.
test('prints play, pause, seek, ended and error as they occur', async ({
  page
}) => {
  await page.goto(STORY);

  const play = page.getByRole('button', { name: 'Play', exact: true });
  const log = page.getByRole('list', { name: 'Mapped events', exact: true });

  await expect(play).toBeVisible();
  await play.click();
  await expect(log).toContainText('play');

  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await pause.click();
  await expect(log).toContainText('pause');

  await page.getByRole('button', { name: 'Seek to 10s', exact: true }).click();
  await expect(log).toContainText('seek (user)');

  await page
    .getByRole('button', { name: 'Finish (simulated)', exact: true })
    .click();
  await expect(log).toContainText('ended');

  await page
    .getByRole('button', { name: 'Fail (simulated)', exact: true })
    .click();
  await expect(log).toContainText(
    'error: The media element could not load the source.'
  );

  // In order, and nothing extra: the whole mapped sequence for #664's AC2.
  await expect(log.locator('li')).toHaveText([
    'play',
    'pause',
    'seek (user)',
    'ended',
    'error: The media element could not load the source.'
  ]);
});
