import { expect, test, type Page } from '@playwright/test';

/**
 * A `VolumeSlider` with no adjacent `MuteButton` sat at `opacity: 0;
 * pointer-events: none` at rest under `(pointer: fine)`, because the hidden
 * rest state's selector was the bare `[data-playdeck-part='volume-slider']`
 * rather than one qualified by the mute button's adjacency. `pointer-events:
 * none` removes an element from hit testing, so a slider in that state can
 * never match its own `:hover` branch either — it was invisible and
 * pointer-unreachable, Tab the only way in. Both `theme.css` and
 * `docked.css` carry the rule and neither imports the other, so both are
 * driven here in turn.
 *
 * Mounted through the toolbar's Theme global, the one mechanism that mounts
 * either stylesheet (`apps/storybook/.storybook/theme.tsx`'s `withTheme`).
 *
 * Chromium and firefox only, here and throughout this file — not four runs
 * but six: `playwright.config.ts` also runs a `webkit` project, which cannot
 * launch on the development machine (two missing system libraries), so CI's
 * matrix is the only instrument for it and none of the red below was measured
 * there.
 *
 * Red, run 2026-09-12 under pinned Playwright (1.61.1), both themes, chromium
 * and firefox, with `theme.css` and `docked.css` reverted to the bare
 * `[data-playdeck-part='volume-slider']` selector (no adjacent-sibling
 * qualifier):
 * - `expect(opacity).toBe('1')` read `'0'` in all four cases.
 * - With that assertion neutralised so the run reached the next one,
 *   `expect(pointerEvents).not.toBe('none')` failed in all four: "Expected:
 *   not \"none\"".
 * - With both neutralised, `expect(hitPart).toBe('volume-slider')` failed in
 *   all four: "Expected: \"volume-slider\", Received: \"viewport\"".
 *
 * The two `AssembledBar` guard tests below pass identically whether or not
 * the fix is present, by design — a slider composed beside a `MuteButton`
 * behaves the same before and after, so there is no unfixed state for them to
 * catch. Falsified instead by a fallback mutation, same date and Playwright
 * version: with the `mute-button:hover`/`:focus-within` branches removed from
 * the reveal selector list in both stylesheets (leaving only the slider's own
 * `:hover`/`:focus-within`), the reveal-on-hover assertion timed out in all
 * four cases: "Expected: \"1\", Received: \"0\" — Timeout 5000ms exceeded
 * while waiting on the predicate".
 */
const storyUrl = (theme: string): string =>
  `/iframe.html?id=player-volumeslider--half-volume&viewMode=story&globals=theme:${theme}`;

const themes = ['themed', 'docked'] as const;

for (const theme of themes) {
  test(`a standalone volume slider is visible and pointer-reachable at rest, under the ${theme} theme`, async ({
    page
  }) => {
    await page.goto(storyUrl(theme));
    const slider = page.locator('[data-playdeck-part="volume-slider"]');
    await expect(slider).toBeVisible();

    const [opacity, pointerEvents] = await Promise.all([
      slider.evaluate(
        (element) => globalThis.getComputedStyle(element).opacity
      ),
      slider.evaluate(
        (element) => globalThis.getComputedStyle(element).pointerEvents
      )
    ]);
    expect(opacity).toBe('1');
    expect(pointerEvents).not.toBe('none');

    // `elementFromPoint` is blind to `pointer-events: none` (see
    // `e2e/a11y.spec.ts`'s note beside its `LoadingIndicator` exclusion), so
    // this is the assertion the computed-style reads above cannot make on
    // their own: that the slider is the thing a pointer actually lands on at
    // its own centre, rather than merely reporting styles nothing enforces.
    const box = (await slider.boundingBox())!;
    const hitPart = await page.evaluate(
      ({ x, y }: { x: number; y: number }) =>
        document.elementFromPoint(x, y)?.getAttribute('data-playdeck-part') ??
        null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    );
    expect(hitPart).toBe('volume-slider');
  });
}

// Not part of the loop above: this is the paired behaviour the fix must
// leave untouched, on the one story that composes `MuteButton` and
// `VolumeSlider` as siblings (`apps/storybook/stories/controls.stories.tsx`,
// `AssembledBar`).
const assembledBarUrl = (theme: string): string =>
  `/iframe.html?id=player-controls--assembled-bar&viewMode=story&globals=theme:${theme}`;

const revealedOpacity = async (page: Page): Promise<string> =>
  page
    .locator('[data-playdeck-part="volume-slider"]')
    .evaluate((element) => globalThis.getComputedStyle(element).opacity);

for (const theme of themes) {
  test(`a volume slider beside a mute button still hides at rest and reveals on the button's hover, under the ${theme} theme`, async ({
    page
  }) => {
    await page.goto(assembledBarUrl(theme));
    const muteButton = page.locator('[data-playdeck-part="mute-button"]');
    await expect(muteButton).toBeVisible();

    await expect.poll(() => revealedOpacity(page)).toBe('0');

    const box = (await muteButton.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => revealedOpacity(page)).toBe('1');
  });
}
