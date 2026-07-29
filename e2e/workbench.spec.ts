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
 * because they assert reely's behaviour and the manager is irrelevant to it.
 * This one asserts the opposite thing: what a visitor with no URL sees, which
 * only exists in the manager. Nothing else in the repo would catch the
 * regression, and it is a silent one: adding an MDX page that sorts above
 * `Reference example`, or dropping `parameters.options.storySort`, breaks the
 * landing with every other suite still green.
 *
 * Chromium only. This exercises Storybook's own sidebar sort, not reely, so
 * the three-engine matrix would buy no signal — the same reasoning the
 * `visual` project applies. Kept as a `test.skip` rather than a fourth
 * Playwright project so `--project=chromium` still runs it.
 */
test('opening the workbench with no URL parameters lands on the reference example', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName !== 'chromium',
    'Asserts Storybook manager sort order, which is engine-independent.'
  );

  await page.goto('/');

  // The manager resolves its default selection into `?path=` once the index
  // has loaded, so poll the URL rather than racing an empty query string.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('path'), {
      timeout: 30_000
    })
    .toBe('/docs/overview-reference-example--docs');

  await expect(page.locator('[data-selected="true"]')).toHaveAttribute(
    'data-item-id',
    'overview-reference-example--docs'
  );

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
  const ids = await page.$$eval(
    '#storybook-explorer-tree [data-item-id]',
    (els) => els.map((el) => el.getAttribute('data-item-id'))
  );
  expect(ids.indexOf('overview')).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf('player')).toBeGreaterThan(ids.indexOf('overview'));
});
