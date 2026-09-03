import { expect, test, type Page } from '@playwright/test';
import { activationButton, controls, media } from './locators';

/**
 * The bench on `/`: the switches, and the composition they build.
 *
 * This file replaced `site-ledger.spec.ts`, which pinned the five-row browser
 * panel `/` used to carry. The panel became a one-line report of what the
 * mounted provider refused, and that line is gone too: it named one capability
 * out of however many a provider actually refused, picked by the iteration
 * order of a lookup table a reader could not see, so which refusal appeared
 * read as arbitrary rather than as an answer. `ReasonLine.tsx` and
 * `bench-capabilities.ts` went with it, and the `data-bench-reason` /
 * `data-live` contract this file used to assert on is gone from the page.
 * `apps/site/DESIGN.md` records both cuts and what they leave the capability
 * argument as: nothing, on this page, having gone from a grid to a ledger to
 * one line to no line.
 *
 * What is left, and what this file pins, is the composition panel: a readout
 * that rewrites itself when a switch moves, which a static readout could never
 * do, and which is the one part of the original capability argument that
 * survived every cut.
 *
 * The contract is `data-bench-switch`, `data-value` and `data-bench-composition`,
 * named in #542's plan. The switches are native radios inside a label and
 * `data-value` is on the input, which is what a click lands on.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

const composition = (page: Page) => page.locator('[data-bench-composition]');
const position = (page: Page, group: 'source' | 'skin', value: string) =>
  page.locator(`[data-bench-switch="${group}"] [data-value="${value}"]`);

/** The library's two authored stylesheets, as a consumer would import them. */
const THEME_IMPORT = "import '@playdeck/react/theme.css';";
const DOCKED_IMPORT = "import '@playdeck/react/docked.css';";

/**
 * The composition from `<Player.Root` to the end, with the preamble cut off.
 *
 * Found by index rather than by slicing a fixed number of leading lines: the
 * preamble is a consumer's own lines above the composition -- the stylesheet
 * import, the `const source` line -- and how many there are is not this
 * helper's business. That is what lets the tree below read byte-identical
 * whichever provider is switched on, which is the property the source-switch
 * test below checks by comparing this before and after a press.
 */
const tree = (printedText: string) => {
  const open = printedText.indexOf('<Player.Root');
  if (open === -1) {
    throw new Error(
      `No <Player.Root> block in the composition:\n${printedText}`
    );
  }
  return printedText.slice(open);
};

const printed = (page: Page) => composition(page).innerText();

/** The `const source` line of the preamble, which is what a source press moves. */
const sourceLine = (printedText: string) => {
  const match = /^const source = '[^']*';$/m.exec(printedText);
  if (match === null) {
    throw new Error(`No source line in the composition:\n${printedText}`);
  }
  return match[0];
};

test('the composition is visible at rest', async ({ page }) => {
  await page.goto(landing);

  // The island is `client:only`, so the panel's arrival is what makes this a
  // fact about the page rather than about a document the island has not
  // reached yet.
  await expect(composition(page)).toBeVisible();
  await expect(activationButton(page)).toBeVisible();
});

test('the composition prints the full control tree, and tracks the source switch', async ({
  page
}) => {
  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  // The page rests on a skin that ships a stylesheet, so the import is printed
  // on arrival rather than after a press.
  const atRest = await printed(page);
  expect(atRest).toContain(THEME_IMPORT);

  // Content rather than a line count: the panel prints the whole bar the
  // island mounts, and both sides map over the one `BENCH_CONTROLS` tuple, so
  // what this pins is that every name in that tuple reaches the page.
  for (const name of [
    '<Player.SeekSlider />',
    '<Player.PlayButton />',
    '<Player.MuteButton />',
    '<Player.VolumeSlider />',
    '<Player.Time type="current" />',
    '<Player.Time type="duration" />',
    '<Player.CaptionsButton />',
    '<Player.SettingsMenu>',
    '<Player.PipButton />',
    '<Player.FullscreenButton />'
  ]) {
    expect(atRest).toContain(name);
  }

  // Document order, checked as a position comparison rather than as an index
  // into a hand-sliced array, so it does not depend on how many lines precede
  // the tree. The seek slider opens the bar in `BENCH_CONTROLS`, and the
  // printer and `BenchIsland` both map over that tuple, so the printed order
  // is the mounted order or one of them has drifted.
  expect(atRest.indexOf('<Player.SeekSlider />')).toBeLessThan(
    atRest.indexOf('<Player.PlayButton />')
  );

  // The source switch moves the line above the block, not a prop inside it:
  // the library detects a provider from the URL, so `source={source}` is the
  // whole of `Player.Root`'s configuration whichever position is pressed.
  // `vimeo` rather than `hls`: the switch offers hosted providers only now,
  // and selecting a position moves the printed line without pressing play, so
  // no network is needed here.
  const before = await printed(page);
  await position(page, 'source', 'vimeo').click();
  await expect
    .poll(async () => sourceLine(await printed(page)))
    .not.toBe(sourceLine(before));

  // And nothing inside the block moved with it. This is the assertion that
  // catches the page and the player disagreeing: byte-identical trees across a
  // provider change is the claim the panel is making.
  expect(tree(await printed(page))).toBe(tree(before));
});

test('the skin group offers theme and docked, in that order, and no third position', async ({
  page
}) => {
  await page.goto(landing);
  const skinButtons = page.locator('[data-bench-switch="skin"] [data-value]');
  await expect(skinButtons).toHaveCount(2);
  await expect(skinButtons.nth(0)).toHaveAttribute('data-value', 'theme');
  await expect(skinButtons.nth(1)).toHaveAttribute('data-value', 'docked');
});

test('the skin fieldset is hidden below 48rem', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(landing);
  // Waited on first, so hydration has actually happened before the next
  // assertion: the island is `client:only`, and a check for `toBeHidden` on
  // an element the DOM does not have yet at all would pass for the wrong
  // reason -- absent, not hidden by the rule under test.
  await expect(page.locator('[data-bench-switch="source"]')).toBeVisible();
  await expect(page.locator('[data-bench-switch="skin"]')).toBeHidden();
});

test('docked.css is a real <link>, in the document, when pressed, and theme.css is gone', async ({
  page
}) => {
  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  const stylesheetHrefs = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
        (link) => (link as HTMLLinkElement).href
      )
    );

  // At rest, above 48rem, the resting skin is `theme`.
  await expect
    .poll(async () =>
      (await stylesheetHrefs()).some((href) => href.includes('theme'))
    )
    .toBe(true);

  await position(page, 'skin', 'docked').click();

  // The switch is a swap, never a stack: `docked.css` arrives and `theme.css`
  // leaves in the same commit, so both are never on the document at once.
  await expect
    .poll(async () => {
      const hrefs = await stylesheetHrefs();
      return {
        docked: hrefs.some((href) => href.includes('docked')),
        theme: hrefs.some((href) => href.includes('theme'))
      };
    })
    .toEqual({ docked: true, theme: false });
});

/**
 * The composition's preamble, the lines above `<Player.Root`. Point 6 of the
 * spec depends on every combination printing exactly four: an import, a blank
 * line, the `const source` line, a blank line -- never zero, now that `none`
 * is gone and every remaining position ships a stylesheet.
 */
const preambleLines = (printedText: string) => {
  const lines = printedText.split('\n');
  const open = lines.findIndex((line) => line.startsWith('<Player.Root'));
  return lines.slice(0, open);
};

test('the preamble is always four lines, in every combination', async ({
  page
}) => {
  await page.goto(landing);
  for (const [skinToken, importLine] of [
    ['theme', THEME_IMPORT],
    ['docked', DOCKED_IMPORT]
  ] as const) {
    await position(page, 'skin', skinToken).click();
    for (const sourceToken of ['youtube', 'vimeo']) {
      await position(page, 'source', sourceToken).click();
      await expect
        .poll(async () => preambleLines(await printed(page)))
        .toHaveLength(4);
      const lines = preambleLines(await printed(page));
      expect(lines[0]).toBe(importLine);
      expect(lines[1]).toBe('');
      expect(lines[3]).toBe('');
    }
  }
});

/**
 * The maintainer's ruling on #594, pinned at rest and without `@real`: this is
 * the structural half of that ruling, not a replacement for the two
 * bounding-box tests below it. Those two prove the *rendered* result -- a
 * real player's pixels, measured after activation against a hosted provider
 * -- which is exactly why they need `@real` and sit outside the default run.
 * This test proves the *structure* the ruling is actually about: the
 * viewport's own CSS grid, readable with the player dormant, no activation,
 * no network beyond loading the page. Neither test is redundant with the
 * other -- this one is the pin CI actually runs on every PR; the other two
 * are the proof that the structure this one checks produces the layout the
 * ruling promises. Losing either leaves a gap: drop this one and the exact
 * regression #594 fixed (an unlayered rule quietly defeating `docked.css`)
 * goes unguarded in CI again; drop the `@real` pair and nothing ever checks
 * that the grid shape actually renders where the ruling says it should.
 *
 * The controls element exists in the DOM at rest in both skins and at both
 * widths below (the island renders it hidden/empty before activation), so its
 * own `grid-area` is readable without activation -- confirmed by measurement,
 * not assumed.
 */
const gridShape = (page: Page) =>
  page.evaluate(() => {
    const vp = document.querySelector('[data-playdeck-part="viewport"]');
    const ctrl = document.querySelector('[data-playdeck-part="controls"]');
    if (vp === null) {
      throw new Error('No viewport part in the document.');
    }
    return {
      areas: getComputedStyle(vp).gridTemplateAreas,
      controlsArea: ctrl === null ? null : getComputedStyle(ctrl).gridArea
    };
  });

test("at 1440px, the resting theme keeps controls in the picture's own row, and docked gives them one of their own", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(landing);
  // Waited on first, so hydration has actually happened before the next
  // assertion: the island is `client:only`, and a grid read taken before it
  // mounts would pass against the page's pre-hydration markup rather than
  // against `Bench.astro`'s rule.
  await expect(page.locator('[data-bench-switch="source"]')).toBeVisible();

  const themed = await gridShape(page);
  expect(themed.areas).toBe('"stack"');
  expect(themed.controlsArea).toBe('stack');

  await position(page, 'skin', 'docked').click();
  const docked = await gridShape(page);
  expect(docked.areas).toBe('"stack" "controls"');
  expect(docked.controlsArea).toBe('controls');
});

test('below 48rem, the resting docked viewport already gives the controls a row of their own', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(landing);
  await expect(page.locator('[data-bench-switch="source"]')).toBeVisible();
  // Below 48rem the skin fieldset is hidden and there is no switch to reach
  // `theme` from, so this is the shape a narrow reader actually rests on.
  await expect(page.locator('[data-bench-switch="skin"]')).toBeHidden();

  const docked = await gridShape(page);
  expect(docked.areas).toBe('"stack" "controls"');
  expect(docked.controlsArea).toBe('controls');
});

/**
 * The maintainer's own ruling on #594: the second theme has to differ in
 * *layout*, not only in colour, or two themes that only repaint the same box
 * read as a palette picker rather than as an argument that the markup is a
 * consumer's own. `docked` docks -- the bar takes a row of its own below the
 * picture -- and `theme` keeps floating over it exactly as before.
 *
 * `@real`: the bar is `hidden` until the activation press has produced a
 * real player (`ControlBar` in `BenchIsland.tsx` hides it under `!ready`), so
 * proving its position needs a real one, which for the two hosted-only
 * positions this switch offers means a real request to `youtube.com` or
 * `vimeo.com`. Excluded from the default run for the same reason every other
 * `@real` test here is.
 *
 * Measured against `[data-playdeck-part="media"]` rather than the outer
 * frame: the picture is the box either skin's own claim is about, and
 * `media`'s own box is what the non-stretching assertion below needs too.
 *
 * The comparison is only meaningful at a width where both skins are
 * reachable -- the skin fieldset is `hidden md:block`, so below 48rem
 * `theme` cannot be pressed at all. The narrow case below does not try: it
 * presses nothing and checks the position a narrow reader actually rests on,
 * which is `docked` with no switch to leave it from -- the case the ruling
 * itself names as the one most worth getting right.
 */
const activateAndMeasure = async (page: Page) => {
  await activationButton(page).click();
  await expect(controls(page)).toBeVisible({ timeout: 20_000 });
  const controlsBox = await controls(page).boundingBox();
  const mediaBox = await media(page).boundingBox();
  if (controlsBox === null || mediaBox === null) {
    throw new Error('Could not measure the bar or the picture.');
  }
  // Held on the bar before reading it: theme's own auto-hide must not catch
  // this read mid-fade.
  await page.mouse.move(
    controlsBox.x + controlsBox.width / 2,
    controlsBox.y + controlsBox.height / 2
  );
  return { controlsBox, mediaBox };
};

/** Every ready entry in `bench-sources.ts` is 2048x858, 2.3869:1. */
const expectNotStretched = (mediaBox: { width: number; height: number }) => {
  expect(mediaBox.width / mediaBox.height).toBeCloseTo(2048 / 858, 1);
};

test(
  'at 1440px, the themed bar overlays the picture and the docked bar sits below it @real',
  { tag: '@real' },
  async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(landing);
    await expect(activationButton(page)).toBeVisible();
    await position(page, 'skin', 'theme').click();
    const themed = await activateAndMeasure(page);
    // Over the picture: the bar's own box sits inside the picture's vertical
    // span rather than under it.
    expect(themed.controlsBox.y).toBeGreaterThanOrEqual(themed.mediaBox.y - 1);
    expect(
      themed.controlsBox.y + themed.controlsBox.height
    ).toBeLessThanOrEqual(themed.mediaBox.y + themed.mediaBox.height + 1);
    expectNotStretched(themed.mediaBox);

    await page.goto(landing);
    await expect(activationButton(page)).toBeVisible();
    await position(page, 'skin', 'docked').click();
    const docked = await activateAndMeasure(page);
    // Below the picture: the bar starts at or after the picture's own bottom
    // edge, never inside it -- the assertion this ruling exists to add.
    expect(docked.controlsBox.y).toBeGreaterThanOrEqual(
      docked.mediaBox.y + docked.mediaBox.height - 1
    );
    expectNotStretched(docked.mediaBox);
  }
);

test(
  'below 48rem, the resting docked bar sits below the picture, with no switch to change it @real',
  { tag: '@real' },
  async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(landing);
    await expect(activationButton(page)).toBeVisible();
    await expect(page.locator('[data-bench-switch="skin"]')).toBeHidden();

    const docked = await activateAndMeasure(page);
    expect(docked.controlsBox.y).toBeGreaterThanOrEqual(
      docked.mediaBox.y + docked.mediaBox.height - 1
    );
    expectNotStretched(docked.mediaBox);
  }
);
