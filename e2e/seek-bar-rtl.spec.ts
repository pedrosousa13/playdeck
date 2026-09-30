import { expect, test, type Locator, type Page } from '@playwright/test';
import { seekBufferedRange, seekSliderInput } from './locators';

/**
 * A right-to-left ancestor mirrors a native range input's own thumb -- 0:00
 * lands at the right edge instead of the left -- while `seek-progress`,
 * `seek-buffered-range` and the thumbnail preview's pointer math all place
 * themselves with physical `left`/`width`, which `direction` never touches.
 * Left alone, that disagreement puts the visible thumb on one side of the
 * track and the fill it is supposed to match on the other. `SeekSlider`
 * pins its wrapper to `direction: ltr`, which the wrapper's inherited
 * `direction` carries down to the input and everything positioned around
 * it, so the whole bar reads as one direction regardless of the page's own.
 *
 * `midwayStory` (plain, no thumbnails) is used for the theme loop below;
 * `fixtureStory` (`WithBufferedAndThumbnails`,
 * `apps/storybook/stories/seek-slider.stories.tsx`) has a nonzero value, a
 * buffered range and a `thumbnails` cue all at once, for the geometry and
 * preview comparisons.
 */

const midwayStory = '/iframe.html?id=player-seekslider--midway&viewMode=story';
const fixtureStory =
  '/iframe.html?id=player-seekslider--with-buffered-and-thumbnails&viewMode=story';

const track = (page: Page): Locator =>
  page.locator('[data-playdeck-part="seek-slider"]');
const progress = (page: Page): Locator =>
  page.locator('[data-playdeck-part="seek-progress"]');
const thumbnail = (page: Page): Locator =>
  page.locator('[data-playdeck-part="thumbnail"]');

const setPageDir = (page: Page, dir: 'ltr' | 'rtl'): Promise<void> =>
  page.evaluate((value) => {
    document.documentElement.dir = value;
  }, dir);

// A part's position as a fraction of the track's own box, rather than raw
// viewport pixels: two reads of the same loaded page (only `dir` changes
// between them) share a track box that should not itself move, but reading
// relative to it is what makes the comparison mean something even if it did.
// Position only, not extent -- a part's width is set by `value`/`buffered`
// alone and neither the bug nor a wrong-direction implementation of `left`
// moves it, so a width assertion here could never fail either way.
const relativeLeft = (
  trackBox: { x: number; width: number },
  partBox: { x: number }
): number => (partBox.x - trackBox.x) / trackBox.width;

// Demonstrated red (docs/agents/demonstrated-red.md): with only the wrapper's
// `direction: 'ltr'` reverted (transport-controls.tsx), run against this test
// on chromium --
//
//   Error: expect(received).toBe(expected)
//   Expected: "ltr"
//   Received: "rtl"
//   1 failed › the seek bar's root pins direction: ltr, headless and under
//   both shipped themes › headless
//   1 failed › ... › theme.css
//   1 failed › ... › docked.css
//
// (the wrapper, the input and the fill all read `rtl` -- nothing in the tree
// declared a `direction` at all.) Reverted, and all three passed again.
for (const theme of [
  { name: 'headless', globals: '' },
  { name: 'theme.css', globals: '&globals=theme:themed' },
  { name: 'docked.css', globals: '&globals=theme:docked' }
]) {
  test(`the seek bar's root pins direction: ltr, headless and under both shipped themes › ${theme.name}`, async ({
    page
  }) => {
    await page.goto(`${midwayStory}${theme.globals}`);
    const input = page.getByRole('slider', { name: 'Seek', exact: true });
    await expect(input).toBeVisible();

    await setPageDir(page, 'rtl');
    await expect(track(page)).toHaveCSS('direction', 'ltr');
    await expect(input).toHaveCSS('direction', 'ltr');
  });
}

// Demonstrated red: with the same revert, run against this test (chromium) --
//
//   Error: expect(received).toBe(expected)
//   Expected: "2.5"
//   Received: "7.5"
//   1 failed › the input's click-to-value mapping is unaffected by page
//   direction
//
// (a click at 25% of the track's width lands on 2.5s under `dir="ltr"` and
// on the mirrored 7.5s under `dir="rtl"` -- the native input's own thumb
// mapping, reversed.) Reverted, and it passed again reading "2.5" both times.
test("the input's click-to-value mapping is unaffected by page direction", async ({
  page
}) => {
  await page.goto(fixtureStory);
  const input = seekSliderInput(page);
  await expect(input).toBeVisible();

  // 25% of the 0-10s window: 2.5s, already on the window's 0.5s step
  // (`min(1, span / 20)`), so the click lands on a value the input can keep
  // exactly rather than one a step grid would snap either way.
  const clickAndReadValue = async (): Promise<string> => {
    const box = (await input.boundingBox())!;
    await input.click({ position: { x: box.width * 0.25, y: box.height / 2 } });
    return input.inputValue();
  };

  const ltrValue = await clickAndReadValue();
  expect(ltrValue).toBe('2.5');

  await setPageDir(page, 'rtl');
  const rtlValue = await clickAndReadValue();
  expect(rtlValue).toBe(ltrValue);
});

// The fill and the buffered range are already positioned with physical
// `left`, which `direction` does not touch -- so this passes before the fix
// exists too, for the same reason `linear-gradient(to right, ...)` does.
// Demonstrated with a substitute mutation instead
// (docs/agents/demonstrated-red.md's fallback), against the fully unfixed
// baseline: the wrapper's `direction: 'ltr'` (transport-controls.tsx)
// reverted, AND `seek-progress`'s and `seek-buffered-range`'s `left` swapped
// for `insetInlineStart` (the logical equivalent a naive RTL-aware
// implementation might reach for -- resolved against the element's own
// `direction`, which nothing pins any more with the wrapper reverted too) --
// run on chromium, once per theme:
//
// docked.css --
//
//   Error: expect(received).toBeCloseTo(expected, precision)
//   Expected: 0
//   Received: 0.7000144675925926
//   1 failed › the progress fill and a buffered range keep their
//   left-to-right position under rtl and ltr › docked.css
//
// (the fill's own `left` fraction: under `dir="rtl"` its box flipped to
// start 70% across the track -- its right edge, not its left. The buffered
// range's own check was verified the same way, with the two assertions'
// order swapped so it ran and failed on its own: `Expected: 0, Received:
// 0.4000289351851852`, the range's box starting 40% in rather than at the
// track's own edge. Order restored.)
//
// theme.css --
//
//   Error: expect(received).toBeCloseTo(expected, precision)
//   Expected: 0
//   Received: 0.7000144675925926
//   1 failed › the progress fill and a buffered range keep their
//   left-to-right position under rtl and ltr › theme.css
//
// (the same figure as docked.css for the fill -- both stylesheets place
// `seek-progress` with `inset-block: 0` over a `seek-buffered` sized by
// `--playdeck-slider-thickness`, so the two themes' fill boxes agree. The
// buffered range's own check, order swapped the same way: `Expected: 0,
// Received: 0.4000289351851852`. Order restored.)
//
// Both mutations reverted (the wrapper fix and the `left` swap, both
// themes), and every case passed again. Applying only the `left` swap,
// with the wrapper's `direction: 'ltr'` left in place, produces no
// failure at all: `insetInlineStart` resolves against the element's own
// (inherited) `direction`, which the wrapper still pins to `ltr`, so this
// mutation only demonstrates the assertion against the pre-fix baseline.
for (const theme of [
  { name: 'theme.css', globals: 'theme:themed' },
  { name: 'docked.css', globals: 'theme:docked' }
]) {
  test(`the progress fill and a buffered range keep their left-to-right position under rtl and ltr › ${theme.name}`, async ({
    page
  }) => {
    // The theme toolbar global (the same mechanism `e2e/a11y.spec.ts`
    // reaches its docked pass through): the parts below have no size of
    // their own until a theme gives them one -- `WithBufferedRanges` in
    // seek-slider.stories.tsx notes the same thing -- so an unthemed read
    // would find them present but zero-height. `seek-progress` paints only
    // under `(forced-colors: none)` in both stylesheets (theme.css's own
    // comment above that rule explains why); Playwright's default context
    // does not emulate forced colors, so the rule applies here.
    await page.goto(`${fixtureStory}&globals=${theme.globals}`);
    const trackLocator = track(page);
    const fill = progress(page);
    const buffered = seekBufferedRange(page).first();
    await expect(fill).toBeVisible();
    await expect(buffered).toBeVisible();

    const read = async (): Promise<{ fill: number; buffered: number }> => {
      const trackBox = (await trackLocator.boundingBox())!;
      const fillBox = (await fill.boundingBox())!;
      const bufferedBox = (await buffered.boundingBox())!;
      return {
        fill: relativeLeft(trackBox, fillBox),
        buffered: relativeLeft(trackBox, bufferedBox)
      };
    };

    const ltr = await read();
    // currentTime 3 of a 0-10s window: the fill starts at the track's own
    // left edge, same as the buffered range (0-6 of that window).
    expect(ltr.fill).toBeCloseTo(0, 2);
    expect(ltr.buffered).toBeCloseTo(0, 2);

    await setPageDir(page, 'rtl');
    const rtl = await read();
    expect(rtl.fill).toBeCloseTo(ltr.fill, 2);
    expect(rtl.buffered).toBeCloseTo(ltr.buffered, 2);
  });
}

// The preview's pointer-to-time math is `clientX - rect.left`, physical DOM
// geometry that `direction` never enters -- so, like the test above, this
// passes before the fix exists too. Demonstrated with a substitute mutation
// instead: `trackPointer` in transport-controls.tsx changed from
// `(clientX - rect.left) / rect.width` to the mirrored
// `(rect.right - clientX) / rect.width`, WITHOUT the wrapper's
// `direction: 'ltr'` reverted -- run on chromium:
//
//   Error: expect(received).toBe(expected)
//   Expected: "-160px"
//   Received: "-480px"
//   1 failed › the thumbnail preview at a given pointer position previews
//   the same cue under rtl and ltr
//
// (hovering 30% across the track reads the mirrored 70%, 7s into the
// window -- `thumbnails.vtt`'s 6-8s cue, tile 3's crop at x=480 rather than
// tile 1's at x=160. The mutation is unconditional, so this failed on the
// very first read, under `dir="ltr"`.) Reverted, and it passed again reading
// "-160px" both times.
test('the thumbnail preview at a given pointer position previews the same cue under rtl and ltr', async ({
  page
}) => {
  await page.goto(fixtureStory);
  await expect(seekSliderInput(page)).toBeVisible();
  await expect
    .poll(() => thumbnail(page).getAttribute('data-state'))
    .toBe('hidden');

  const hoverFraction = async (fraction: number): Promise<void> => {
    const box = (await track(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  };

  // 30% of the 0-10s window: 3s, inside `thumbnails.vtt`'s 2-4s cue (tile 1,
  // x=160 in the sprite).
  await hoverFraction(0.3);
  await expect(thumbnail(page)).toHaveAttribute('data-state', 'visible');
  const ltrCrop = await thumbnail(page)
    .locator('img')
    .evaluate((img: HTMLImageElement) => img.style.left);
  expect(ltrCrop).toBe('-160px');

  await setPageDir(page, 'rtl');
  await page.mouse.move(0, 0);
  await hoverFraction(0.3);
  await expect(thumbnail(page)).toHaveAttribute('data-state', 'visible');
  const rtlCrop = await thumbnail(page)
    .locator('img')
    .evaluate((img: HTMLImageElement) => img.style.left);
  expect(rtlCrop).toBe(ltrCrop);
});
