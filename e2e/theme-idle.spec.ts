import { expect, test, type Page } from '@playwright/test';

/**
 * The floating theme's auto-hide, measured from computed style rather than from
 * the stylesheet's text.
 *
 * `packages/react/test/theme.test.ts` asserts the two rules exist. It cannot
 * say whether they win: both are zero-specificity rules inside `@layer
 * playdeck`, the visible state is the *absence* of `data-idle='true'` rather
 * than a rule of its own, and the timer that writes the attribute lives in
 * `Viewport`. Only a rendered player composites all three.
 *
 * The focus case is here for the same reason it is not a DOM test of the
 * timer: the timer never inspects focus, so `data-idle` reads `"true"` under a
 * focused control and only `:focus-within` keeps the bar on screen. That is a
 * CSS rule and nothing in JavaScript can be asked about it.
 *
 * Mounted through the toolbar's Theme global, which is the one mechanism that
 * mounts `theme.css` (`apps/storybook/.storybook/theme.tsx`).
 */
const themedStory = (id: string): string =>
  `/iframe.html?id=${id}&viewMode=story&globals=theme:themed`;

/**
 * The control surface, never a control inside it. The volume slider sits at
 * `opacity: 0` at rest under `(pointer: fine)` all on its own, so a reading
 * taken from anything below the bar would report the reveal rather than the
 * auto-hide.
 */
const controlsOpacity = async (page: Page): Promise<number> =>
  Number(
    await page
      .locator('[data-playdeck-part="controls"]')
      .evaluate((element) => globalThis.getComputedStyle(element).opacity)
  );

const idleAttribute = async (page: Page): Promise<string | null> =>
  page.locator('[data-playdeck-part="viewport"]').getAttribute('data-idle');

test('the control bar fades after the idle delay while playing, and returns on pointermove', async ({
  page
}) => {
  await page.goto(themedStory('reference-player--playing'));
  // Moving the pointer onto the player first is what proves the fade is the
  // timer expiring rather than a bar that was never visible: this move resets
  // the timer, so the zero below is measured from a bar that was at 1.
  await page.mouse.move(200, 200);
  await expect.poll(() => controlsOpacity(page), { timeout: 5000 }).toBe(1);
  await expect.poll(() => controlsOpacity(page), { timeout: 8000 }).toBe(0);

  await page.mouse.move(210, 210);
  await expect.poll(() => controlsOpacity(page)).toBe(1);
});

test('the control bar never fades while paused, sampled repeatedly across several idle delays', async ({
  page
}) => {
  await page.goto(themedStory('reference-player--composition'));
  // Sampled eight times across eight seconds — more than three idle delays —
  // rather than waited out once, so a fade that starts and ends between two
  // samples of a single wait cannot pass unnoticed. A paused player never arms
  // the timer, so every sample should read the same 1.
  for (let sample = 0; sample < 8; sample++) {
    expect(await controlsOpacity(page)).toBe(1);
    await page.waitForTimeout(1000);
  }
});

test('a focused control keeps the bar visible past the idle delay, even once data-idle reads true', async ({
  page
}) => {
  await page.goto(themedStory('reference-player--playing'));
  await page.locator('[data-playdeck-part="mute-button"]').focus();
  // Both assertions matter together. `data-idle` reading `"true"` is what says
  // the timer expired and the bar is visible for the CSS's reason rather than
  // because nothing had happened yet.
  await expect.poll(() => idleAttribute(page), { timeout: 8000 }).toBe('true');
  expect(await controlsOpacity(page)).toBe(1);
});
