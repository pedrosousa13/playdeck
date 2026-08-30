import { expect, test, type Page } from '@playwright/test';
import { activationButton } from './locators';

/**
 * The landing page at `/`, rebuilt for #542.
 *
 * What this file pins is the set of decisions the page cannot be allowed to
 * quietly lose: the spine and its order, the one heading a deploy check
 * identifies this site by, the absence of the workbench, the install line's
 * behaviour with and without a script, the sentence that discloses what loads
 * on scroll, the page not going sideways on a phone, and the hero staying
 * dormant.
 *
 * The look is deliberately not pinned. A landing page is meant to be redesigned
 * and a spec full of measurements would fail on every redesign for reasons that
 * are not defects — so what is asserted here is what the page *says* and what
 * it *does*, never how large or how far apart any of it is. The two exceptions
 * are the 320px overflow check, which is a defect rather than a taste, and the
 * dormancy of the hero, which is the page's central claim.
 *
 * `site-stance.spec.ts` covers the entry motion, `site-ledger.spec.ts` the
 * hero's capability panel, `site-receipt.spec.ts` the request log and
 * `site-provider-truth.spec.ts` the provider comparison. Nothing here repeats
 * any of them.
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
 * Seven of these are the spine #542 settled. `receipt` is the eighth and is
 * placed deliberately: a receipt is what you read after a transaction, so it
 * follows the hero a reader may have pressed and the archetypes that just
 * disclosed what they fetched.
 */
const sections = [
  'hero',
  'weight',
  'archetypes',
  'receipt',
  'composition',
  'truth',
  'states',
  'start'
];

const copyButton = (page: Page) => page.locator('[data-install-copy]').first();

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

  // And neither word is written anywhere in the rendered document. Read out of
  // the page rather than through `getByText`, whose substring matching is what
  // this repository's own eslint rule forbids for locating anything — here the
  // question really is "does this string appear at all", which is a text
  // question rather than a locator one.
  expect(
    await page.evaluate(() => document.body.innerText.toLowerCase())
  ).not.toMatch(/storybook|workbench/);
});

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the install command is selectable text and the copy button is absent', async ({
    page
  }) => {
    await page.goto(landing);

    // The command was never behind the button: it is text in the document, so
    // a reader with no script selects and copies it exactly as before. Both
    // copies of it — the hero's and the closing section's — say the same
    // thing, because the page renders one string twice.
    const commands = page.locator('[data-install-command]');
    await expect.poll(() => commands.count()).toBeGreaterThan(0);
    for (const text of await commands.allTextContents()) {
      expect(text.trim()).toBe('pnpm add @playdeck/react');
    }
    await expect(commands.first()).toBeVisible();

    // And there is nothing to press — at either of the two install lines.
    // Writing to the clipboard is the whole of what the button does, so a
    // control that swallowed a click would be the "present and disabled" shape
    // this site argues against; the pattern `DocsSearch.astro` already uses.
    const buttons = page.locator('[data-install-copy]');
    await expect(buttons).toHaveCount(await commands.count());
    for (const button of await buttons.all()) {
      await expect(button).toBeHidden();
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

  await expect(copyButton(page)).toBeVisible();
  await expect(copyButton(page)).toHaveText('Copy');

  await copyButton(page).click();

  // A text swap, and not an icon that animates: `DESIGN.md` puts the site's
  // animation count at two and neither of them is this.
  await expect(copyButton(page)).toHaveText('Copied');
  // The same words said once where assistive technology will hear them — a
  // button whose own name changes under a reader who already pressed it is
  // announced by nothing.
  await expect(page.locator('[data-install-status]').first()).toContainText(
    'pnpm add @playdeck/react'
  );

  // And it settles back, so a reader who returns to the page later finds a
  // control that says what it will do rather than what it did.
  await expect(copyButton(page)).toHaveText('Copy', { timeout: 5000 });
});

test('the scroll-loading disclosure is visible copy', async ({ page }) => {
  await page.goto(landing);

  // A sceptic who opens devtools and finds requests the page never mentioned
  // has caught the site doing the exact thing it claims not to do. The two
  // archetypes are mounted on scroll, so the page says so — in the document,
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

  // Everything wider than a phone on this page — the budget table, the
  // provider comparison, the printed example — scrolls inside a box of its
  // own. Scrolled to the foot first, so the two archetypes have mounted and
  // are measured rather than skipped: they are the elements most likely to
  // push the page out, and they do not exist until a reader reaches them.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.locator('[data-playdeck-part="viewport"]').count())
    .toBeGreaterThan(1);

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
   * #542's acceptance criterion in the one state that can break it.
   *
   * The test above it, and the same-origin check that has always been here,
   * both measure a page at rest — and at rest this page was already clean,
   * because every root on it is `loading="interaction"` and fetches nothing
   * until it is pressed. That is exactly why a defect survived review: both
   * archetype examples ship pointed at a clip on `download.blender.org`, so the
   * page was one press away from issuing a cross-origin request, and the
   * receipt section directly underneath would have printed it. A page whose
   * own honesty instrument documents it breaking its own rule is worse than a
   * page that never made the claim.
   *
   * So this presses, and then holds the WHOLE page to the criterion: every
   * request the document has issued from navigation onwards, not just the media
   * one, and by origin rather than by a deny-list of hosts anybody could grow
   * past.
   */
  const origin = new URL(landing).origin;
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(landing);

  /*
   * The archetypes are `client:visible`, so the markup is in the document from
   * the server render and the JavaScript that makes it a player is not. The
   * distinction matters here and nowhere else in this file: an activation
   * button that is present but not yet hydrated answers a click by doing
   * nothing, and a press that did nothing would leave the request list empty
   * and this test green for the wrong reason.
   *
   * So the figure is scrolled into view — the directive's observer fires on
   * intersection, and a single jump to the foot of the page scrolls straight
   * past it without ever intersecting — and hydration is then waited for. Astro
   * drops the `ssr` attribute off an island when it has hydrated it, which is
   * the only signal for this on the page.
   */
  const figure = page.locator('.archetype').first();
  await figure.scrollIntoViewIfNeeded();
  await expect.poll(() => figure.locator('astro-island[ssr]').count()).toBe(0);

  const start = figure.locator('[data-playdeck-part="activation"]');
  await expect(start.first()).toBeVisible();
  await start.first().click();

  // Wait for the press to have actually cost a media request. Without this the
  // assertion below could pass on a page that had not yet asked for anything,
  // which would make the guard prove nothing — the same trap the dormancy test
  // above avoids by pressing after it asserts the empty list.
  await expect
    .poll(() => requests.filter((url) => /\.(mp4|ogv|ogg|m4v)(\?|$)/.test(url)))
    .not.toEqual([]);
  await page.waitForLoadState('networkidle');

  // `data:` and `blob:` are the page addressing itself and reach no host.
  // Everything else must be this origin: the clip, the captions fixture, the
  // island's own JavaScript, the fonts. #542 says every asset is served from
  // here, and after a press is the only moment at which that can be false.
  const foreign = requests.filter(
    (url) =>
      !url.startsWith(`${origin}/`) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:')
  );
  expect(foreign).toEqual([]);
});

test('the archetypes describe the clip they actually play', async ({
  page
}) => {
  /*
   * The other half of the criterion above, and the half that was broken by
   * fixing it. Pointing both archetypes at this origin's test pattern left
   * their copy behind: the title card still announced a film by name, both
   * credits still attributed a picture to the Blender Foundation, and the
   * lesson notes still said a Blender open movie was playing — over colour
   * bars, on the page whose whole argument is that it claims nothing it cannot
   * show. The request check could not see it, because false copy costs no
   * request.
   *
   * So this reads what a person reads. The two film names are the specific
   * claim, `Blender` the general one, and both are checked against the whole
   * of the archetypes section's visible text rather than against the elements
   * that happened to carry them — the point is that the words are gone from
   * the page, not that three particular nodes changed.
   *
   * `/archetypes` names all three, correctly, and `site-archetypes.spec.ts`
   * leaves that alone. The only place they may not appear is here.
   */
  await page.goto(landing);

  const section = page.locator('[data-section="archetypes"]');
  await expect(section).toBeVisible();

  const spoken = (await section.innerText()).replace(/\s+/g, ' ');
  expect(spoken).not.toContain('Sintel');
  expect(spoken).not.toContain('Big Buck Bunny');
  expect(spoken).not.toContain('open movie, played here');

  /*
   * `Blender` survives in exactly one sentence, and it has to: the copies of
   * these files on `/archetypes` do play that foundation's trailers, and CC BY
   * asks for the credit wherever the media is played. What the assertion pins
   * is that the sentence is about the other page rather than about this one —
   * the licence paragraph, and nothing inside either player.
   */
  const licence = section.locator('.archetypes__licence');
  await expect(licence).toContainText('the archetypes page');
  await expect(licence).toContainText('CC BY 3.0');
  expect(spoken.split('Blender').length - 1).toBe(
    (await licence.innerText()).split('Blender').length - 1
  );

  // And the copy that replaced it says what is really behind the two layouts.
  // Asserted as well as the absence above, so a future edit that deleted the
  // Blender copy without replacing it with anything true also fails here.
  await expect(section).toContainText('Test pattern');
  await expect(section).toContainText('colour-bar test pattern');
  await expect(section).toContainText('test pattern served from this origin');
});

test('no archetype control is squashed into the theme activation circle', async ({
  page
}) => {
  /*
   * The defect this pins shipped, and nothing caught it.
   *
   * `/` is the first page in this site to mount `@playdeck/react/theme.css`
   * — the hero imports it — and an archetype composition in the same
   * document. The theme sizes the activation part `inline-size: 4rem;
   * block-size: 4rem` with a 50% radius, neither archetype writes a size for
   * that part (on `/archetypes` there is no theme to win against), and so all
   * four activation controls on this page rendered as 64x64 circles: two
   * labelled pills with their text spilling out of them, a third in the
   * lesson's resume banner, and `.study-start` — a full-bleed press-anywhere
   * target — collapsed to a badge floating in the middle of the picture. The
   * unlayered rule on `.stage` in `index.astro` is what gives them their size
   * back. Whether the theme should size that part at all is a library question
   * and is tracked as #552; what this file asserts is a property of the page,
   * so it holds however that question is answered.
   *
   * Every other spec in this repo passed throughout, which is the finding. So
   * this measures geometry off the rendered boxes, because the bug was
   * geometry: a test that read the stylesheet back would have agreed with
   * whichever rule happened to be in it.
   *
   * What is pinned is SHAPE, not size. No width in pixels appears here: the
   * pills are as wide as their labels, so a font metric, a viewport or a
   * wording change moves those numbers and chromium and firefox do not agree
   * on them to begin with. What does not vary is that a labelled control is
   * wider than it is tall — every one of these is a word or a phrase on a
   * single line above a 2.75rem minimum height — and that a full-bleed
   * overlay covers its picture. Both are false under the defect, in every
   * engine, by construction: 64x64 is square, and 64x64 over a stage several
   * hundred pixels wide is not a full bleed.
   */
  await page.goto(landing);

  /*
   * Both figures, hydrated, before anything is measured.
   *
   * `client:visible` server-renders the island, so all four buttons are in the
   * document from the first byte and a measurement taken now would be of
   * markup React has not touched. Astro drops the `ssr` attribute off an
   * `astro-island` once it has hydrated it, and that is the only signal on the
   * page for this.
   *
   * Scrolled per figure rather than in one jump to the foot of the document:
   * the directive's IntersectionObserver needs to see an intersection, and a
   * single `scrollTo(0, scrollHeight)` travels past both figures between
   * frames without ever producing one.
   */
  const figures = page.locator('.archetype');
  await expect.poll(() => figures.count()).toBe(2);
  for (let i = 0; i < 2; i += 1) {
    await figures.nth(i).scrollIntoViewIfNeeded();
  }
  await expect.poll(() => page.locator('astro-island[ssr]').count()).toBe(0);

  const controls = page.locator('.stage [data-playdeck-part="activation"]');

  // Four: resume and from-the-beginning on the streaming title card, resume in
  // the lesson's banner, and the lesson's full-bleed start. Asserted so that a
  // composition that stopped rendering its buttons cannot make the loop below
  // vacuous.
  await expect.poll(() => controls.count()).toBe(4);

  for (const control of await controls.all()) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) continue;

    if ((await control.getAttribute('class'))?.includes('study-start')) {
      /*
       * The opposite shape, and it needs its own assertion: this control is
       * the whole picture, so "wider than tall" is true of it under the defect
       * as well once the box is square — it is not, but a 64x64 badge would
       * pass any test that only asked for a landscape box. What is checked is
       * that it still covers the viewport it is laid over. A fraction rather
       * than a size, so it holds at any width the page is read at.
       */
      const viewport = control.locator(
        'xpath=ancestor::*[@data-playdeck-part="viewport"][1]'
      );
      const frame = await viewport.boundingBox();
      expect(frame).not.toBeNull();
      if (frame === null) continue;
      expect
        .soft(
          box.width / frame.width,
          'the full-bleed start does not cover its picture'
        )
        .toBeGreaterThan(0.9);
      expect
        .soft(
          box.height / frame.height,
          'the full-bleed start does not cover its picture'
        )
        .toBeGreaterThan(0.9);
      continue;
    }

    /*
     * The other three carry a label on one line. Wider than tall is the
     * property the defect destroyed, and the only one of them that survives a
     * change of font, engine or viewport.
     */
    await expect(control).not.toBeEmpty();
    expect
      .soft(
        box.width,
        'a labelled activation control is no wider than it is tall'
      )
      .toBeGreaterThan(box.height);

    /*
     * And the defect's own value, named as itself, last. `4rem` at this site's
     * root font size is 64px, and it is the one absolute number in this test —
     * not a measurement of anything the page chose, but the size the theme
     * forces. It is redundant against the line above by construction, since a
     * square is not wider than it is tall; it is here so that the failure
     * report says WHICH square when both fire, and it is second so that the
     * durable invariant is the one a reader sees first.
     */
    expect
      .soft(
        { w: Math.round(box.width), h: Math.round(box.height) },
        'an activation control is the theme 64x64 square'
      )
      .not.toEqual({ w: 64, h: 64 });
  }
});
