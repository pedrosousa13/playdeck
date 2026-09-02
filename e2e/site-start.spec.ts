import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

/**
 * The quickstart at `/start` (#547), and the part of it a screenshot cannot
 * see.
 *
 * That page makes four claims about itself, and every one of them is the kind
 * that can be false while the page still looks right: that the command is the
 * package this workspace publishes, that the two code wells are files on disk
 * rather than examples written for the page, that the byte figures are
 * measurements of built artifacts, and that a reader following it top to bottom
 * is never sent to a route that does not exist. Each is checked here against the
 * repository rather than against the page's own source — a check that read the
 * numbers out of `bundle-budgets.mjs` the way the page does would agree with the
 * page whatever either of them said, so this file gzips the artifacts itself.
 *
 * The rest is the acceptance criteria a document page is held to: both themes,
 * no horizontal overflow at 320px, visible keyboard focus inside the document,
 * and no third-party request. `e2e/site-nav.spec.ts` checks the last three
 * across every route including this one; what is added here is the part those
 * cannot reach, which is focus inside the page's own content rather than in the
 * header strip every route shares.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const SITE = 'http://127.0.0.1:4322';
const start = `${SITE}/start/`;
const origin = new URL(SITE).origin;

/** A file in this repository, resolved from this spec rather than from a cwd. */
const repoFile = (path: string): string =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

const source = (path: string): string =>
  readFileSync(repoFile(path), 'utf8').trimEnd();

/**
 * A built artifact's gzipped size in kilobytes, to one decimal place, measured
 * here rather than imported from `scripts/bundle-budgets.mjs`.
 *
 * Measuring it again is the whole value of these assertions. The page reads that
 * module, so a spec that read it too would compare one call with another and
 * pass for a page that had stopped printing a measurement at all. What is
 * compared instead is the number on the page against the bytes on disk, through
 * a second implementation of the same one-line definition — gzip the file the
 * package publishes, divide by 1024.
 */
const KB = 1024;
const gzippedKilobytes = (path: string): string =>
  (gzipSync(readFileSync(repoFile(path))).length / KB).toFixed(1);

/** The rows of the adapter cost table, as printed. */
const costRows = (page: Page) => page.locator('.costs tbody tr');

/** What a 320px reader would have to scroll sideways to read. */
const overflow = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));

test('the install command names the package this workspace publishes', async ({
  page
}) => {
  // Read off the manifest npm reads, so a rename that reached the registry and
  // not this page fails here rather than sending a reader to `pnpm add` a name
  // that no longer resolves.
  const manifest = JSON.parse(source('packages/react/package.json'));

  await page.goto(start);
  await expect(page.locator('.command code')).toHaveText(
    `pnpm add ${manifest.name}`
  );

  // And every peer, by name, because the sentence beside the command claims
  // these are the whole of what a reader supplies.
  for (const peer of Object.keys(manifest.peerDependencies)) {
    await expect(
      page.locator('.note code').filter({ hasText: new RegExp(`^${peer} `) })
    ).toHaveCount(1);
  }
});

test('both code wells are the files in examples/, byte for byte', async ({
  page
}) => {
  // The page's central claim, and the one #547 is about: the composition is
  // rendered from `examples/react-composition.tsx` rather than restated. A
  // restatement is exactly what this catches — it would still highlight, still
  // compile in a reader's head, and still be a second copy nothing gates.
  await page.goto(start);

  const wells = page.locator('.well');
  const expected = [
    {
      path: 'examples/quickstart.tsx',
      text: source('examples/quickstart.tsx')
    },
    {
      path: 'examples/react-composition.tsx',
      text: source('examples/react-composition.tsx')
    }
  ];

  await expect(wells).toHaveCount(expected.length);
  for (const [index, { path, text }] of expected.entries()) {
    const well = wells.nth(index);
    // The caption names the file, so a reader can go and read the rest of it.
    await expect(well.locator('figcaption')).toHaveText(path);
    // `textContent` and not `innerText`: the second is what the layout renders
    // and is free to normalise, and what is being compared here is the bytes
    // Shiki was handed against the bytes on disk.
    const printed = await well.locator('pre').textContent();
    expect((printed ?? '').trimEnd(), path).toBe(text);
  }
});

test('every byte figure is the gzipped size of the artifact it names', async ({
  page
}) => {
  await page.goto(start);

  const rows = await costRows(page).all();
  expect(rows.length).toBeGreaterThan(0);

  for (const row of rows) {
    // The package name is what the row says the figure is about, so the
    // artifact is chosen by reading the page rather than by a list here: a row
    // for a provider added later is measured without this file being touched.
    const name = (await row.locator('code').innerText()).trim();
    const dir = name.replace(/^@playdeck\//, '');
    expect(dir, name).not.toBe(name);
    const printed = (await row.locator('.costs__size').innerText()).trim();
    expect(printed, name).toBe(
      `${gzippedKilobytes(`packages/${dir}/dist/index.js`)} kB`
    );
  }

  // And the primitives figure in the line under the table, which is the one a
  // reader pays whatever source they choose. Located through the table rather
  // than by position, so a note added to another section does not silently
  // become the one this reads.
  const note = page
    .locator('.step')
    .filter({ has: page.locator('.costs') })
    .locator('p.note');
  await expect(note).toContainText(
    `${gzippedKilobytes('packages/react/dist/index.js')} kB gzipped`
  );
});

test('every link on the page resolves to a real document', async ({ page }) => {
  // A quickstart is a page of onward links, so a dead one costs the reader the
  // whole point of it. Followed rather than listed: a 404 is invisible from the
  // page holding the link.
  await page.goto(start);
  const targets = await page
    .locator('main a')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href)
    );
  expect(targets.length).toBeGreaterThan(0);

  for (const href of new Set(targets)) {
    const response = await page.goto(href);
    expect(response?.status(), href).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), href).toBeVisible();
  }
});

test('the page fetches from nobody', async ({ page }) => {
  // `data:` and `blob:` are the page addressing itself and reach no host.
  // Everything else has to be this origin: the document, the fonts, and the
  // island the header mounts.
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  await page.goto(start, { waitUntil: 'networkidle' });

  expect(
    requested.filter(
      (url) =>
        !url.startsWith(`${origin}/`) &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
    )
  ).toEqual([]);
});

test('the page does not go sideways at 320px, in either theme', async ({
  page
}) => {
  // The code wells and the cost table are the two things on this page wider
  // than a phone by design, and both are inside their own scroll container for
  // that reason. Measured on the root element rather than on the body, because
  // the scrollbar a reader is left dragging belongs to the document.
  await page.setViewportSize({ width: 320, height: 640 });

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(start);
    const measured = await overflow(page);
    expect(measured.scrollWidth, colorScheme).toBeLessThanOrEqual(
      measured.clientWidth
    );
  }
});

/**
 * The two colours this page's own surfaces are painted from, read back after
 * the cascade has run rather than from the stylesheet that declares them: the
 * document ground, and the recessed well a code block and the install command
 * both sit in.
 */
const surfaces = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--color-sunken)';
    document.body.append(probe);
    const sunken = getComputedStyle(probe).backgroundColor;
    probe.remove();

    const command = document.querySelector('.command');
    const code = document.querySelector('.astro-code');
    return {
      // The root element and not the body: `base.css` paints the field there,
      // which is what `e2e/site-theme.spec.ts` reads too, and the body is
      // transparent over it.
      field: getComputedStyle(document.documentElement).backgroundColor,
      sunken,
      command:
        command === null ? null : getComputedStyle(command).backgroundColor,
      code: code === null ? null : getComputedStyle(code).backgroundColor
    };
  });

test('both themes paint the page from the role tokens', async ({ page }) => {
  // Not that a `data-theme` attribute is set — `e2e/site-theme.spec.ts` covers
  // the switch itself across the site. What is checked here is that this page's
  // own surfaces are role tokens rather than colours of their own, which is the
  // failure a page that authored its own well would have: it would look right in
  // one theme and be a foreign panel in the other.
  const painted: Awaited<ReturnType<typeof surfaces>>[] = [];
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(start);
    const measured = await surfaces(page);
    expect(measured.command, colorScheme).toBe(measured.sunken);
    expect(measured.code, colorScheme).toBe(measured.sunken);
    painted.push(measured);
  }

  // And the two themes are actually two: a page that painted the same ground in
  // both would satisfy every assertion above.
  expect(painted[0].field).not.toBe(painted[1].field);
  expect(painted[0].sunken).not.toBe(painted[1].sunken);
});

test('keyboard focus is visible inside the page, not only in the header', async ({
  page
}) => {
  // `e2e/site-nav.spec.ts` tabs six stops from the top of every route, which on
  // a page with a header this long never leaves the strip. The criterion is
  // focus visible on the page, so this one keeps pressing until focus is inside
  // `main` and checks the outline an engine actually painted there.
  //
  // Real Tab presses rather than `element.focus()`, for the reason that file
  // gives: `:focus-visible` is a judgement about how focus arrived, so a
  // programmatic focus would leave the reader this is about unchecked.
  await page.goto(start);

  let checked = 0;
  for (let stop = 0; stop < 40 && checked < 3; stop += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;
      if (element.closest('main') === null) return null;

      const probe = document.createElement('div');
      probe.style.color = 'var(--color-accent)';
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();

      const style = getComputedStyle(element);
      return {
        element: `${element.tagName.toLowerCase()}.${element.className}`,
        painted: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
        expected: `solid 2px ${accent}`
      };
    });
    if (focused === null) continue;
    expect(focused.painted, `stop ${stop}: ${focused.element}`).toBe(
      focused.expected
    );
    checked += 1;
  }

  // A run where focus never reached the document would otherwise pass without
  // having looked at anything.
  expect(checked).toBeGreaterThan(0);
});
