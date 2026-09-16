import { expect, test } from '@playwright/test';
import { media, playButton } from './locators';

const STORY =
  '/iframe.html?id=fixtures-suppliedproviderfixture--example-file-clip&viewMode=story';

// `Player.Root`'s `providers` prop, driven through a full playback flow
// against a source kind this package ships no loader for. The registration
// itself is `examples/provider-setup-file-adapter.tsx`'s real
// "example-file" provider -- a `<video>` element this file owns end to end,
// not a wrapper around `@playdeck/provider-native`'s own adapter -- wired up
// by `apps/storybook/stories/supplied-provider.stories.tsx`.
//
// This proves the whole seam end to end in a real browser, not only the
// dispatch `packages/react/test/provider-loaders.test.ts` and
// `packages/react/test/supplied-provider.test.tsx` already cover against
// jsdom: `detectExampleFile` resolves the `source` string core's own five
// kinds refuse, `Root` commits to that detection, `Media` mounts the div
// `viewport-media.tsx`'s fallback branch renders for a supplied kind, the
// adapter's own factory attaches a real `<video>` inside it, and the player
// reaches confirmed `playing`, `paused` and `ended` the same way
// `native-mp4.spec.ts` proves for a built-in native source.
//
// A test that only proved playback would pass identically had the built-in
// native provider attached instead of the supplied one -- exactly the
// "reads a default as a result" shape docs/agents/demonstrated-red.md warns
// against. The first assertion below is what tells the two apart:
// `PlayerState.provider` is stamped by whichever adapter actually attached
// (`PlayerController.setProvider`, `packages/core/src/player-controller.ts`),
// and the example adapter reports its own honest identity there rather than
// borrowing `'native'` (see the comment above `provider:` in
// `provider-setup-file-adapter.tsx`).
//
// Demonstrated red, by a named substitute mutation
// (docs/agents/demonstrated-red.md's fallback: the feature is additive, so
// nothing stands to be reverted). The story's `source` was pointed at a
// built-in kind instead of the supplied one --
// `source="https://files.example/clips/tracer"` changed to
// `source={assetUrl('tracer.mp4')}`, which core's own native detection
// claims outright before `providers` is ever consulted -- run with
// `pnpm test:e2e --project=chromium e2e/supplied-provider.spec.ts`: the
// first assertion failed, `expect(received).toBe(expected)` with
// `Expected: "example-file"` and `Received: "native"` -- proof the
// assertion actually distinguishes the two rather than passing for either.
// Reverted afterwards.
test('plays, pauses, and ends a supplied-kind source through Player.Root', async ({
  page
}) => {
  await page.goto(STORY);

  // The supplied adapter attached, not the built-in native provider a
  // plain `.mp4` URL would have resolved to.
  await expect
    .poll(() => page.evaluate(() => window.playdeckHandle?.getState().provider))
    .toBe('example-file');

  const play = playButton(page);
  await expect(play).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().activation)
    )
    .toBe('ready');

  // The mount `viewport-media.tsx` renders for a supplied kind: a div, not a
  // `<video>` -- the adapter's own factory appends its `<video>` inside it.
  await expect(media(page)).toHaveJSProperty('tagName', 'DIV');
  await expect(media(page).locator('video')).toHaveCount(1);

  // `detectExampleFile` reads the clip id off the story's source string
  // (`https://files.example/clips/tracer` -> `tracer`) and the factory
  // writes it onto the mounted `<video>` as `dataset.exampleFileClipId` --
  // this confirms the round trip the comment beside that write claims a
  // reader or a test can check.
  await expect(media(page).locator('video')).toHaveAttribute(
    'data-example-file-clip-id',
    'tracer'
  );

  await play.click();
  await expect(play).toHaveAttribute('data-state', 'playing');

  await play.click();
  await expect(play).toHaveAttribute('data-state', 'paused');

  await play.click();
  await expect(play).toHaveAttribute('data-state', 'ended');
});
