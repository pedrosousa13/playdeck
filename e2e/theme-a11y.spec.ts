import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { muteButton, volumeSlider } from './locators';

// #599: the third axe pass `e2e/a11y.spec.ts` names and does not run.
//
// That file's nine-state sweep runs against `Reference/Player`'s composition,
// headless and under `docked.css`, and its own comment on `themes` explains why
// a themed third pass THERE proves nothing: `reference-player.tsx` paints its
// own chrome unlayered (`.playdeck-example-controls`'s background, among
// others), and unlayered beats every `@layer playdeck` rule for every property
// it sets, whatever its specificity -- so a themed sweep of that composition
// would scan the same tree the headless pass already scanned, for the same
// answer. `Theme/Theme` (`apps/storybook/stories/theme.stories.tsx`) is the one
// composition with no unlayered CSS fighting `theme.css`, which is exactly why
// `e2e/theme.spec.ts` already reaches for it to assert the stylesheet's other
// media-query behaviour (reduced motion, forced colors).
//
// The maintainer's ruling (2026-09-26, issue #599) scopes this pass to the
// states `theme.css` itself adds, through that story, not a fourth nine-state
// sweep:
//   1. the control bar auto-hiding while playing (`data-idle='true'`), and
//      back once it returns -- `Playing` stages the real `playback: 'playing'`
//      state the auto-hide timer needs (`packages/react/src/viewport-media.tsx`,
//      `IDLE_DELAY_MS`); `e2e/theme-idle.spec.ts` already proves the timer and
//      the CSS timing, so this file only scans the two states it produces.
//   2. the volume slider's hover reveal and its focus reveal
//      (`@media (pointer: fine)` in `theme.css`).
//   3. the narrow-viewport fallback below `48rem` -- sizing changes to the
//      control bar and the volume slider dropping out entirely
//      (`display: none`), not a "flat surface": the maintainer reversed the
//      docking/flat-surface ruling on 2026-09-04, before this issue was even
//      filed, and `theme.css`'s own comment on that block says so. What is
//      left to scan there is what the block still does.
//
// `ThemedPlayer` (`.storybook/theme.tsx`'s render target) never mounts
// `Player.Media` or `Player.Poster` -- every story here is `loading:
// 'interaction'` with no activation press, so nothing paints behind the
// control bar but the flat `--playdeck-color-backdrop` theme.css itself
// declares. That is also the answer to the docked pass's own color-scheme
// question: `theme.css` declares no `prefers-color-scheme` query at all (grep
// finds none), and nothing else in this tree paints a background for it to
// disagree with the way the reference composition's unlayered chrome disagreed
// with `docked.css`'s light scheme. One scheme is therefore the whole of what
// there is to scan, unlike the docked pass.
const story = (id: string) =>
  `/iframe.html?id=theme-theme--${id}&viewMode=story&globals=a11y.manual:!true`;

const defaultStory = story('default');
const playingStory = story('playing');

const viewport = (page: Page) =>
  page.locator('[data-playdeck-part="viewport"]');

const controlsOpacity = async (page: Page): Promise<number> =>
  Number(
    await page
      .locator('[data-playdeck-part="controls"]')
      .evaluate((element) => globalThis.getComputedStyle(element).opacity)
  );

const idleAttribute = async (page: Page): Promise<string | null> =>
  viewport(page).getAttribute('data-idle');

const volumeSliderOpacity = async (page: Page): Promise<number> =>
  Number(
    await volumeSlider(page).evaluate(
      (element) => globalThis.getComputedStyle(element).opacity
    )
  );

// Same scope and the same un-narrowed default rule set as `e2e/a11y.spec.ts`'s
// own `scan` -- narrowing to WCAG tags would silently drop the best-practice
// rules, and `.include(...)` keeps page-level rules (this is a bare Storybook
// iframe, with no `<main>` or `<h1>` of its own) out of the claim.
//
// The `a11y.manual` pin guards the same axe-core collision `e2e/a11y.spec.ts`
// documents at length on its own `scan`: `@axe-core/playwright` and
// `@storybook/addon-a11y` can end up sharing one `window.axe`, and the pin
// proves the URL global that switches the addon's automatic scan off actually
// resolved, rather than assuming it did. See that file for the full account
// and the measurements behind it; the mechanism here is identical, so it is
// not repeated.
const scan = async (page: Page) => {
  const manual = await page.evaluate(
    () =>
      (
        window as unknown as {
          __STORYBOOK_PREVIEW__?: {
            storyStoreValue?: {
              userGlobals?: {
                get?: () => { a11y?: { manual?: unknown } } | undefined;
              };
            };
          };
        }
      ).__STORYBOOK_PREVIEW__?.storyStoreValue?.userGlobals?.get?.()?.a11y
        ?.manual
  );
  expect(
    manual,
    'globals=a11y.manual:!true must resolve to the boolean `true` in the ' +
      'preview, or the addon may still be running its own scan alongside ' +
      "this one -- see e2e/a11y.spec.ts's `scan` for the full reasoning"
  ).toBe(true);

  return await new AxeBuilder({ page })
    .include('[data-playdeck-part="viewport"]')
    .analyze();
};

// A diagnosed, tolerated finding on every state below where the control bar
// is visible -- `results.incomplete` is matched by equality against this,
// never a subset check, the same discipline `e2e/a11y.spec.ts`'s own
// `knownIncomplete` follows, so a new, undiagnosed rule id still fails.
//
// `color-contrast` (`messageKey: bgGradient`) is axe-core reporting that it
// cannot resolve a background painted by a CSS gradient -- the control bar's
// own `--playdeck-overlay-scrim` -- the same tool limitation #760 already
// documents for text over a rasterised video frame (`messageKey: imgNode`),
// just for a different kind of background axe has no rule to rasterise.
// `packages/react/test/theme.test.ts`'s `theme.css overlay-scrim text
// contrast (#599)` describe is the proof this relies on instead: both of the
// gradient's colour stops composite to the exact same colour as the backdrop
// behind this composition (`ThemedPlayer` mounts no `Player.Media` or
// `Player.Poster`), so the "needs review" here is one tool's blind spot on a
// background that is provably flat, and the current/duration `<time>` text
// over it clears 4.5:1 at 21.00:1 and 8.34:1.
//
// Absent (the idle-faded state) means clean: the bar is `opacity: 0` there,
// which is one of axe-core's own hidden methods (`opacityHidden`), so neither
// the bar nor this finding exists for axe to report.
//
// Demonstrated red (#599), against the idle-faded case specifically: with
// `theme.css`'s `[data-idle='true'] [data-playdeck-part='controls']` rule
// mutated from `opacity: 0` to `opacity: 1` (the fade itself deleted,
// `pointer-events: none` left in place), the idle-faded scan below picked up
// exactly the gradient finding this bucket describes, where a moment ago
// there was none:
//
//   Error: expect(received).toEqual(expected) // deep equality
//   - Expected  - 1
//   + Received  + 3
//   - Array []
//   + Array [
//   +   "color-contrast",
//   + ]
//   1 failed
//     [chromium] › e2e/theme-a11y.spec.ts › no accessibility violations in
//     the idle-faded control bar, and once it returns
//
// Reverted, green again. That is the pass genuinely reacting to the bar
// staying visible, not a fixed expectation that could not have failed.
//
// A second, separate mutation is what the tolerance above actually needs
// proving against, and axe cannot be the instrument for it: with
// `--playdeck-color-duration`'s default darkened from `rgb(255 255 255 /
// 0.64)` to `rgb(10 10 10 / 0.64)` -- an unreadable dimmed time against this
// backdrop -- this same test stayed green, because axe-core's `bgGradient`
// classification does not depend on the foreground colour at all; it never
// resolves the background either way. `packages/react/test/theme.test.ts`'s
// `theme.css overlay-scrim text contrast (#599)` describe is what caught
// that mutation instead (see its own demonstrated-red comment), which is the
// reason the tolerance above cites that describe rather than this file's own
// scan as its proof.
const knownIncomplete = ['color-contrast'];

test('no accessibility violations in the idle-faded control bar, and once it returns', async ({
  page
}) => {
  await page.goto(playingStory);
  await expect(viewport(page)).toBeVisible();

  // Moving the pointer first, as `theme-idle.spec.ts` does: this resets the
  // timer, so the fade below is measured from a bar that was genuinely
  // visible rather than one that never armed.
  await page.mouse.move(200, 200);
  await expect.poll(() => controlsOpacity(page), { timeout: 5000 }).toBe(1);
  await expect.poll(() => idleAttribute(page), { timeout: 8000 }).toBe('true');

  const idle = await scan(page);
  expect(idle.violations).toEqual([]);
  // Opacity 0 is one of axe-core's own hidden methods (`opacityHidden`,
  // axe.js's `hiddenMethods2`), so the faded bar and everything inside it is
  // invisible to axe the same way `display: none` would be -- not because
  // this file suppresses a finding, but because the rule engine itself treats
  // it as not rendered. That is also the accessibility answer, not just the
  // tooling one: the bar is genuinely gone from view and from hit-testing
  // (`pointer-events: none`, set with the fade rather than after it), and the
  // one way a keyboard or screen-reader user reaches a control inside it is
  // `:focus-within`, which un-fades the bar in the same tick focus lands --
  // never a focus landing on invisible content. Clean is therefore the
  // expected result, not a suppressed one.
  expect(idle.incomplete.map((entry) => entry.id)).toEqual([]);

  await page.mouse.move(210, 210);
  await expect.poll(() => controlsOpacity(page)).toBe(1);
  await expect.poll(() => idleAttribute(page)).toBe('false');

  const visible = await scan(page);
  expect(visible.violations).toEqual([]);
  expect(visible.incomplete.map((entry) => entry.id)).toEqual(knownIncomplete);
});

test("no accessibility violations in the volume slider's hover reveal", async ({
  page
}) => {
  await page.goto(defaultStory);
  await expect(viewport(page)).toBeVisible();

  // The mute button, not the slider itself: at rest the slider is
  // `pointer-events: none` (theme.css's own volume-reveal rule), so a real
  // pointer can no more land on it than Playwright's actionability check can
  // -- the reveal a real user triggers is hovering the adjacent mute button,
  // which the sibling-combinator rule keys the reveal on.
  await muteButton(page).hover();
  await expect.poll(() => volumeSliderOpacity(page)).toBe(1);

  const results = await scan(page);
  expect(results.violations).toEqual([]);
  expect(results.incomplete.map((entry) => entry.id)).toEqual(knownIncomplete);
});

test("no accessibility violations in the volume slider's focus reveal", async ({
  page
}) => {
  await page.goto(defaultStory);
  await expect(viewport(page)).toBeVisible();

  // Focusing the slider directly works where hovering it does not: CSS
  // `pointer-events: none` takes an element out of pointer hit-testing only,
  // never out of the focus order, so `.focus()` (and a real Tab) reach it
  // whether or not it is currently revealed.
  await volumeSlider(page).focus();
  await expect.poll(() => volumeSliderOpacity(page)).toBe(1);

  const results = await scan(page);
  expect(results.violations).toEqual([]);
  expect(results.incomplete.map((entry) => entry.id)).toEqual(knownIncomplete);
});

test('no accessibility violations in the narrow-viewport control bar (below 48rem)', async ({
  page
}) => {
  // 375, not the story's own fixed-pixel `viewportStyle` (640): `48rem` in
  // `theme.css` is a page-level media query keyed to the browser's own
  // viewport, not a container query on the player box, so it is the harness
  // window that has to be narrow.
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto(defaultStory);
  await expect(viewport(page)).toBeVisible();

  // The discriminator that the breakpoint actually engaged, the same
  // discipline `e2e/a11y.spec.ts`'s own `hairline` check follows: the volume
  // slider is the one part `theme.css` hides outright below `48rem`
  // (`display: none`), so its continued presence here would mean the query
  // never matched rather than that the state is clean.
  await expect(volumeSlider(page)).toBeHidden();

  const results = await scan(page);
  expect(results.violations).toEqual([]);
  expect(results.incomplete.map((entry) => entry.id)).toEqual(knownIncomplete);
});
