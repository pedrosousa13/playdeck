import { expect, test } from '@playwright/test';

// The theme's two accessibility modes can only be checked with real media
// emulation, which the Storybook play tests cannot do — they assert the rest of
// the theme contract (layer override, tokens, the 44px floor) in-browser.
//
// Loads the Theme story, which mounts @reely/react/theme.css for its own
// lifetime rather than importing it into the whole preview.
const themeStory =
  '/iframe.html?id=theme-theme--default&viewMode=story&globals=';

test('nonessential motion is disabled under prefers-reduced-motion', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(themeStory);

  const controls = page.locator('[data-reely-part="controls"]');
  await expect(controls).toBeVisible();
  // The transition still exists as a declaration; its duration collapses, so
  // nothing animates and no state change is delayed. Parsed rather than string
  // matched: engines serialise a sub-millisecond duration differently
  // (Chromium reports `1e-05s`).
  await expect
    .poll(() =>
      controls.evaluate((element) =>
        Number.parseFloat(
          globalThis.getComputedStyle(element).transitionDuration
        )
      )
    )
    .toBeLessThan(0.001);
});

test('motion is present when reduced motion is not requested', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(themeStory);

  const controls = page.locator('[data-reely-part="controls"]');
  await expect(controls).toBeVisible();
  // Guards the test above: if the theme shipped no transition at all, the
  // reduced-motion assertion would pass for the wrong reason.
  await expect
    .poll(() =>
      controls.evaluate((element) =>
        Number.parseFloat(
          globalThis.getComputedStyle(element).transitionDuration
        )
      )
    )
    .toBeGreaterThan(0.1);
});

test('control states stay distinguishable in forced-colors mode', async ({
  page
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto(themeStory);

  const play = page.getByRole('button', { name: 'Play' });
  await expect(play).toBeVisible();

  const idle = await play.evaluate((element) => {
    const styles = globalThis.getComputedStyle(element);
    return {
      background: styles.backgroundColor,
      border: styles.borderTopWidth
    };
  });
  // Translucent tints are dropped in this mode, so the theme has to give the
  // control a real border and a system-palette fill instead — otherwise an idle
  // control is indistinguishable from a hovered one. Asserted through what the
  // user can see rather than through `forced-color-adjust`, which WebKit does
  // not expose on computed styles even though it honours the media query.
  expect(idle.border).toBe('1px');
  expect(idle.background).not.toBe('rgba(0, 0, 0, 0)');

  await play.hover();
  const hovered = await play.evaluate(
    (element) => globalThis.getComputedStyle(element).backgroundColor
  );
  expect(hovered).not.toBe(idle.background);
});

test('the themed player has a focus indicator that survives forced colors', async ({
  page
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto(themeStory);

  const play = page.getByRole('button', { name: 'Play' });
  await play.focus();
  const outline = await play.evaluate((element) => {
    const styles = globalThis.getComputedStyle(element);
    return { width: styles.outlineWidth, style: styles.outlineStyle };
  });
  expect(outline.style).toBe('solid');
  expect(outline.width).toBe('2px');
});
