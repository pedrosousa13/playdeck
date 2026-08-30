import { expect, test, type Page } from '@playwright/test';

/**
 * The landing page's provider comparison, which reports what
 * `docs/provider-setup.md` can and cannot say about each provider (#542).
 *
 * The claim the section makes is *asymmetry*: the five providers behind one API
 * are not interchangeable, and the table reports the difference rather than
 * flattening it. A hand-written table of four identical-looking columns would
 * look the same to a reader and to a screenshot, so what these tests pin is the
 * thing such a table could not do — disagree with itself, and give a reason
 * where a fact is unknowable.
 *
 * Located by the classes and the `data-state` the section already carries —
 * `data-state` is what selects each cell's colour — rather than through hooks
 * added for a test. Nothing here is a second description of the markup.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

// The four provider columns and the three questions, in the order the table
// prints them. Written out rather than read from `provider-asymmetry.mjs`: a
// list derived from the page's own source would agree with the page whatever
// either of them said. They are the document's own headings and its own
// grouping of the three providers it covers together.
const columns = ['YouTube', 'Vimeo', 'Wistia', 'Native files and HLS'];
const questions = [
  'Which hosts it answers to',
  'Which source forms it reads',
  'Which options are its own'
];

const states = ['available', 'unknown', 'unavailable'];

const table = (page: Page) => page.locator('.truth__table');
const cells = (page: Page) => table(page).locator('.truth__cell');
const row = (page: Page, index: number) =>
  table(page).locator('tbody tr').nth(index).locator('.truth__cell');

// Held at `fixme` while nothing rendered the component: every locator below
// would have resolved to nothing and the suite would have reported a page
// defect that was really a missing import. `/` mounts it now, as its provider
// comparison, and none of the assertions moved.
test('the table asks three questions of four providers', async ({ page }) => {
  await page.goto(landing);

  await expect(table(page).locator('.truth__provider-link')).toHaveText(
    columns
  );
  await expect(table(page).locator('.truth__question')).toHaveText(questions);
  await expect(cells(page)).toHaveCount(columns.length * questions.length);
});

test('every cell states its answer as a word, not as a colour', async ({
  page
}) => {
  await page.goto(landing);
  await expect(cells(page)).toHaveCount(columns.length * questions.length);

  // Colour carries domain meaning here, so the word has to carry it too: the
  // visible text of each cell's state is the same string as the attribute
  // that selects its colour. A reader who cannot tell the three colours apart
  // reads the same table.
  const answers = await cells(page).evaluateAll((elements) =>
    elements.map((element) => ({
      state: element.getAttribute('data-state'),
      word: element.querySelector('.truth__state')?.textContent?.trim() ?? '',
      count: element.querySelector('.truth__count')?.textContent?.trim() ?? '',
      items: element.querySelectorAll('.truth__items li').length,
      reason: element.querySelector('.truth__reason')?.textContent?.trim() ?? ''
    }))
  );

  for (const answer of answers) {
    expect(states).toContain(answer.state);
    expect(answer.word).toBe(answer.state);

    // The number a reader compares across a row is the length of the list
    // under it, not a figure of its own. A cell with nothing to list prints
    // no number rather than a zero.
    expect(answer.count).toBe(answer.items === 0 ? '' : String(answer.items));

    // `unknown` and `unavailable` are answers, and an answer without a reason
    // is indistinguishable from a page that never looked.
    if (answer.state !== 'available') expect(answer.reason).not.toBe('');
  }
});

test('the providers disagree about what can be known of them', async ({
  page
}) => {
  await page.goto(landing);
  await expect(cells(page)).toHaveCount(columns.length * questions.length);

  // The section's whole argument, and the assertion a table of four plausible
  // columns fails: asked the same question, the providers do not all give the
  // same kind of answer. Which providers differ, and on which question, is a
  // property of `docs/provider-setup.md` and is deliberately not pinned here
  // — that document is free to change, and the asymmetry is what must not
  // quietly stop being reported.
  const perQuestion = await Promise.all(
    questions.map((_, index) =>
      row(page, index).evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-state'))
      )
    )
  );

  const disagreeing = perQuestion.filter(
    (answers) => new Set(answers).size > 1
  );
  expect(disagreeing.length).toBeGreaterThan(0);

  // And at least one of those disagreements is the one the section exists to
  // make: `unknown` present somewhere on the table, as an answer with a
  // reason rather than as a blank.
  const unknown = table(page).locator('.truth__cell[data-state="unknown"]');
  await expect(unknown.first()).toBeVisible();
  await expect(unknown.first().locator('.truth__reason')).not.toBeEmpty();
});

test('a 320px viewport scrolls the table, never the page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(landing);
  await expect(cells(page)).toHaveCount(columns.length * questions.length);

  // The page does not go sideways. This is the whole reason the table is in a
  // container of its own rather than laid out to fit.
  const viewport = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.client);

  // And the container genuinely is the thing that scrolls, so the assertion
  // above is not being satisfied by a table that shrank to nothing.
  const region = page.locator('.truth__scroll');
  const overflow = await region.evaluate(
    (element) => element.scrollWidth - element.clientWidth
  );
  expect(overflow).toBeGreaterThan(0);

  // A scroll a pointer can reach and a keyboard cannot is not accessible, so
  // the container is focusable and carries a name. Focused directly rather
  // than tabbed to, because how many tab stops precede it is a property of
  // the rest of the page.
  await region.focus();
  await expect(region).toBeFocused();
  for (let press = 0; press < 8; press += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expect
    .poll(() => region.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
});
