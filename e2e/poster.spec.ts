import { expect, test, type Locator, type Page } from '@playwright/test';
import { playButton } from './locators';
import { cssBackgroundImageViolations } from './background-image-scan';
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { extname, join } from 'node:path';

type Rectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const rect = async (locator: Locator): Promise<Rectangle> =>
  locator.evaluate((element) => {
    const { height, width, x, y } = element.getBoundingClientRect();
    return { height, width, x, y };
  });

// Scoped to the fixture player: the docs page also mounts the YouTube example.
const viewport = (page: Page) => page.getByTestId('viewport');
const poster = (page: Page) =>
  viewport(page).locator('[data-reely-part="poster"]');
const posterImage = (page: Page) =>
  page.locator('[data-reely-part="poster-image"]');

// JS/JSX/TS/TSX are policed by the AST-based no-restricted-syntax rule in
// eslint.config.js instead: ESLint operates on nodes, and comments are not
// nodes, so a comment describing a background-image cannot trip that half.
// CSS has no AST tooling in this repo, so it keeps this comment-stripped text
// scan.
const visualSourceExtensions = new Set(['.css']);
const ignoredSourceDirectories = new Set([
  '.next',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'storybook-static',
  'test'
]);
const isIgnoredSourceEntry = (entry: Dirent): boolean =>
  entry.name.startsWith('.') ||
  entry.name.includes('.test.') ||
  entry.isSymbolicLink() ||
  (entry.isDirectory() && ignoredSourceDirectories.has(entry.name));
const visualSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (isIgnoredSourceEntry(entry)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return visualSourceFiles(path);
    return visualSourceExtensions.has(extname(entry.name)) ? [path] : [];
  });

const expectMatchingRectangles = async (page: Page) => {
  await expect(poster(page)).toHaveCount(1);
  await expect(viewport(page)).toHaveCount(1);
  await expect(await rect(poster(page))).toEqual(await rect(viewport(page)));
};

test('keeps poster and viewport geometry stable before and after native activation', async ({
  page
}) => {
  let releaseTracerRequest!: () => void;
  const tracerRequestHeld = new Promise<void>((resolve) => {
    releaseTracerRequest = resolve;
  });
  let recordHeldTracerRequest!: () => void;
  const heldTracerRequest = new Promise<void>((resolve) => {
    recordHeldTracerRequest = resolve;
  });
  await page.route('**/tracer.mp4', async (route) => {
    recordHeldTracerRequest();
    await tracerRequestHeld;
    await route.continue();
  });
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story',
    { waitUntil: 'domcontentloaded' }
  );
  await heldTracerRequest;

  const beforeActivation = await rect(viewport(page));
  await expectMatchingRectangles(page);
  await expect(poster(page)).toHaveAttribute('data-state', 'visible');
  await expect(poster(page)).toHaveCSS('visibility', 'visible');

  releaseTracerRequest();

  await expect(poster(page)).toHaveAttribute('data-state', 'hidden');
  await expect(poster(page)).toHaveCSS('visibility', 'hidden');
  await expectMatchingRectangles(page);
  expect(await rect(viewport(page))).toEqual(beforeActivation);
});

test('preserves the documented focal position through landscape and portrait layouts', async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );

  await expect(posterImage(page)).toHaveCSS('object-position', '30% 40%');
  await expectMatchingRectangles(page);

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(posterImage(page)).toHaveCSS('object-position', '30% 40%');
  await expectMatchingRectangles(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(posterImage(page)).toHaveCSS('object-position', '30% 40%');
  await expectMatchingRectangles(page);
});

test('keeps poster geometry and focal position in Chromium fullscreen', async ({
  page,
  browserName
}) => {
  test.skip(
    browserName !== 'chromium',
    'Task 3 fullscreen geometry coverage is Chromium-only.'
  );
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );

  await viewport(page).evaluate((element) => {
    element.addEventListener('click', () => void element.requestFullscreen(), {
      once: true
    });
  });
  await viewport(page).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null))
    .toBe(true);

  await expectMatchingRectangles(page);
  await expect(posterImage(page)).toHaveCSS('object-position', '30% 40%');

  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
});

test('hides the poster after the first frame without changing its geometry', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );
  const visibleGeometry = await rect(poster(page));

  await playButton(page).click();

  await expect(poster(page)).toHaveAttribute('data-state', 'hidden');
  await expect(poster(page)).toHaveCSS('visibility', 'hidden');
  expect(await rect(poster(page))).toEqual(visibleGeometry);
  await expectMatchingRectangles(page);
});

test('visual source files do not declare background images', () => {
  const violations = ['apps', 'packages']
    .flatMap(visualSourceFiles)
    .flatMap((file) =>
      cssBackgroundImageViolations(readFileSync(file, 'utf8'), file)
    );

  expect(violations, violations.join('\n')).toEqual([]);
});
