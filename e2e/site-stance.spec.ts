import { expect, test, type Locator } from '@playwright/test';

/**
 * The site's two page treatments, and the motion one of them was built to
 * gate.
 *
 * A marketing page and a reference document have different jobs, so
 * `Base.astro` takes a `stance`: `argument` for `/`, `document` for every other
 * route. The stance is written to the `<body>` as `data-stance`, and every
 * motion rule this site has ever written was keyed off it — so a document page
 * could not grow a scattered reveal by accident, and the stance rather than a
 * comment is what enforced that.
 *
 * ---- this file has moved subject twice, and now has none -------------------
 *
 * It first pinned the entry-motion vocabulary — `.u-enter`, the `data-enter`
 * from-state, and an IntersectionObserver — through the three `.truth-card`
 * columns on `/`. #542 deleted that comparison, and the vocabulary with it.
 * What replaced it as the page's one animated element was the bench's reason
 * line, arriving under `[data-bench-reason][data-live]` when a provider
 * refused something, and this file's motion tests targeted that instead.
 *
 * The reason line is gone too. It printed one capability out of however many
 * a provider actually refused, chosen by the iteration order of a lookup
 * table a reader had no way to see, so which refusal appeared read as
 * arbitrary — the maintainer's own assessment. Given the choice between
 * naming every refusal and naming one picked by object-key order, the
 * capability argument left `/` outright rather than keep doing the second.
 * `bench-refusal`, the keyframe this file used to poll for, is deleted from
 * `base.css` along with it.
 *
 * So `/` now authors no animation at all, and neither does any other route —
 * `DESIGN.md`'s animation section says this outright rather than counting
 * down from three to one to zero across three rounds of edits. The stance
 * itself is not deleted: `data-stance` still distinguishes `/` from a
 * document page, and `DESIGN.md` records, as a judgement rather than a fact,
 * that it currently drives no CSS rule and that a later reader should decide
 * whether it still earns its place. This file is what is left to pin: that
 * the attribute is still written correctly, on every page, in every reachable
 * state — which remains true and worth checking even with nothing keyed off
 * it today, because the day something is keyed off it again is the day this
 * file's coverage matters most and it should not need to be reinvented then.
 */
const landing = 'http://127.0.0.1:4322/';
const document_ = 'http://127.0.0.1:4322/reference/';

/**
 * What a reader actually sees, rather than what a class list says. `opacity`
 * and `transform` are the only two properties this system has ever moved, so
 * an element that is readable and settled is one whose opacity is 1 and whose
 * transform is the identity. Kept rather than deleted with the tests that used
 * to poll it for a from-state: with no animation left to reach, the assertions
 * below use it only to prove elements are settled, not mid-travel — a plainer
 * check, but one that still catches a future rule that forgets to gate itself
 * on the stance.
 */
const settled = async (locator: Locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const styles = getComputedStyle(element);
      return {
        opacity: styles.opacity,
        transform: ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(
          styles.transform
        )
          ? 'identity'
          : styles.transform
      };
    })
  );

test('/ is served in the argument stance', async ({ page }) => {
  await page.goto(landing);
  await expect(page.locator('body')).toHaveAttribute('data-stance', 'argument');
});

/**
 * Every route, against the stance `DESIGN.md` assigns it. Every page has to be
 * recognisably one of a named set rather than two sampled pages being — and a
 * route added later with a stance nobody thought about is exactly the drift
 * this exists against.
 *
 * The table is written out rather than read from the pages, so it is the
 * document's claim being checked and not the site agreeing with itself.
 */
const stances = [
  ['/', 'argument'],
  ['/reference/', 'document'],
  ['/reference/core/', 'document'],
  ['/providers/', 'document'],
  ['/providers/youtube/', 'document'],
  ['/archetypes/', 'document'],
  ['/design/', 'document']
] as const;

test('every route carries the stance DESIGN.md assigns it', async ({
  page
}) => {
  for (const [route, stance] of stances) {
    await page.goto(`http://127.0.0.1:4322${route}`);
    await expect(page.locator('body'), route).toHaveAttribute(
      'data-stance',
      stance
    );
  }
});

test('nothing on / is mid-travel, with or without JavaScript', async ({
  page
}) => {
  await page.goto(landing);
  expect(await settled(page.locator('main *'))).not.toContainEqual(
    expect.objectContaining({ opacity: '0' })
  );
});

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('/ keeps the stance and stays settled', async ({ page }) => {
    await page.goto(landing);

    // The stance is written by the template, so it survives a page with no
    // script at all.
    await expect(page.locator('body')).toHaveAttribute(
      'data-stance',
      'argument'
    );
    expect(await settled(page.locator('main *'))).not.toContainEqual(
      expect.objectContaining({ opacity: '0' })
    );
  });
});

test('a document-stance page carries the other attribute and stays settled', async ({
  page
}) => {
  await page.goto(document_);

  await expect(page.locator('body')).toHaveAttribute('data-stance', 'document');
  expect(await settled(page.locator('main *'))).not.toContainEqual(
    expect.objectContaining({ opacity: '0' })
  );
});
