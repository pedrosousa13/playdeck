import { expect, test, type Page } from '@playwright/test';

/**
 * The site's `/examples` page: two composed players, and the files they are.
 *
 * What is worth an end-to-end test here is not how either layout looks — that
 * is what the Storybook stories assert, against dialed capabilities and with no
 * network in the way. It is the two claims the page makes that only a browser
 * can check.
 *
 * The first is that the running player and its real source are the same file.
 * The page reads `examples/*.tsx` off disk and prints it, and mounts the module
 * compiled from that same path as an island; if either half were a copy the two
 * could disagree, so the test takes a line out of the printed source and
 * asserts it is a line the mounted composition actually renders from.
 *
 * The second is that nothing is fetched before a press. Both compositions set
 * `loading="interaction"`, and a demo page that quietly pulled two clips off a
 * third party on load would have given that property away.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const examples = 'http://127.0.0.1:4322/examples/';

// The two sections, located the way a reader reaches them: by the heading each
// one is titled with. Both are `client:only` islands, so nothing under either
// exists in the document until React has mounted it — which is what makes the
// assertions below evidence that the island ran rather than that a template
// rendered.
const streaming = (page: Page) =>
  page.locator('section').filter({
    has: page.getByRole('heading', {
      level: 2,
      name: 'A streaming service',
      exact: true
    })
  });
const course = (page: Page) =>
  page.locator('section').filter({
    has: page.getByRole('heading', {
      level: 2,
      name: 'A course platform',
      exact: true
    })
  });

test('both archetypes mount, and each is the file printed beside it', async ({
  page
}) => {
  await page.goto(examples);

  // The streaming layout: its own title card, with the two ways in that the
  // composition draws only when a resume position was passed to it.
  await expect(
    streaming(page).getByRole('button', {
      name: 'Resume from 0:18',
      exact: true
    })
  ).toBeVisible();
  await expect(
    streaming(page).getByRole('button', {
      name: 'Play from the beginning',
      exact: true
    })
  ).toBeVisible();

  // The study layout, whose shape is the point of it being a second file: an
  // outline that navigates, notes beside the picture, and a resume banner in
  // flow rather than a card over the frame.
  await expect(
    course(page).getByRole('navigation', {
      name: 'Lesson outline',
      exact: true
    })
  ).toBeVisible();
  await expect(
    course(page).getByRole('heading', { name: 'Notes', exact: true })
  ).toBeVisible();
  await expect(
    course(page).getByRole('button', {
      name: 'Resume the lesson from 0:14',
      exact: true
    })
  ).toBeVisible();

  // Neither layout is the other. The streaming file has no outline and the
  // course file has no title card, which is the whole of what the pair claims.
  await expect(
    streaming(page).getByRole('navigation', {
      name: 'Lesson outline',
      exact: true
    })
  ).toHaveCount(0);
  await expect(
    course(page).getByRole('button', {
      name: 'Play from the beginning',
      exact: true
    })
  ).toHaveCount(0);

  // And the source really is the source. `<details>` hides its contents from
  // the accessibility tree while closed but leaves them in the DOM, so the text
  // can be read without opening it — the string below is a line of
  // `examples/archetype-course-platform.tsx` and of nothing else on the page.
  await expect(page.locator('.source__well').nth(1)).toContainText(
    'aria-label="Lesson outline"'
  );
});

test('no clip is fetched before a press', async ({ page }) => {
  const media: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('download.blender.org'))
      media.push(request.url());
  });

  await page.goto(examples);
  await expect(
    course(page).getByRole('navigation', {
      name: 'Lesson outline',
      exact: true
    })
  ).toBeVisible();

  // Both roots are dormant, so the page has asked the media host for nothing.
  // This is the property the page's own copy claims in as many words, and it is
  // the one claim on it that a reader cannot check by looking.
  expect(media).toEqual([]);
});

// `ActivationButton` writes `background-color` as an inline style reading
// `--playdeck-activation-fill` (`loading-error.tsx`), which beats a class
// selector's own `background-color` however it is written. Both examples set
// the fill twice for exactly that reason — once as the token, once as the
// property a bare consumer without the token would still read — and a class
// that only set the property would render each of these two buttons fully
// transparent: dark text unreadable on `stream-primary`'s dark card, and
// near-white text unreadable on `study-resume__button`'s light banner. Read
// back rather than asserted from the source, because the token is exactly the
// half a class-only fix would silently miss.
test('the resume affordances are not painted transparent', async ({
  page
}) => {
  await page.goto(examples);

  const streamResume = streaming(page).getByRole('button', {
    name: 'Resume from 0:18',
    exact: true
  });
  await expect(streamResume).toHaveCSS('background-color', 'rgb(236, 233, 245)');

  const studyResume = course(page).getByRole('button', {
    name: 'Resume the lesson from 0:14',
    exact: true
  });
  await expect(studyResume).toHaveCSS('background-color', 'rgb(31, 111, 99)');
});
