#!/usr/bin/env node
// Proves both Pages surfaces work under the project-page prefix, against the
// built artifact rather than against the configuration that produced it (#519).
//
// The bug this exists to catch is #435: a root-absolute URL emitted by a build
// that was told nothing about the prefix. `pedrosousa13.github.io/tracer.mp4`
// is a different site's root, so the only symptom is a 404 at request time —
// which is why neither a unit test over `astro.config.ts` nor a grep of the
// emitted HTML would do. Storybook resolves most of its own navigation in the
// browser, so a static reading of the artifact cannot see the half that breaks.
//
// So the artifact is assembled the way the deploy assembles it, served the way
// GitHub Pages serves it — reachable under `/playdeck/` and nowhere else — and
// visited by a real browser, with every response, console error and page error
// recorded for the whole visit. Every failure is reported, not the first, so
// one run tells the reader everything that is wrong.
//
// Deliberately not wired into any pull-request gate: that is #528. It builds
// both surfaces by default, because a run against whatever happens to be on
// disk proves nothing about the tree under test; `--no-build` is for a local
// re-run against an artifact this script already assembled.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { assemblePages } from './assemble-pages.mjs';

// As in scripts/verify-packaging.mjs: the lint config gives this directory node
// globals, but `console` and `process` still have to be reached through
// globalThis.
const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Any prefix but `/` would do, and `/` would do nothing: the whole class of bug
// only exists where the site is not served from the domain root. This is what
// the deploy uses, so the artifact under test is the artifact that ships.
const basePath = '/playdeck/';
const artifactDir = join(repoRoot, 'pages-dist');

// The story the Storybook visit navigates to. It renders against the mock
// player, so nothing here depends on media loading — what is being proven is
// that the workbench's own navigation resolves under the prefix, not that a
// provider works.
const story = {
  component: 'player-playbutton',
  id: 'player-playbutton--paused',
  part: 'play-button'
};

/** @type {Record<string, string>} */
const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

/**
 * Serves the assembled artifact under `basePath` and nothing at the root, which
 * is what a Pages project site does. The 404 is load-bearing rather than
 * incidental: a server that fell back to the artifact root for an unprefixed
 * URL would answer exactly the requests this check exists to catch.
 *
 * @param {string} directory
 */
const serveArtifact = async (directory) => {
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    const notFound = () => {
      response.writeHead(404);
      response.end();
    };

    if (!pathname.startsWith(basePath)) {
      notFound();
      return;
    }

    const relative = pathname.slice(basePath.length);
    try {
      const target = join(directory, relative);
      // A directory request is what an internal link to `storybook/` produces,
      // and Pages answers one with the index inside it.
      const entry = await stat(target).catch(() => null);
      const file = entry?.isDirectory() ? join(target, 'index.html') : target;
      const body = await readFile(file);
      response.writeHead(200, {
        'content-type': mimeTypes[extname(file)] ?? 'application/octet-stream'
      });
      response.end(body);
    } catch {
      notFound();
    }
  });

  // The (port, host, listener) overload, for the reason
  // scripts/verify-packaging.mjs gives: a `resolve` passed straight through
  // takes an argument, and matches the (port, backlog, listener) one instead.
  await new Promise((ready) =>
    server.listen(0, '127.0.0.1', () => ready(undefined))
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not resolve the artifact server address.');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((closed, failed) =>
        server.close((error) => (error ? failed(error) : closed(undefined)))
      )
  };
};

// Two things the workbench does to itself, tolerated because both were observed
// on a build served from the domain root — the arrangement where no base path
// exists to get wrong — and so say nothing about the prefix under test.
//
// Storybook navigates the preview iframe while its previous navigation is still
// in flight, which the browser reports as an aborted request rather than as a
// status. And its manager logs this diagnostic when a channel event arrives
// from a window it cannot match; it names an internal event and no URL at all.
// Anything else, from either half, is a failure.
const abortedRequest = 'net::ERR_ABORTED';
const managerChannelDiagnostic =
  /^%c manager %c received .* but was unable to determine the source of the event/;

/**
 * Records everything a visit is allowed to fail on, for as long as the page
 * lives. Attached before the first navigation so a failure during load counts,
 * and read at the end so one run reports every failure rather than the first.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} failures
 * @param {string} surface
 */
const recordFailures = (page, failures, surface) => {
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      failures.push(`${surface}: ${status} for ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'no reason given';
    if (reason === abortedRequest) return;
    failures.push(
      `${surface}: request failed for ${request.url()} (${reason})`
    );
  });
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() !== 'error') return;
    if (managerChannelDiagnostic.test(text)) return;
    failures.push(`${surface}: console error — ${text}`);
  });
  page.on('pageerror', (error) => {
    failures.push(`${surface}: uncaught ${error.message}`);
  });
};

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {string} origin
 * @param {string[]} failures
 */
const checkSite = async (browser, origin, failures) => {
  const page = await browser.newPage();
  recordFailures(page, failures, 'site');
  await page.goto(`${origin}${basePath}`);
  await page.getByRole('heading', { name: 'Playdeck', exact: true }).waitFor();

  // Every internal link, rather than the one the placeholder page happens to
  // carry today: a link added by #520 or #521 is exactly the kind that gets
  // written root-absolute, and this check should already cover it.
  const links = await page
    .locator('a[href]')
    .evaluateAll((anchors) =>
      anchors
        .map((anchor) => /** @type {HTMLAnchorElement} */ (anchor).href)
        .filter((href) => href.startsWith('http'))
    );
  if (links.length === 0) {
    failures.push('site: the page carries no internal link to follow.');
  }
  for (const link of links) {
    // A response event already reports the status, so what is left to
    // establish is that a document arrived rather than an error page.
    await page.goto(link);
    const title = await page.title();
    if (title === '') {
      failures.push(`site: ${link} rendered no document title.`);
    }
  }
  await page.close();
};

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {string} origin
 * @param {string[]} failures
 */
const checkStorybook = async (browser, origin, failures) => {
  const page = await browser.newPage();
  recordFailures(page, failures, 'storybook');
  await page.goto(`${origin}${basePath}storybook/`);

  // The sidebar rendering is the signal that the workbench booted: `load`
  // fires as soon as the shell's HTML is in, which a build whose scripts all
  // 404 also manages.
  await page.locator('#storybook-explorer-tree').waitFor({ timeout: 60_000 });

  // Its own navigation, driven the way a reader drives it. A story reached by
  // typing its URL would prove the artifact holds the story; only a click
  // proves the sidebar's links resolve under the prefix.
  await page.locator(`[data-item-id="${story.component}"]`).click();
  await page.locator(`[data-item-id="${story.id}"]`).click();

  const preview = page.frameLocator('#storybook-preview-iframe');
  await preview
    .locator(`[data-playdeck-part="${story.part}"]`)
    .waitFor({ timeout: 60_000 });

  await page.close();
};

const shouldBuild = !process.argv.includes('--no-build');
if (shouldBuild) {
  for (const [filter, prefix] of [
    ['@playdeck/site', basePath],
    ['@playdeck/storybook', `${basePath}storybook/`]
  ]) {
    console.log(`--- Building ${filter} for ${prefix} ---`);
    execFileSync('pnpm', ['--filter', filter, 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, PLAYDECK_BASE_PATH: prefix }
    });
  }
  // The deploy's own layout, imported rather than restated: two copies would
  // drift, and a harness that went green against a shape the deploy no longer
  // produces is worse than no harness.
  await assemblePages(artifactDir);
  console.log(`--- Assembled the artifact at ${artifactDir} ---`);
} else {
  console.log(`--- Reusing the artifact at ${artifactDir} (--no-build) ---`);
}

const { origin, close } = await serveArtifact(resolve(artifactDir));
/** @type {string[]} */
const failures = [];
/** @type {import('@playwright/test').Browser | undefined} */
let browser;
try {
  browser = await chromium.launch({ headless: true });
  console.log(`--- Visiting ${origin}${basePath} ---`);
  await checkSite(browser, origin, failures);
  console.log(`--- Visiting ${origin}${basePath}storybook/ ---`);
  await checkStorybook(browser, origin, failures);
} catch (error) {
  // A thrown navigation or a locator that timed out is itself a failure, and
  // reporting it beside the recorded ones keeps the run to one report.
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  try {
    await browser?.close();
  } finally {
    await close();
  }
}

if (failures.length > 0) {
  console.error(
    `\nThe Pages artifact does not work under ${basePath} (#519):\n${failures
      .map((failure) => `  ${failure}`)
      .join('\n')}`
  );
  process.exit(1);
}

console.log(`\nBoth surfaces load correctly under ${basePath}.`);
