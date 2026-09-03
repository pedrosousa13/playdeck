import { expect, test, type Page } from '@playwright/test';
import { activationButton, controls } from './locators';

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

/** The library's one opt-in stylesheet, as a consumer would import it. */
const THEME_IMPORT = "import '@playdeck/react/theme.css';";

/**
 * The lines of the JSX block, from `<Player.Root` to its close.
 *
 * The thesis paragraph says "the same six lines drive all five", so the count
 * is a number the page states in prose and the panel has to keep true. The
 * preamble above it — the theme import, the `const source` line — is not part
 * of it: those are lines a consumer writes above the composition, which is
 * exactly what lets the block below read identically whichever provider is
 * switched on.
 */
const jsxBlock = (printed: string) => {
  const lines = printed.split('\n');
  const open = lines.findIndex((line) => line.startsWith('<Player.Root'));
  const close = lines.findIndex((line) => line.startsWith('</Player.Root>'));
  if (open === -1 || close <= open) {
    throw new Error(`No <Player.Root> block in the composition:\n${printed}`);
  }
  return lines.slice(open, close + 1);
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

test('the seek slider composes first, so the control bar keeps its two-row split', async ({
  page
}) => {
  // `theme.css`'s control-surface rule wraps the composed children into two
  // rows only because the seek slider is the first of them: its 100% basis is
  // the first thing `flex-wrap` has to place, so it takes row one and
  // everything after it falls to row two. A consumer who reorders the
  // children loses the split -- which is exactly what happened here (#593):
  // the bar rendered as three rows because the seek slider composed third.
  await page.goto(landing);
  await expect(page.locator('[data-bench-switch="source"]')).toBeVisible();

  await activationButton(page).click();
  await expect(controls(page)).toBeVisible();

  const firstChildPart = await controls(page).evaluate((element) =>
    element.firstElementChild?.getAttribute('data-playdeck-part')
  );
  expect(firstChildPart).toBe('seek-slider');
});

test('the composition tracks both switches', async ({ page }) => {
  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  // The page rests on `theme`, so the import is printed on arrival. That is a
  // deliberate reversal: `none` is the honest position but an unstyled player
  // is what a reader meets before pressing anything, and it reads as a broken
  // embed rather than as an argument.
  const atRest = await printed(page);
  expect(atRest).toContain(THEME_IMPORT);
  expect(jsxBlock(atRest)).toHaveLength(6);

  // The customisability argument, made by moving a real import rather than by
  // describing one: `none` takes the one stylesheet the library publishes back
  // out of the document as well as out of the printed composition.
  await position(page, 'skin', 'none').click();
  await expect(composition(page)).not.toContainText(THEME_IMPORT);

  await position(page, 'skin', 'theme').click();
  await expect(composition(page)).toContainText(THEME_IMPORT);

  // And the source moves the line above the block rather than a prop inside
  // it. The library detects a provider from the URL, so `source={source}` is
  // the whole of `Player.Root`'s configuration whichever position is pressed —
  // which is the claim the six-line count below is a check on. `vimeo` rather
  // than `hls`: the switch offers hosted providers only now, and selecting a
  // position moves the printed line without pressing play, so no network is
  // needed here.
  const before = await printed(page);
  await position(page, 'source', 'vimeo').click();
  await expect
    .poll(async () => sourceLine(await printed(page)))
    .not.toBe(sourceLine(before));

  const after = await printed(page);
  expect(jsxBlock(after)).toEqual(jsxBlock(before));
  expect(jsxBlock(after)).toHaveLength(6);

  // Six lines in every combination the two switches reach, not just the two
  // above. Nothing either of them does may grow the block.
  await position(page, 'skin', 'theme').click();
  await expect(composition(page)).toContainText(THEME_IMPORT);
  expect(jsxBlock(await printed(page))).toHaveLength(6);
});
