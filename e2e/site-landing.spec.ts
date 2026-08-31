import { expect, test, type Locator } from '@playwright/test';
import { activationButton } from './locators';

/**
 * The landing page at `/`, rebuilt for #542 phase 3: the player is the
 * protagonist, not an illustration of one. The previous shape (a pinned,
 * 300vh "assembly" chapter and a fixed scrub bar with a timecode) was
 * rejected three times over as too large and too hard to read; this is five
 * short sections in plain marketing language instead of six timed ones.
 *
 * What this file pins is the set of decisions the page cannot be allowed to
 * quietly lose: the spine and its order, the one heading a deploy check
 * identifies this site by, the absence of the workbench, the install line's
 * behaviour with and without a script, the sentence that discloses what
 * loads on scroll, the page not going sideways on a phone, the hero staying
 * dormant, and that every section is present and settled with no script and
 * under reduced motion.
 *
 * The look is deliberately not pinned. A landing page is meant to be
 * redesigned and a spec full of measurements would fail on every redesign
 * for reasons that are not defects, so what is asserted here is what the
 * page *says* and what it *does*, never how large or how far apart any of it
 * is. The exceptions are the 320px overflow check and the two degrade
 * checks, which are defects rather than taste, and the dormancy of the hero,
 * which is the page's central claim.
 *
 * `site-stance.spec.ts` covers the site-wide entry motion vocabulary and
 * `site-ledger.spec.ts` the hero's live report. Nothing here repeats either.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

/**
 * The spine, top to bottom, as the sections' own `data-section` attributes.
 * Written out rather than read from the page, because a list derived from the
 * page's source would agree with the page whatever either of them said.
 *
 * Five sections: the split hero, the differentiator in plain words, both
 * archetypes, the one-remote figures, and the credits.
 */
const sections = ['hero', 'truth', 'faces', 'remote', 'credits'];

test('the sections are present, in order', async ({ page }) => {
  await page.goto(landing);

  await expect
    .poll(() =>
      page
        .locator('main [data-section]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-section'))
        )
    )
    .toEqual(sections);
});

test('the h1 is exactly Playdeck, and nothing else answers to that name', async ({
  page
}) => {
  await page.goto(landing);

  // `scripts/check-deploy-artifact.mjs` identifies the site's root document in
  // a browser by a heading with this exact accessible name. Two of them would
  // make that identification ambiguous, which is why the header renders no
  // wordmark on `/` — so the count matters as much as the text.
  await expect(page.locator('h1')).toHaveText('Playdeck');
  await expect(
    page.getByRole('heading', { name: 'Playdeck', exact: true })
  ).toHaveCount(1);
});

test('nothing on the page links to the workbench', async ({ page }) => {
  await page.goto(landing);
  // #534 records the decision that the workbench is not to be a public
  // surface, and the maintainer ruled the same on a Storybook link. What that
  // costs this page is every link to it, from the page and from the header
  // above it, so this is asserted over the whole document rather than over
  // `main`.
  await expect(page.locator('a[href*="storybook" i]')).toHaveCount(0);

  expect(
    await page.evaluate(() => document.body.innerText.toLowerCase())
  ).not.toMatch(/storybook|workbench/);
});

test('the phrase "capability ledger" appears nowhere', async ({ page }) => {
  // The maintainer rejected it outright — asserted directly since the
  // temptation to reach for it sits right beside the panel it would
  // describe.
  await page.goto(landing);
  expect(
    await page.evaluate(() => document.body.innerText.toLowerCase())
  ).not.toContain('capability ledger');
});

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the install command is selectable text and the copy button is absent', async ({
    page
  }) => {
    await page.goto(landing);

    // The command was never behind the button: it is text in the document, so
    // a reader with no script selects and copies it exactly as before. Both
    // copies of it — the hero's and the credits' — say the same thing,
    // because the page renders one string twice.
    const commands = page.locator('[data-install-command]');
    await expect.poll(() => commands.count()).toBeGreaterThan(0);
    for (const text of await commands.allTextContents()) {
      expect(text.trim()).toBe('pnpm add @playdeck/react');
    }
    await expect(commands.first()).toBeVisible();

    // And there is nothing to press. Writing to the clipboard is the whole
    // of what the button does, so a control that swallowed a click would be
    // the "present and disabled" shape this site argues against.
    const buttons = page.locator('[data-install-copy]');
    await expect(buttons).toHaveCount(await commands.count());
    for (const button of await buttons.all()) {
      await expect(button).toBeHidden();
    }
  });

  test('every section is present, visible and settled', async ({ page }) => {
    /*
     * With JavaScript blocked, no observer is ever constructed anywhere on
     * this page, so nothing carries a from-state written by a script that
     * never ran. What is measured is computed style, not class names: an
     * element could carry every "hidden" class this page writes and still
     * compute to `opacity: 1` if the rule that reads the class needed a
     * script to apply, which is exactly the failure mode a class-name
     * assertion cannot catch.
     */
    await page.goto(landing);

    for (const id of sections) {
      const section = page.locator(`[data-section="${id}"]`);
      await expect(section).toBeVisible();
      const style = await section.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { opacity: computed.opacity, transform: computed.transform };
      });
      expect(Number(style.opacity)).toBe(1);
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(style.transform);
    }
  });
});

test('the copy button appears with a script, and its feedback is a text swap', async ({
  page,
  context,
  browserName
}) => {
  // Chromium gates `clipboard.writeText` behind a permission that a headless
  // context does not grant by default. Firefox has no such permission name and
  // rejects the grant, so it is only asked for where it exists.
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-write'], {
      origin: 'http://127.0.0.1:4322'
    });
  }
  await page.goto(landing);

  const copyButton = page.locator('[data-install-copy]').first();
  await expect(copyButton).toBeVisible();
  await expect(copyButton).toHaveText('Copy');

  await copyButton.click();

  await expect(copyButton).toHaveText('Copied');
  await expect(page.locator('[data-install-status]').first()).toContainText(
    'pnpm add @playdeck/react'
  );

  await expect(copyButton).toHaveText('Copy', { timeout: 5000 });
});

test.describe('under prefers-reduced-motion: reduce', () => {
  /*
   * `test.use({ reducedMotion })` does not work in this environment on
   * Playwright 1.61, so the query is emulated per test and its effect is
   * checked in-page first — `site-stance.spec.ts` has the worked example this
   * follows.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('every section is present, visible and settled', async ({ page }) => {
    await page.goto(landing);

    await expect
      .poll(() =>
        page.evaluate(
          () => matchMedia('(prefers-reduced-motion: reduce)').matches
        )
      )
      .toBe(true);

    for (const id of sections) {
      const section = page.locator(`[data-section="${id}"]`);
      await expect(section).toBeVisible();
      const style = await section.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { opacity: computed.opacity, transform: computed.transform };
      });
      expect(Number(style.opacity)).toBe(1);
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(style.transform);
    }
  });
});

test('the scroll-loading disclosure is visible copy', async ({ page }) => {
  await page.goto(landing);

  // A sceptic who opens devtools and finds requests the page never mentioned
  // has caught the site doing the exact thing it claims not to do. Both
  // archetypes are mounted on scroll, so the page says so, in the document,
  // visible, not in a comment.
  const disclosure = page.locator('.disclosure');
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('when you scroll to them');
  await expect(disclosure).toContainText('until you press it');
});

test('the page does not go sideways at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(landing);
  await expect(page.locator('main [data-section]')).toHaveCount(
    sections.length
  );

  // Scrolled to the foot first, so both archetypes have mounted and are
  // measured rather than skipped — the elements most likely to push the page
  // out, and neither exists until a reader reaches them.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.locator('[data-playdeck-part="viewport"]').count())
    .toBeGreaterThan(2);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      })
    )
    .toBeLessThanOrEqual(0);
});

test('the hero is dormant: no media request before the press', async ({
  page
}) => {
  const media: string[] = [];
  page.on('request', (request) => {
    if (/\.(mp4|webm|m3u8|ogv|mpd|ts)(\?|$)/.test(request.url())) {
      media.push(request.url());
    }
  });

  await page.goto(landing);
  // The island is `client:only`, so its arrival is what makes the emptiness of
  // the list below evidence rather than a listener attached before anything
  // could have happened.
  await expect(activationButton(page).first()).toBeVisible();
  await page.waitForLoadState('networkidle');

  // `loading="interaction"` holds the root dormant: no clip, no provider, no
  // request. This is the page's most falsifiable claim and the reason the hero
  // may not be given a poster or a preloading directive.
  expect(media).toEqual([]);

  await activationButton(page).first().click();

  // And the press is what fetches it, which is the other half of the same
  // claim — an empty list from a page that never loads anything would prove
  // nothing.
  await expect.poll(() => media.length).toBeGreaterThan(0);
});

test('pressing an archetype fetches from this origin and nowhere else', async ({
  page
}) => {
  /*
   * #542's acceptance criterion in the one state that can break it: every
   * root on this page is `loading="interaction"` and fetches nothing until
   * pressed, so the page is clean at rest by construction. What breaks it is
   * a press, so this presses one archetype and then holds the WHOLE page to
   * the criterion — every request the document has issued from navigation
   * onwards, by origin rather than by a deny-list of hosts anybody could grow
   * past.
   */
  const origin = new URL(landing).origin;
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(landing);

  /*
   * Both archetypes are `client:visible`, so their markup is in the document
   * from the server render and their JavaScript is not. Scrolled into view —
   * the directive's observer fires on intersection, and a single jump to the
   * foot of the page scrolls straight past without ever intersecting — and
   * hydration is then waited for. Astro drops the `ssr` attribute off an
   * island once it has hydrated it, which is the only signal for this on the
   * page.
   */
  const figure = page.locator('.archetype').first();
  await figure.scrollIntoViewIfNeeded();
  await expect.poll(() => figure.locator('astro-island[ssr]').count()).toBe(0);

  const start = figure.locator('[data-playdeck-part="activation"]');
  await expect(start.first()).toBeVisible();
  await start.first().click();

  await expect
    .poll(() => requests.filter((url) => /\.(mp4|ogv|ogg|m4v)(\?|$)/.test(url)))
    .not.toEqual([]);
  await page.waitForLoadState('networkidle');

  // `data:` and `blob:` are the page addressing itself and reach no host.
  // Everything else must be this origin: the clip, the captions fixture, the
  // island's own JavaScript, the fonts.
  const foreign = requests.filter(
    (url) =>
      !url.startsWith(`${origin}/`) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:')
  );
  expect(foreign).toEqual([]);
});

test('both archetypes describe the clip they actually play', async ({
  page
}) => {
  /*
   * The half of the criterion above that a request check cannot see: false
   * copy costs no request. The two film names are the specific claim,
   * `Blender` the general one, both checked against the whole of the faces
   * section's visible text rather than against the elements that happened to
   * carry them, the point is that the words are gone from the page.
   *
   * `/archetypes` names the films, correctly, and `site-archetypes.spec.ts`
   * leaves that alone. The only place they may not appear is here.
   */
  await page.goto(landing);

  const section = page.locator('[data-section="faces"]');
  await expect(section).toBeVisible();

  const spoken = (await section.innerText()).replace(/\s+/g, ' ');
  expect(spoken).not.toContain('Sintel');
  expect(spoken).not.toContain('Big Buck Bunny');
  expect(spoken).not.toContain('open movie, played here');

  // `Blender` survives in exactly one sentence, the licence paragraph, about
  // `/archetypes` rather than about this page, because the copies of these
  // files there do play that foundation's trailers, and CC BY asks for the
  // credit wherever the media is played.
  const licence = section.locator('.faces__licence');
  await expect(licence).toContainText('the archetypes page');
  await expect(licence).toContainText('CC BY 3.0');
  expect(spoken.split('Blender').length - 1).toBe(
    (await licence.innerText()).split('Blender').length - 1
  );

  // And the copy that replaced it says what is really behind the layout, on
  // both archetypes.
  await expect(section).toContainText('Test pattern');
  await expect(section).toContainText('colour-bar test pattern');
  await expect(section).toContainText('a fixture and not a film');
  await expect(section).toContainText('a fixture and not a lesson');
});

test('no archetype control is squashed into the theme activation circle', async ({
  page
}) => {
  /*
   * The defect this pins shipped once on the single-archetype page. `/` is
   * the first page in this site to mount `@playdeck/react/theme.css` — the
   * hero imports it — beside an archetype composition, and the theme sizes
   * the activation part `inline-size: 4rem; block-size: 4rem` with a 50%
   * radius unless something takes it back. `.stage` in `index.astro` does.
   *
   * What is pinned is SHAPE, not size: a labelled control is wider than it is
   * tall, which is false under the defect, in every engine, by construction —
   * 64x64 is square.
   */
  await page.goto(landing);

  const figures = page.locator('.archetype');
  await expect.poll(() => figures.count()).toBe(2);
  for (const figure of await figures.all()) {
    await figure.scrollIntoViewIfNeeded();
  }
  await expect.poll(() => page.locator('astro-island[ssr]').count()).toBe(0);

  const controls: Locator[] = await page
    .locator('.stage [data-playdeck-part="activation"]')
    .all();
  expect(controls.length).toBeGreaterThanOrEqual(2);

  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) continue;

    /*
     * That the control is labelled at all, which is the precondition the shape
     * assertions below only mean anything under. Read as an accessible name
     * rather than as text content: the two archetypes label this part in the
     * two different ways the library allows, and only one of them is text.
     * `archetype-course-platform.tsx` gives its full-bleed start affordance an
     * `aria-label` and draws a ring-and-triangle badge inside it, so it has a
     * name and no text at all — a `toBeEmpty` check here reads that as
     * unlabelled and fails on a control that is not the defect.
     */
    await expect(control).toHaveAccessibleName(/\S/);
    expect
      .soft(
        box.width,
        'a labelled activation control is no wider than it is tall'
      )
      .toBeGreaterThan(box.height);

    expect
      .soft(
        { w: Math.round(box.width), h: Math.round(box.height) },
        'an activation control is the theme 64x64 square'
      )
      .not.toEqual({ w: 64, h: 64 });
  }
});
