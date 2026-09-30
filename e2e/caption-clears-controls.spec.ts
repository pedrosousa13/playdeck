import { expect, test, type Page } from '@playwright/test';
import { captionsTriggerSelector } from './locators';

/**
 * #760: while the control row is shown, the caption cue's BOX must clear it
 * entirely, whatever the cue's own background is — a stronger claim than
 * #682's (`caption-line-clearance.spec.ts`), which only kept the trigger out
 * from under the caption TEXT. The cue's opaque default background covers its
 * own box even where the text inside it does not reach that far, which is
 * exactly how #760 reproduced under either shipped theme: the row's buttons
 * are 44px boxes there (24px-ish icons, unthemed), so the trailing group the
 * reference composition's own spacer pins to the row's right edge is wide
 * enough to reach under the cue's centred box, though not under its shorter
 * text line.
 *
 * Rects measured in the browser, never read out of a stylesheet — the same
 * reasoning `caption-line-clearance.spec.ts` gives for the same shape of
 * check.
 */
const composition = (globals: string): string =>
  `/iframe.html?id=reference-player--composition&viewMode=story&globals=${globals}`;

const cueSelector = '[data-playdeck-part="caption-cue"]';
const captionsButtonSelector = '[data-playdeck-part="captions-button"]';

type Box = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
};

const boxOf = (page: Page, selector: string): Promise<Box> =>
  page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element === null) throw new Error(`no element matched ${sel}`);
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom
    };
  }, selector);

const describeBox = (box: Box): string =>
  `x${box.left.toFixed(2)}-${box.right.toFixed(2)} ` +
  `y${box.top.toFixed(2)}-${box.bottom.toFixed(2)}`;

const overlaps = (one: Box, other: Box): boolean =>
  one.left < other.right &&
  one.right > other.left &&
  one.top < other.bottom &&
  one.bottom > other.top;

/**
 * Polls rather than reading once: the mock decorator stages capabilities in
 * a commit after the first (`Controls`' own row grows once the full staged
 * state lands), and the maintainer ruling explicitly allows the lift itself
 * to be transitioned — either way, a settled non-overlap is the claim this
 * makes, not an instantaneous one. Fails with the last-seen rects on both
 * sides so a genuine regression still names numbers, the way a one-shot
 * `expect` would.
 */
const expectClearOf = async (
  page: Page,
  otherSelector: string,
  describeOther: string
): Promise<void> => {
  let lastCue: Box | undefined;
  let lastOther: Box | undefined;
  await expect
    .poll(async () => {
      lastCue = await boxOf(page, cueSelector);
      lastOther = await boxOf(page, otherSelector);
      return overlaps(lastCue, lastOther);
    })
    .toBe(false);
  expect(
    lastCue && lastOther ? overlaps(lastCue, lastOther) : true,
    lastCue && lastOther
      ? `the cue box must not overlap ${describeOther}: ` +
          `cue ${describeBox(lastCue)}, ${describeOther} ${describeBox(lastOther)}`
      : `never measured ${describeOther}`
  ).toBe(false);
};

/**
 * Two consecutive identical reads, not one: the mock decorator stages
 * capabilities in a commit after the first, so the row (and with it the
 * cue's lifted position) can still be growing into its final size for a
 * moment after `data-idle` first reads `"false"`. A single read here is
 * exactly the shape of race `expectClearOf` above already works around for
 * the overlap check; this is the same fix for a test that needs the actual
 * settled rect, not merely a non-overlapping one.
 */
const stableBoxOf = async (page: Page, selector: string): Promise<Box> => {
  let previous: Box | undefined;
  await expect
    .poll(async () => {
      const current = await boxOf(page, selector);
      const stable =
        previous !== undefined &&
        current.top === previous.top &&
        current.bottom === previous.bottom &&
        current.left === previous.left &&
        current.right === previous.right;
      previous = current;
      return stable;
    })
    .toBe(true);
  return previous!;
};

const themes = ['docked', 'themed'] as const;

for (const theme of themes) {
  test(`the caption cue box clears the captions button and its trigger under ${theme} at 1280x720`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(composition(`theme:${theme}`));
    await expect(page.locator(cueSelector)).toBeVisible();

    await expectClearOf(page, captionsButtonSelector, 'the captions button');
    await expectClearOf(
      page,
      captionsTriggerSelector,
      'the captions menu trigger'
    );
  });

  // Phone width, not merely a narrowed container: the shipped themes' own
  // control-size shrink lives behind a `@media (max-width: 48rem)` viewport
  // query, which a narrowed `#storybook-root` (`e2e/visual.spec.ts`'s own
  // 320px container check) never crosses. 390px also clears the reference
  // composition's own `@container (max-width: 420px)` fold, so the docked
  // control row here is the one a real phone visitor gets, not a scaled-down
  // desktop one — and the row's height differs from the 1280px case above
  // precisely because of it, which is the case this fix must not assume away.
  test(`the caption cue box clears the captions button and its trigger under ${theme} at a phone width`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(composition(`theme:${theme}`));
    await expect(page.locator(cueSelector)).toBeVisible();

    await expectClearOf(page, captionsButtonSelector, 'the captions button');
    await expectClearOf(
      page,
      captionsTriggerSelector,
      'the captions menu trigger'
    );
  });
}

/**
 * `docked.css` never reads `data-idle` — its bar is docked, not overlaid, and
 * never hides — so a fix that decided "shown" from the attribute alone would
 * un-lift the cue onto a bar that never actually faded, the moment the idle
 * delay elapsed. That is #760's own overlap again, reached through the
 * fix's own idle handling rather than through the original layout cause.
 *
 * Pinned by comparing the cue's rect before and after the wait, not only by
 * a non-overlap check: identical rects is the direct claim that idle changed
 * nothing here, where "still clear" alone would also pass a fix that lifted
 * a little less on idle rather than not at all.
 */
test('the caption cue box stays clear of the docked bar once the idle delay elapses', async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(
    '/iframe.html?id=reference-player--playing&viewMode=story&globals=theme:docked'
  );
  await expect(page.locator(cueSelector)).toBeVisible();
  await page.mouse.move(200, 200);

  const idleAttribute = () =>
    page.locator('[data-playdeck-part="viewport"]').getAttribute('data-idle');
  await expect.poll(idleAttribute).toBe('false');
  await expectClearOf(page, captionsButtonSelector, 'the captions button');
  const shownCue = await stableBoxOf(page, cueSelector);

  // `IDLE_DELAY_MS` (viewport-media.tsx) is 2500ms; 8s matches
  // `e2e/theme-idle.spec.ts`'s own margin for the same wait. `data-idle`
  // still flips to `"true"` here — the timer runs regardless of theme — only
  // `docked.css` never reads it for anything visual.
  await expect.poll(idleAttribute, { timeout: 8000 }).toBe('true');

  const idleCue = await stableBoxOf(page, cueSelector);
  expect(idleCue.top).toBeCloseTo(shownCue.top, 0);
  expect(idleCue.bottom).toBeCloseTo(shownCue.bottom, 0);
  await expectClearOf(page, captionsButtonSelector, 'the captions button');
  await expectClearOf(
    page,
    captionsTriggerSelector,
    'the captions menu trigger'
  );
});

/**
 * The other half of the maintainer ruling: once the row idle-hides, the lift
 * has nothing to clear and the cue returns to the resting position
 * `captionsOverlayStyle`'s own `paddingBottom` already draws — asserted
 * against that computed value rather than a literal, so this does not pin a
 * number that safe-area or a font-size change would silently outdate.
 *
 * `themed`, not `docked`: `docked.css` never reads `data-idle` (its bar is
 * docked, not overlaid, and never hides), so it has no idle transition for
 * this test to drive.
 */
test('the caption cue box returns to its resting position once the control row idle-hides', async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(
    '/iframe.html?id=reference-player--playing&viewMode=story&globals=theme:themed'
  );
  await expect(page.locator(cueSelector)).toBeVisible();
  await page.mouse.move(200, 200);

  const idleAttribute = () =>
    page.locator('[data-playdeck-part="viewport"]').getAttribute('data-idle');
  // The row is shown at first (a fresh pointer move resets the timer), so the
  // cue is lifted clear of it here — the same invariant the tests above pin,
  // repeated as this test's own precondition rather than assumed from them.
  await expect.poll(idleAttribute).toBe('false');
  await expectClearOf(page, captionsButtonSelector, 'the captions button');

  // `IDLE_DELAY_MS` (viewport-media.tsx) is 2500ms; 8s matches
  // `e2e/theme-idle.spec.ts`'s own margin for the same wait.
  await expect.poll(idleAttribute, { timeout: 8000 }).toBe('true');

  const overlay = page.locator('[data-playdeck-part="captions"]');
  await expect(overlay).toHaveCSS('transform', 'none');

  const viewport = await boxOf(page, '[data-playdeck-part="viewport"]');
  const restingPaddingBottom = await overlay.evaluate((element) =>
    Number.parseFloat(globalThis.getComputedStyle(element).paddingBottom)
  );
  const idleCue = await boxOf(page, cueSelector);
  expect(
    Math.abs(idleCue.bottom - (viewport.bottom - restingPaddingBottom))
  ).toBeLessThan(1);
});

/**
 * `Captions`' own effect finds the control row once, at mount, through a
 * plain `querySelector` — this proves the `MutationObserver` beside it is
 * what actually keeps that current, by mounting a stand-in row well after
 * Captions already exists. `player-captions--one-line` composes no controls
 * at all, which is what makes "still at rest" checkable as the starting
 * point rather than assumed: nothing here has ever painted a row.
 *
 * A hand-built element, not a rendered `Player.Controls`, and inline-styled
 * rather than reaching for `--playdeck-*` tokens: what this proves is that
 * the part contract alone (`data-playdeck-part="controls"`, a real box) is
 * what the observer keys off, not any behaviour specific to the primitive.
 */
test('the lift picks up a control row that mounts after Captions does', async ({
  page
}) => {
  await page.goto('/iframe.html?id=player-captions--one-line&viewMode=story');
  await expect(page.locator(cueSelector)).toBeVisible();
  const overlay = page.locator('[data-playdeck-part="captions"]');
  const overlayTransform = () =>
    overlay.evaluate(
      (element) => globalThis.getComputedStyle(element).transform
    );
  await expect.poll(overlayTransform).toBe('none');

  await page.evaluate(() => {
    const viewport = document.querySelector('[data-playdeck-part="viewport"]')!;
    const standIn = document.createElement('div');
    standIn.setAttribute('data-playdeck-part', 'controls');
    Object.assign(standIn.style, {
      position: 'absolute',
      insetInline: '0',
      insetBlockEnd: '0',
      blockSize: '48px'
    });
    viewport.appendChild(standIn);
  });

  await expect.poll(overlayTransform).not.toBe('none');
});

/**
 * `CONTROLS_CLEARANCE_TRANSITION_MS` collapses to `0.01ms` under
 * `prefers-reduced-motion: reduce` (captions.tsx) rather than to `0s`
 * outright — the same "still fires, just imperceptibly" choice `theme.css`'s
 * own reduced-motion block already makes for the row's own opacity fade, so
 * this checks for near-zero rather than exactly zero. The lift itself still
 * has to apply; reduced motion is a motion preference, not an opt-out of the
 * feature — `expectClearOf` alongside the duration check is what tells the
 * two apart.
 */
test('the lift is near-instant, not transitioned, under prefers-reduced-motion', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(composition('theme:themed'));
  await expect(page.locator(cueSelector)).toBeVisible();

  await expectClearOf(page, captionsButtonSelector, 'the captions button');

  const transitionDuration = await page
    .locator('[data-playdeck-part="captions"]')
    .evaluate(
      (element) => globalThis.getComputedStyle(element).transitionDuration
    );
  expect(Number.parseFloat(transitionDuration)).toBeLessThan(0.001);
});
