import { expect, test, type Locator, type Page } from '@playwright/test';
import { activationButton } from './locators';

/**
 * The site's two page treatments, and the motion one of them permits.
 *
 * A marketing page and a reference document have different jobs, so
 * `Base.astro` takes a `stance`: `argument` for `/`, `document` for every other
 * route. The stance is written to the `<body>` as `data-stance`, and it is what
 * every motion rule in `base.css` is keyed off — so a document page cannot grow
 * scattered reveals by accident, and that is the property
 * `a document-stance page animates nothing` pins.
 *
 * ---- what changed, and why these tests moved subject ------------------------
 *
 * This file used to pin the entry-motion vocabulary — `.u-enter`, the
 * `data-enter` from-state, and an IntersectionObserver — through the three
 * `.truth-card` columns on `/`. #542 deleted that comparison, and with it the
 * last consumer of the vocabulary: nothing in `apps/site/src` writes `.u-enter`
 * or `data-enter` any more, and the observer that applied the from-state is
 * gone too. The CSS block for it is still in `base.css` and `DESIGN.md` still
 * describes it, but no page reaches either.
 *
 * So the three tests that targeted those columns were not given a new subject
 * on `/`. Inventing one would mean marking an element `.u-enter` so a test had
 * something to look at, which is a page bent to fit its spec. What `/` actually
 * animates now is one element: the bench's reason line, arriving when a
 * provider refuses something. That is the subject below, and the same three
 * facts are still pinned — that `/` carries the argument stance, that a
 * document route carries the other and animates nothing, and that the animated
 * element rests visible when its motion does not run.
 *
 * The two tests where the motion is suppressed are the ones a reviewer checks
 * first. Both measure the element rather than trusting the absence of a class:
 * a reader who asked for reduced motion, or whose script never arrived, reads
 * the page rather than a blank column.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so these addresses are written out rather
 * than navigated to as paths.
 */
const landing = 'http://127.0.0.1:4322/';
const document_ = 'http://127.0.0.1:4322/reference/';

/** The one animated element on `/`: the line a provider's refusal arrives in. */
const reason = (page: Page) => page.locator('[data-bench-reason]');

/**
 * What a reader actually sees, rather than what a class list says. `opacity`
 * and `transform` are the only two properties this system moves, so an element
 * that is readable and settled is one whose opacity is 1 and whose transform is
 * the identity. `animationName` comes with them because the reason line's
 * motion is a keyframe animation with `both`, which holds its from-state when
 * it is applied and never started.
 */
const settled = async (locator: Locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const styles = getComputedStyle(element);
      return {
        opacity: styles.opacity,
        // Reported as `none` where nothing has touched it and as the identity
        // matrix where a settled animation has, which is the same resting
        // state said two ways. Normalised so an assertion is about the state
        // rather than about which of the two an engine printed.
        transform: ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(
          styles.transform
        )
          ? 'identity'
          : styles.transform,
        animationName: styles.animationName
      };
    })
  );

/**
 * Produce the refusal, which is the only way to get an animated element onto
 * this page. `hls` is served from this origin and refuses something on both
 * engines this suite runs, and a provider answers nothing until the activation
 * press attaches it.
 */
const provokeRefusal = async (page: Page) => {
  await expect(page.locator('[data-bench-composition]')).toBeVisible();
  await page.locator('[data-bench-switch="source"] [data-value="hls"]').click();
  await activationButton(page).click();
  await expect(reason(page)).toHaveCount(1);
};

test('/ is served in the argument stance', async ({ page }) => {
  await page.goto(landing);
  await expect(page.locator('body')).toHaveAttribute('data-stance', 'argument');
});

test('the motion runs on /, and the stance is what buys it', async ({
  page
}) => {
  await page.goto(landing);
  await provokeRefusal(page);

  // The rule is unscoped CSS every page of this site carries, keyed off the
  // stance so that only `/` can reach it. Reading the animation's name off the
  // element is the evidence that it is applied at all rather than being a
  // keyframe nothing names — and polled to the resting state because it is a
  // real animation: measured directly after the press, the line is genuinely
  // caught part-way through, at opacity 0.46 and two pixels low.
  await expect
    .poll(() => settled(reason(page)))
    .toEqual([
      { opacity: '1', transform: 'identity', animationName: 'bench-refusal' }
    ]);
});

test.describe('under prefers-reduced-motion: reduce', () => {
  test('the animated element is present and readable, and nothing was started', async ({
    page
  }) => {
    // `page.emulateMedia` rather than the `reducedMotion` context option:
    // measured on Playwright 1.61, `test.use({ reducedMotion: 'reduce' })`
    // leaves `matchMedia('(prefers-reduced-motion: reduce)')` reporting false
    // in the page, which would make this test pass while proving nothing. This
    // call is checked below by asking the page the query itself.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(landing);
    expect(
      await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches
      )
    ).toBe(true);

    await provokeRefusal(page);

    // The animation is removed outright rather than left to the site-wide
    // duration collapse, because the collapse is a rescue for a transition
    // between two settled states and this is a keyframe animation with `both`:
    // left applied with a collapsed duration it would still hold a from-state.
    // The line's resting state is what the rest of the CSS gives it, so
    // removing the animation hides nothing — which is what this measures.
    expect(await settled(reason(page))).toEqual([
      { opacity: '1', transform: 'identity', animationName: 'none' }
    ]);
  });
});

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('/ keeps the stance and nothing on it is mid-travel', async ({
    page
  }) => {
    await page.goto(landing);

    // The stance is written by the template, so it survives a page with no
    // script at all. What it buys is unreachable here — the island never
    // mounts, so there is no refusal and no animated element — and the page
    // has to be the settled one rather than a column waiting for a script to
    // reveal it.
    await expect(page.locator('body')).toHaveAttribute(
      'data-stance',
      'argument'
    );
    await expect(reason(page)).toHaveCount(0);
    expect(await settled(page.locator('main *'))).not.toContainEqual(
      expect.objectContaining({ opacity: '0' })
    );
  });
});

test('a document-stance page animates nothing', async ({ page }) => {
  await page.goto(document_);

  await expect(page.locator('body')).toHaveAttribute('data-stance', 'document');
  // No animated element, and nothing on the page mid-travel: every motion rule
  // this site writes is keyed off the argument stance, so a document page could
  // not move even if the markup that triggers one were pasted onto it.
  await expect(reason(page)).toHaveCount(0);
  expect(await settled(page.locator('main *'))).not.toContainEqual(
    expect.objectContaining({ opacity: '0' })
  );
});
