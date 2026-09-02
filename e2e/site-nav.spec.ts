import { expect, test, type Page } from '@playwright/test';

/**
 * The site navigation in the shared header (#542).
 *
 * The links to the site's own sections used to sit at the foot of `/` and
 * nowhere else, which is the one place a reader who has just finished a README
 * will not look. They are in `SiteHeader.astro` now, so they are on every page.
 *
 * What is pinned here is the part of that a screenshot cannot see: that every
 * destination exists on both kinds of page, that following one lands on a real
 * document rather than on a 404, that the section the reader is in is the only
 * one marked, and that a strip carrying those names as well as a trail, search
 * and a switch does not push a 320px page sideways.
 *
 * The tests over `routes` below read the site as one surface rather than as two
 * page shapes: that every route the site serves carries the strip and a way
 * back to the root, that none of them goes sideways at 320px, that keyboard
 * focus is visible on all of them, and that `/design` is served, shares the
 * shell, and is named by no navigation on any page — public and unlisted.
 *
 * The workbench is deliberately absent and asserted absent: #534 records the
 * decision that it is not to be a public surface, and it is the link most
 * likely to be added back by
 * someone who reads this header as a list of everything the repo builds.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so these addresses are written out rather
 * than navigated to as paths.
 */
const SITE = 'http://127.0.0.1:4322';

/**
 * The two builds `scripts/serve-site.mjs` mounts, and the reason the tests
 * below that assert an address run against both.
 *
 * Every path this site emits is built from `import.meta.env.BASE_URL`, and at
 * the apex — where `base` is `/` — a derived path and one written out by hand
 * are the same string, so a root-only assertion cannot tell them apart. The
 * second build is made with `--base /playdeck/` and is what makes the
 * difference observable (#435). `e2e/site-search.spec.ts` is where this pattern
 * is set out at length; the same reasoning applies to a header the site serves
 * on every page.
 */
const BASES = ['/', '/playdeck/'] as const;

/** The landing page, and a document page — the two page shapes the site has. */
const landing = `${SITE}/`;
const document_ = `${SITE}/reference/`;

/**
 * The destinations, in the order the header prints them, with the section each
 * one is the entrance to. Written out rather than read from the component: a
 * list derived from the header's own source would agree with the header
 * whatever either of them said.
 *
 * Held as a path relative to the base rather than as an address, so the
 * expected `href` is composed with whichever prefix the build under test was
 * made for instead of being a literal that only holds at the apex.
 */
const destinations = [
  { label: 'Guides', path: 'guides/' },
  { label: 'Reference', path: 'reference/' },
  { label: 'Providers', path: 'providers/' },
  { label: 'Archetypes', path: 'archetypes/' }
] as const;

/** The labels, in order, which is what the strip's links have to read. */
const labels = destinations.map(({ label }) => label);

/** The header's navigation landmark, by the name it announces itself with. */
const nav = (page: Page) =>
  page.getByRole('navigation', { name: 'Site', exact: true });

/** What a 320px reader would have to scroll sideways to read. */
const overflow = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));

for (const [where, url] of [
  ['/', landing],
  ['a document page', document_]
] as const) {
  test(`the navigation carries every destination on ${where}`, async ({
    page
  }) => {
    await page.goto(url);

    const links = nav(page).getByRole('link');
    await expect(links).toHaveText(labels);
    for (const { label, path } of destinations) {
      await expect(
        nav(page).getByRole('link', { name: label, exact: true })
      ).toHaveAttribute('href', `/${path}`);
    }
  });

  test(`the header on ${where} does not link to the workbench`, async ({
    page
  }) => {
    await page.goto(url);

    // Scoped to the header rather than to the page: whether `/` itself keeps a
    // link to the workbench is that page's decision and its own tests', and
    // `scripts/check-deploy-artifact.mjs` follows the one it has. What is
    // settled here is the strip that appears on every page — it names the
    // site's sections, and not the workbench, a surface #534 rules out as a
    // public one.
    const header = page.locator('header');
    await expect(header.locator('a[href*="storybook" i]')).toHaveCount(0);
    await expect(header.locator('a[href*="workbench" i]')).toHaveCount(0);
    // And by what the links say, not only by where they point: a link reading
    // "Workbench" that resolved through some other path is the same addition.
    await expect(
      header.locator('a').filter({ hasText: /storybook|workbench/i })
    ).toHaveCount(0);
  });

  test(`the header does not overflow 320px on ${where}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(url);

    await expect(nav(page)).toBeVisible();
    const measured = await overflow(page);
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth);
  });
}

test('every destination resolves to a real page', async ({ page }) => {
  // Followed rather than merely listed: a nav full of 404s is the failure that
  // matters most here, and it is invisible from the page holding the links.
  for (const { label, path } of destinations) {
    const href = `${SITE}/${path}`;
    const response = await page.goto(href);
    expect(response?.status(), `${label} → ${href}`).toBe(200);
    // A document, not an error page the server happened to answer 200 with.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // And the destination is reachable from the page it landed on, so the
    // navigation is present on the pages it points at as well.
    await expect(nav(page).getByRole('link')).toHaveCount(destinations.length);
  }
});

test('aria-current marks the section the reader is in, and only that one', async ({
  page
}) => {
  await page.goto(document_);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText([
    'Reference'
  ]);

  // A page inside the section, not only its index: the marker says which
  // section, so it holds a level down.
  await page.goto(`${SITE}/reference/core/`);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText([
    'Reference'
  ]);

  await page.goto(`${SITE}/providers/`);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText([
    'Providers'
  ]);

  await page.goto(`${SITE}/archetypes/`);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText([
    'Archetypes'
  ]);

  // `/` is in none of the sections the strip names, so nothing in it claims
  // to be the page the reader is on.
  await page.goto(landing);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveCount(0);
});

/**
 * Every route the site serves, in the shapes `DESIGN.md`'s stance table lists
 * them: the argument page, both section indexes, a page a level down inside
 * each of the two sections that have one, the archetypes, and the specimen
 * sheet. Written out rather than crawled, for the same reason `destinations`
 * above is: a list derived from the site would agree with the site whatever
 * either of them said.
 *
 * Relative to the base, like `destinations`, so the same list addresses either
 * build. The root is the empty string rather than `/`, so a route is always the
 * prefix followed by the route.
 */
const routes = [
  '',
  'start/',
  'guides/',
  'guides/contract/',
  'reference/',
  'reference/core/',
  'providers/',
  'providers/youtube/',
  'archetypes/',
  'design/'
];

for (const base of BASES) {
  const built = base === '/' ? 'the shipped build' : `the build at ${base}`;

  test(`every route reaches every section, and every route but / reaches /, in ${built}`, async ({
    page
  }) => {
    // The property a screenshot of any single page cannot show: a reader can get
    // from any part of the site to any other without going home first. The
    // header is the mechanism, so the check
    // is that the header is on every route rather than that the links exist
    // somewhere on each page — a link in the close of `/` would satisfy the
    // second and not the first.
    for (const route of routes) {
      const response = await page.goto(`${SITE}${base}${route}`);
      expect(response?.status(), route).toBe(200);

      await expect(nav(page).getByRole('link'), route).toHaveText(labels);
      for (const { label, path } of destinations) {
        await expect(
          nav(page).getByRole('link', { name: label, exact: true }),
          `${route} → ${label}`
        ).toHaveAttribute('href', `${base}${path}`);
      }

      // And back to the root, through the wordmark at the head of the trail.
      // The expected address is the prefix this build was made for rather than
      // `/`: `SiteHeader.astro` composes that href from
      // `import.meta.env.BASE_URL`, and an assertion that wrote the apex out
      // would pass a header that had stopped doing so. `/` is the exception and
      // renders no trail at all, because a page has nowhere to return to from
      // itself.
      const wordmark = page
        .getByRole('navigation', { name: 'Breadcrumb', exact: true })
        .getByRole('link', { name: 'Playdeck', exact: true });
      if (route === '') {
        await expect(wordmark, route).toHaveCount(0);
      } else {
        await expect(wordmark, route).toHaveAttribute('href', base);
      }
    }
  });
}

test('no route goes sideways at 320px', async ({ page }) => {
  // #540's criterion is the whole site at 320px and up, and the two tests
  // above sample the two page shapes the header is drawn on. `/design` is
  // neither of them: it is the widest thing the site serves, a specimen sheet
  // that sets one line of prose at `--text-4xl`, and a check that visited only
  // `/` and a reference page never looked at it. It did go sideways the first
  // time this loop ran, which is why `design.astro`'s `.specimen__sample` now
  // carries `overflow-wrap: anywhere` — the comment there has the mechanism.
  //
  // Measured on the root element rather than on the body, because a page can
  // overflow through an element the body does not contain the scroll of, and
  // the scrollbar a reader is left dragging belongs to the document.
  await page.setViewportSize({ width: 320, height: 640 });

  for (const route of routes) {
    await page.goto(`${SITE}/${route}`);
    const measured = await overflow(page);
    expect(measured.scrollWidth, route).toBeLessThanOrEqual(
      measured.clientWidth
    );
  }
});

/**
 * What an engine paints on the element keyboard focus has landed on, and what
 * `base.css` says it should be — both read from the page, so the comparison is
 * between two things the browser resolved rather than between a painted colour
 * and a hex written out here.
 */
const focusTreatment = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    // Tab can leave the document, which leaves the body focused. That is not an
    // element with a focus treatment, so there is nothing to compare.
    if (element === null || element === document.body) return null;

    const probe = window.document.createElement('div');
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

test('keyboard focus is visible on every route', async ({ page }) => {
  // `base.css` gives the whole site one focus treatment, a 2px `--color-accent`
  // outline on `:focus-visible`, and #540 asks for focus to be visible
  // throughout. What is asserted is the outline an engine painted rather than
  // that the rule exists, in the same spirit as `e2e/site-theme.spec.ts`
  // asserting the field's colour rather than the attribute that selects it: the
  // site now draws five of its controls with shadcn, whose own classes set
  // `outline-style: none` at the same specificity as that rule, and which of
  // the two wins is a question only a browser answers.
  //
  // Driven with real Tab presses rather than `element.focus()`, because
  // `:focus-visible` is a judgement about how focus arrived rather than about
  // which element has it. A programmatic `focus()` is a different arrival and
  // an engine is free to answer it differently, so it would leave the reader
  // this criterion is about — one moving through the page on the keyboard —
  // exactly as unchecked as asserting the rule's existence would.
  for (const route of routes) {
    await page.goto(`${SITE}/${route}`);

    let checked = 0;
    for (let stop = 0; stop < 6; stop += 1) {
      await page.keyboard.press('Tab');
      const focused = await focusTreatment(page);
      if (focused === null) continue;
      expect(
        focused.painted,
        `${route}, stop ${stop}: ${focused.element}`
      ).toBe(focused.expected);
      checked += 1;
    }

    // A route where focus never landed on anything would otherwise pass this
    // test without it having looked at a single element.
    expect(checked, route).toBeGreaterThan(0);
  }
});

test('/design is served and shares the shell, and the navigation does not name it', async ({
  page
}) => {
  // Public, and unlisted. Both halves are pinned,
  // because each fails in a way the other cannot catch — a sheet dropped from
  // the build is still absent from the navigation, and a sheet added to the
  // navigation is still served.
  const response = await page.goto(`${SITE}/design/`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'The visual system', exact: true })
  ).toBeVisible();

  // Unlisted is not walled off: the same header, so a reader who typed the
  // address is one press from the rest of the site.
  await expect(nav(page).getByRole('link')).toHaveText(labels);

  // Unlisted, from every page that carries the strip rather than only from
  // this one.
  for (const route of routes) {
    await page.goto(`${SITE}/${route}`);
    await expect(nav(page).locator('a[href*="design" i]'), route).toHaveCount(
      0
    );
    // And by what a link says, not only by where it points — the same pair of
    // checks the workbench absence gets above, for the same reason: a
    // destination reading "Visual system" that resolved through some other
    // path is the same addition.
    await expect(
      nav(page)
        .locator('a')
        .filter({ hasText: /design|visual system/i }),
      route
    ).toHaveCount(0);
  }
});

test("/'s heading is still exactly Playdeck, and there is one of it", async ({
  page
}) => {
  // `scripts/check-deploy-artifact.mjs` identifies the site's root document in
  // a browser by a heading named exactly `Playdeck`. A second element answering
  // to that role and name — a wordmark promoted to a heading in the header, say
  // — would make that identification ambiguous without failing anything else.
  await page.goto(landing);

  const wordmark = page.getByRole('heading', { name: 'Playdeck', exact: true });
  await expect(wordmark).toHaveCount(1);
  await expect(wordmark).toBeVisible();
  expect(await wordmark.evaluate((element) => element.tagName)).toBe('H1');
});

/*
 * The doc rail's disclosure, at both widths (#542 phase 3).
 *
 * The rail moved from a native `<details>` to a shadcn `Collapsible`
 * (`RailDisclosure.tsx`) and the swap has one silent failure mode, which was
 * observed on the way in rather than imagined: `forceMount` keeps the rail's
 * links in the DOM while closed, exactly as `<details>` did, but Radix then
 * writes only `data-state` and leaves the appearance to CSS. Miss the rule
 * that hides it and the control announces "collapsed" over a rail that is
 * fully on screen — a page that looks perfect in a screenshot and lies to
 * every reader who is not looking at one.
 *
 * So what is pinned is the agreement between the two: what the control says
 * about itself, and whether the thing it names is actually drawn.
 */
const railDocument = `${SITE}/reference/react/`;
const contents = (page: Page) =>
  page.getByRole('button', { name: 'Contents', exact: true });

test('the doc rail is a real closed disclosure on a narrow screen', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await page.goto(railDocument);

  await expect(contents(page)).toBeVisible();
  await expect(contents(page)).toHaveAttribute('aria-expanded', 'false');
  // Announced shut, and drawn shut.
  await expect(page.locator('.rail__inner')).toBeHidden();

  await contents(page).click();
  await expect(contents(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.rail__inner')).toBeVisible();
  // And the links inside it are reachable rather than merely present.
  await expect(
    page.locator('.rail__inner a[aria-current="page"]')
  ).toBeVisible();
});

test('the doc rail is a column, with nothing to toggle, on a wide screen', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(railDocument);

  // Revealed, and no control left over. A button that toggles nothing is not
  // something to hide from sight and leave in the tab order.
  await expect(page.locator('.rail__inner')).toBeVisible();
  await expect(contents(page)).toHaveCount(0);
});
