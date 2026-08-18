import { expect, test } from '@playwright/test';

/**
 * #153: Storybook opens on the first leaf in the sidebar, and left to sort
 * itself that was `Overview/Capabilities matrix` — measured against the built
 * manager before the fix. Every per-part story is unstyled and inert by design,
 * so whichever one sorts first reads as a pile of broken buttons on first
 * contact. `.storybook/preview.tsx` pins the order so the landing is the
 * composed player instead.
 *
 * The shape is deliberately unlike every other spec here. The rest of `e2e/`
 * drives `/iframe.html?id=…` — the preview document, one story, no manager —
 * because they assert playdeck's behaviour and the manager is irrelevant to it.
 * This one asserts the opposite thing: what a visitor with no URL sees, which
 * only exists in the manager. Nothing else in the repo would catch the
 * regression, and it is a silent one: adding an MDX page that sorts above
 * `Reference example`, or dropping `parameters.options.storySort`, breaks the
 * landing with every other suite still green.
 *
 * Chromium only. This exercises Storybook's own sidebar sort, not playdeck, so
 * running it on three engines would buy no signal. Narrowed with the same
 * `test.skip(browserName !== 'chromium', …)` mechanism the engine-specific
 * specs use (`live.spec.ts`, `hls.spec.ts`, `poster.spec.ts`), rather than a
 * fourth Playwright project, so `--project=chromium` still runs it.
 */
test('opening the workbench with no URL parameters lands on the reference example', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName !== 'chromium',
    'Asserts Storybook manager sort order, which is engine-independent.'
  );

  // The two waits below declare 30s + 20s, which does not fit the 30s global
  // budget in `playwright.config.ts`. Both are there because `storybook dev`
  // compiles the manager index and then the MDX page on first request, so
  // raise the test budget past their sum plus the initial navigation.
  test.setTimeout(90_000);

  await page.goto('/');

  // The manager resolves its default selection into `?path=` once the index
  // has loaded, so poll the URL rather than racing an empty query string.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('path'), {
      timeout: 30_000
    })
    .toBe('/docs/overview-reference-example--docs');

  // And the page really rendered, rather than the sidebar merely pointing at
  // it. Matched by level rather than by accessible name: the docs renderer
  // prefixes every heading with an invisible "Copy heading URL to address bar"
  // anchor link, which lands inside the computed name. The preview document's
  // own `No Preview` h1 is `aria-hidden`, so it never enters this role query.
  //
  // `storybook dev` compiles the page on first request, so this render arrives
  // well after the sidebar selection does.
  await expect(
    page
      .frameLocator('#storybook-preview-iframe')
      .getByRole('heading', { level: 1 })
  ).toContainText('Reference example', { timeout: 20_000 });

  // The other half of #153: the Overview group sorts above `Player/*`.
  const ids = await page.evaluate(() => {
    const tree = document.querySelector('#storybook-explorer-tree');
    if (tree === null) throw new Error('no sidebar tree');
    return [...tree.querySelectorAll('[data-item-id]')].map((el) =>
      el.getAttribute('data-item-id')
    );
  });
  expect(
    ids.indexOf('overview'),
    `the sidebar must render an "overview" group; it listed [${ids.join(', ')}]`
  ).toBeGreaterThanOrEqual(0);
  expect(
    ids.indexOf('player'),
    `"overview" must sort above "player" in the sidebar; it listed [${ids.join(', ')}]`
  ).toBeGreaterThan(ids.indexOf('overview'));
});
