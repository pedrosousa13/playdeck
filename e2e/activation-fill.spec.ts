import { expect, test } from '@playwright/test';
import { activationButton } from './locators';

/**
 * The activation control's own paint, pinned by driving a rendered player
 * rather than by reading `loading-error.tsx`'s source text (#603, a follow-up
 * to #555's `packages/react/test/style-precedence.test.tsx`, which falls back
 * to a regex over that file precisely because happy-dom cannot resolve
 * `background-color` for this part -- see that test's own comment).
 *
 * Both stories below already exist for this: `Player/ActivationButton`'s
 * `OverlayOnPoster` renders with no stylesheet at all (the Theme toolbar
 * global defaults to `headless`, see `apps/storybook/.storybook/preview.tsx`,
 * and `withTheme` mounts nothing for that value), and `Theme/Theme`'s
 * `ActivationIsCentred` pins `globals: { theme: 'themed' }` at the meta level.
 */

test('a player with no stylesheet paints its activation control transparent, so the poster underneath stays visible', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=player-activationbutton--overlay-on-poster&viewMode=story'
  );
  const posterImage = page.locator('[data-playdeck-part="poster-image"]');
  await expect(posterImage).toHaveAttribute('data-state', 'loaded');

  // `data-state="loaded"` above is the *image's* own load state -- it says
  // nothing about the poster's wrapping part, whose `visibility` is a
  // separate, state-derived style (`Poster` in `poster.tsx`). Asserted
  // directly, so a poster that finished loading behind a `visibility: hidden`
  // wrapper cannot pass as "visible" by accident.
  const poster = page.locator('[data-playdeck-part="poster"]');
  await expect(poster).toBeVisible();

  const overlay = activationButton(page);
  await expect(overlay).toBeVisible();

  // "Behind", not merely "also present": the overlay has to be the part
  // painted on top for the transparency below to mean anything.
  const [overlayZIndex, posterZIndex] = await Promise.all([
    overlay.evaluate((element) =>
      Number(globalThis.getComputedStyle(element).zIndex)
    ),
    poster.evaluate((element) =>
      Number(globalThis.getComputedStyle(element).zIndex)
    )
  ]);
  expect(overlayZIndex).toBeGreaterThan(posterZIndex);

  const paint = await overlay.evaluate((element) => {
    const styles = globalThis.getComputedStyle(element);
    return {
      background: styles.backgroundColor,
      border: styles.borderTopWidth
    };
  });
  // The pre-#555 defect painted the user agent's own opaque button face and a
  // 2px outset border here instead, over a poster that was loaded, decoded
  // and visible throughout.
  expect(paint.background).toBe('rgba(0, 0, 0, 0)');
  expect(paint.border).toBe('0px');
});

test('the themed activation control still reads its fill from the token, not a hardcoded !important rule', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=theme-theme--activation-is-centred&viewMode=story&globals='
  );
  const overlay = activationButton(page);
  await expect(overlay).toBeVisible();

  const themedFill = await overlay.evaluate(
    (element) => globalThis.getComputedStyle(element).backgroundColor
  );
  expect(themedFill).toBe('rgba(0, 0, 0, 0.72)');

  // `theme.css` declares `--playdeck-activation-fill` directly on this part
  // -- a deliberate exception to "every token is read, never declared" (see
  // that file's own header) -- as a normal, non-`!important` declaration.
  // Overriding the same custom property inline, on the same element, has to
  // win: an inline declaration beats any non-`!important` author rule
  // regardless of specificity. A hardcoded `!important` background-color
  // would ignore this override outright, which is what makes it a test of
  // `!important` rather than a repeat of the assertion above.
  const overriddenFill = await overlay.evaluate((element) => {
    element.style.setProperty('--playdeck-activation-fill', 'rgb(1, 2, 3)');
    return globalThis.getComputedStyle(element).backgroundColor;
  });
  expect(overriddenFill).toBe('rgb(1, 2, 3)');
});
