import { expect, test, type Page } from '@playwright/test';
import { activationButton } from './locators';

/**
 * `/`'s central claim, which is the one thing on that page a screenshot cannot
 * check: nothing is fetched from anybody before a reader asks for it, and the
 * line under the player never says otherwise once one has been.
 *
 * The page states it in words — "No video has loaded yet. No provider has been
 * contacted." — directly under the thing that would falsify it. A sentence
 * printed beside the machinery it describes is worth exactly what the gate
 * behind it is worth, and this file is that gate.
 *
 * Four tests now. The second is what makes the first mean anything: an empty
 * list of foreign requests is also what a listener attached to the wrong page
 * produces, so the at-rest assertion is paired with one that presses a hosted
 * provider and demands the request happen. `youtube` and `vimeo` are
 * `ready: true` in `bench-sources.ts`, and pressing one is a real request to
 * a real host, so that test is `@real`.
 *
 * The third is a defect that nearly shipped rather than a property the page
 * was designed for. `bench-quiet.ts` and `apps/site/test/bench-quiet.test.ts`
 * carry it in full; what they cannot carry is the browser, because they drive
 * a pure function and the failure was a sequence of presses against a mounted
 * player. This is that sequence -- and unlike while the switch was
 * hosted-providers-only, it needs no `@real` tag to run: `hls` is
 * same-origin and first in `bench-sources.ts`, so the press that reproduces
 * the sequence is a request to this site's own origin, and the second press
 * only switches the source selection without activating it (see the test's
 * own comment for why that is enough).
 *
 * The fourth pins the reason `hls` is worth having beside the two hosted
 * positions at all: a press on it fetches a real manifest and real segments,
 * and every one of those requests stays on this origin. No `@real` tag either
 * -- that is the whole point of the position existing.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';
const origin = new URL(landing).origin;

const composition = (page: Page) => page.locator('[data-bench-composition]');
const quietLine = (page: Page) => page.locator('.bench__quiet');
const sourcePositions = (page: Page) =>
  page.locator('[data-bench-switch="source"] [data-value]');

/**
 * `data:` and `blob:` are the page addressing itself and reach no host.
 * Everything else has to be this origin: the document, the island's own
 * JavaScript, the fonts, the poster and the clip.
 */
const foreign = (urls: readonly string[]) =>
  urls.filter(
    (url) =>
      !url.startsWith(`${origin}/`) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:')
  );

/**
 * Whether a line claims no provider has been contacted yet.
 *
 * Matched as a claim rather than as a sentence. The words are `bench-quiet.ts`'s
 * and are meant to be editable; what may never come back is the *assertion*,
 * after something has loaded. A copy edit that keeps the meaning keeps this
 * test passing, and one that reintroduces the meaning fails it whatever the
 * wording. The claim is about a provider rather than about loading in
 * general, because `Bench.astro` renders a poster before any press: an image
 * has loaded and a request for it has left the page even at rest, so neither
 * of those would be a true thing for this line to assert.
 */
const claimsNoProviderContacted = (line: string) =>
  /no provider[^.]*contacted/i.test(line);

/** The URL the composition panel prints for the position selected right now. */
const printedSource = async (page: Page) => {
  const printed = await composition(page).innerText();
  const match = /const source = '([^']*)';/.exec(printed);
  if (match === null) {
    throw new Error(`No source line in the composition:\n${printed}`);
  }
  return match[1];
};

/**
 * The source positions that reach somebody else's host, discovered by pressing
 * each one and reading the URL the panel prints for it.
 *
 * Derived rather than listed, because the list is `apps/site/src/bench-sources.ts`'s
 * and the whole point of the test below is that it wakes up on its own when
 * that file changes. Read through the page because the panel prints
 * `entry.source(base)` verbatim, so this is the module's own answer with the
 * base path already resolved — which is the form the comparison needs.
 */
const hostedPositions = async (page: Page) => {
  const hosted: { token: string; host: string }[] = [];
  for (const position of await sourcePositions(page).all()) {
    const token = await position.getAttribute('data-value');
    if (token === null) continue;
    await position.click();
    const url = new URL(await printedSource(page), landing);
    if (url.origin !== origin) hosted.push({ token, host: url.host });
  }
  return hosted;
};

test('at rest, / has contacted nobody', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(landing);

  // The island is `client:only`, so its arrival is what makes the emptiness
  // below evidence rather than a listener attached before anything could have
  // happened. Both halves of it: the player, which is portaled into the frame,
  // and the readout, which renders where the island sits.
  await expect(activationButton(page)).toBeVisible();
  await expect(composition(page)).toBeVisible();
  await page.waitForLoadState('networkidle');

  // The listener saw the navigation itself, so an empty foreign list is a fact
  // about the page rather than about the recorder.
  expect(requests).toContain(landing);
  expect(foreign(requests)).toEqual([]);

  // And the page says so, which is the claim a reader is actually given.
  expect(claimsNoProviderContacted(await quietLine(page).innerText())).toBe(
    true
  );
});

test(
  'pressing a hosted provider does contact it @real',
  { tag: '@real' },
  async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(landing);
    await expect(composition(page)).toBeVisible();

    const hosted = await hostedPositions(page);
    // Defensive rather than load-bearing: `youtube` and `vimeo` are both
    // `ready: true` in `bench-sources.ts`, so this list is never empty today
    // -- `hls` never joins it, same-origin as it is, but the other two do.
    // Left in for the shape it protects against -- a page that quietly lost
    // every hosted position would fail this test loudly rather than by
    // skipping it.
    test.skip(
      hosted.length === 0,
      'No position in apps/site/src/bench-sources.ts is `ready: true`, so the source switch offers no position that leaves this origin.'
    );

    const { token, host } = hosted[0];
    await page
      .locator(`[data-bench-switch="source"] [data-value="${token}"]`)
      .click();
    await activationButton(page).click();

    // The other half of the at-rest claim. `DESIGN.md` permits this page to
    // contact a third party once a reader has asked, and never before, so what
    // is asserted here is that asking works — a page that fetched nothing from
    // anybody would pass the test above by doing nothing at all.
    await expect
      .poll(() => requests.filter((url) => new URL(url).host === host))
      .not.toEqual([]);
  }
);

test('the quiet line never claims no provider has been contacted once one has', async ({
  page
}) => {
  /*
   * Two presses, no timing trick.
   *
   * Under `loading="interaction"` a source change returns `Player.Root` to
   * `dormant`, so the first version of this line — which read the live
   * activation state — printed the resting sentence again after a fetch had
   * already gone out. The second clause of that sentence is a claim about
   * the page's history, and history does not revert.
   *
   * The first press is on the switch's resting position, `hls`, which is
   * same-origin — so this waits on the quiet line's own text rather than on
   * a foreign request the way the equivalent wait did while every position
   * left this origin; there is no foreign request for that wait to catch any
   * more. The second press only selects `vimeo` on the source switch without
   * pressing play again — `BenchSwitches`' `onSource` callback writes the new
   * position and nothing else, and `Player.Root` only fetches from an
   * activation press — so the sequence still reproduces the exact defect this
   * test is named for (a source change resetting activation to `dormant`
   * while the line keeps claiming what that reset would otherwise undo)
   * without a second real request, hosted or otherwise.
   */
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(landing);
  await expect(activationButton(page)).toBeVisible();

  const line = quietLine(page);
  expect(claimsNoProviderContacted(await line.innerText())).toBe(true);

  await activationButton(page).click();
  await expect
    .poll(async () => claimsNoProviderContacted(await line.innerText()))
    .toBe(false);
  // And it really was same-origin, not just quiet about it.
  expect(foreign(requests)).toEqual([]);

  // The press that used to undo the sentence.
  await page
    .locator('[data-bench-switch="source"] [data-value="vimeo"]')
    .click();

  // Replaced, never removed: a line that vanished would move everything below
  // it, and would also pass an assertion about what it does not say.
  await expect(line).toHaveCount(1);
  expect(claimsNoProviderContacted(await line.innerText())).toBe(false);
});

test('pressing play on the hls position fetches a manifest from this origin and nothing else', async ({
  page
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  // Explicit rather than relied on as the resting default, so this test keeps
  // proving what its name says even if the switch's default position ever
  // moves: `bench-sources.ts` lists `hls` first today, and `readySources[0]`
  // is what `BenchIsland.tsx` reads for the page's own default, but nothing
  // here should depend on remembering that.
  await page.locator('[data-bench-switch="source"] [data-value="hls"]').click();
  await activationButton(page).click();

  await expect
    .poll(() => requests.some((url) => url.includes('.m3u8')))
    .toBe(true);
  expect(foreign(requests)).toEqual([]);
});
