import { expect, test } from '@playwright/test';
import { media, playButton } from './locators';

const STORY =
  '/iframe.html?id=fixtures-suppliedproviderfixture--acme-clip&viewMode=story';

// `Player.Root`'s `providers` prop, driven through a full playback flow
// against a source kind this package ships no loader for. The registration
// itself is `apps/storybook/stories/supplied-provider-fixture.tsx`'s
// test-local "acme" provider, built to give this spec a supplied kind to
// drive without depending on a real third-party host.
//
// This proves the whole seam end to end in a real browser, not only the
// dispatch `packages/react/test/provider-loaders.test.ts` and
// `packages/react/test/supplied-provider.test.tsx` already cover against
// jsdom: `detectAcmeUrl` resolves the `source` string core's own five kinds
// refuse, `Root` commits to that detection, `Media` mounts the div
// `viewport-media.tsx`'s new fallback branch renders for a supplied kind, the
// fixture's factory attaches a real `<video>` inside it, and the player
// reaches confirmed `playing`, `paused` and `ended` the same way
// `native-mp4.spec.ts` proves for a built-in native source.
//
// Demonstrated red (docs/agents/demonstrated-red.md's fallback: the feature
// is additive, so a substitute mutation stands in for reverting it).
// `detectSourceWithProviders` (`provider-loaders.ts`) made to never resolve a
// supplied kind -- its string-path loop over `providers`' own entries
// emptied, and its explicit-object lookup made to always miss -- run with
// `pnpm test:e2e --project=chromium e2e/supplied-provider.spec.ts`: the test
// below failed at its first assertion, `expect(...).toBe('native')` timing
// out at 5000ms with `Received: null` (`window.playdeckHandle?.getState().
// provider` never resolving), because `Root` never committed to the acme
// detection at all. Reverted afterwards.
test('plays, pauses, and ends a supplied-kind source through Player.Root', async ({
  page
}) => {
  await page.goto(STORY);

  // The registered source object survived the round trip through `detect`
  // and back out through `load`'s own factory -- proof this player is
  // actually running the supplied registration, not merely tolerating an
  // unrecognised source and idling.
  await expect
    .poll(() => page.evaluate(() => window.playdeckHandle?.getState().provider))
    .toBe('native');

  const play = playButton(page);
  await expect(play).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().activation)
    )
    .toBe('ready');

  // The mount `viewport-media.tsx` renders for a supplied kind: a div, not a
  // `<video>` -- the fixture's own factory appends its `<video>` inside it.
  await expect(media(page)).toHaveJSProperty('tagName', 'DIV');
  await expect(media(page).locator('video')).toHaveCount(1);

  await play.click();
  await expect(play).toHaveAttribute('data-state', 'playing');

  await play.click();
  await expect(play).toHaveAttribute('data-state', 'paused');

  await play.click();
  await expect(play).toHaveAttribute('data-state', 'ended');
});
