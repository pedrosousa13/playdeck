import { expect, test, type Page } from '@playwright/test';
import { activationButton } from './locators';

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
