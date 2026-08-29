#!/usr/bin/env node
// Proves both deployed surfaces work where they are served from, against the
// built artifact rather than against the configuration that produced it (#519).
//
// The bug this exists to catch is #435: a root-absolute URL emitted by a build
// that was told nothing about the prefix it sits under. The site holds the root
// of `playdeck.video` and the workbench sits at `/storybook/`, so a workbench
// asset written as `/assets/...` asks the site for a file the site does not
// have, and the only symptom is a 404 at request time — which is why neither a
// unit test over `.storybook/main.ts` nor a grep of the emitted HTML would do.
// Storybook resolves most of its own navigation in the browser, so a static
// reading of the artifact cannot see the half that breaks.
//
// So the artifact is assembled the way the deploy assembles it, served the way
// the Worker serves it — one directory at the origin root, a miss answered with
// a 404 rather than with an index — and visited by a real browser, with every
// response, console error and page error recorded for the whole visit. Every
// failure is reported, not the first, so one run tells the reader everything
// that is wrong.
//
// Run on demand as `pnpm test:deploy` rather than from a pull-request gate: it
// builds both surfaces from scratch and drives a browser through them, which is
// several times the work `ci.yml` does per pull request. It builds by default,
// because a run against whatever happens to be on disk proves nothing about the
// tree under test; `--no-build` is for a local re-run against an artifact this
// script already assembled.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { assembleDeploy } from './assemble-deploy.mjs';

// As in scripts/verify-packaging.mjs: the lint config gives this directory node
// globals, but `console` and `process` still have to be reached through
// globalThis.
const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Where each surface is served from, and the values the builds under test are
// handed. The site is at the root, so nothing about it can get a prefix wrong;
// the workbench is the surface with a prefix to honour, and one segment is as
// much of a prefix as ten. These are what the deploy uses, so the artifact
// under test is the artifact that ships.
const sitePath = '/';
const storybookPath = '/storybook/';
const artifactDir = join(repoRoot, 'deploy-dist');

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
 * Serves the assembled artifact at the origin root, which is what the Worker
 * does with the directory `wrangler.jsonc` names. The 404 is load-bearing
 * rather than incidental: `not_found_handling` is `"none"` precisely so a miss
 * stays a miss, and a server that fell back to the artifact's own index would
 * answer exactly the requests this check exists to catch with a 200.
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

    const relative = pathname.slice(1);
    try {
      const target = join(directory, relative);
      // A directory request is what an internal link to `storybook/` produces,
      // and `html_handling: "auto-trailing-slash"` — the default the deploy
      // leaves in place — answers one with the index inside it.
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

// Noise the workbench makes about itself, tolerated because neither event can
// carry the evidence this check is looking for. Storybook navigates its preview
// iframe while the previous navigation of that iframe is still in flight, and
// the browser reports the request it drops as aborted rather than with a
// status. And the manager logs the diagnostic below when a channel event
// arrives from a window it cannot match: it names an internal event and no URL
// at all. Anything else is a failure.
//
// The aborted request is tolerated by the URL it happens to and not by the
// surface it happens on, because the surfaces do not separate it: the site
// visit follows its link into the workbench and sees the same abort. A
// tolerance for every aborted request would drop, rather than report, a
// wrong-prefix asset abandoned by a navigation — which is the failure this
// whole script is for. Only the preview iframe's own URL, under the prefix
// being proven, is allowed to abort; the same document requested from a wrong
// prefix is not that URL and is still reported.
//
// To satisfy yourself that either tolerance is really the workbench and not the
// prefix under test: build the workbench with `PLAYDECK_BASE_PATH` unset, serve
// `apps/storybook/storybook-static` from a domain root — the arrangement where
// no base path exists to get wrong — and visit it with the same listeners
// attached.
const abortedRequest = 'net::ERR_ABORTED';
const previewIframePath = `${storybookPath}iframe.html`;
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
    const { pathname } = new URL(request.url());
    if (reason === abortedRequest && pathname === previewIframePath) return;
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
  await page.goto(`${origin}${sitePath}`);
  await page.getByRole('heading', { name: 'Playdeck', exact: true }).waitFor();

  // Every internal link, rather than the one the placeholder page happens to
  // carry today: whatever links the site grows, an internal one is exactly the
  // kind that gets written root-absolute, and this check should already cover
  // it without being extended.
  //
  // Selected by the prefix they are served from, and not merely by being an
  // absolute URL: `HTMLAnchorElement.href` resolves every link against the
  // document, so an external link the site gains later would look identical.
  // Following one would put a network request in the middle of a check that
  // must pass with no egress, and its 404 or its console errors would be
  // reported as this artifact's.
  const served = `${origin}${sitePath}`;
  const links = await page
    .locator('a[href]')
    .evaluateAll(
      (anchors, prefix) =>
        anchors
          .map((anchor) => /** @type {HTMLAnchorElement} */ (anchor).href)
          .filter((href) => href.startsWith(prefix)),
      served
    );
  if (links.length === 0) {
    failures.push('site: the page carries no internal link to follow.');
  }
  // The same wait every visit below takes, and for the same reason: closing a
  // page with requests still in flight abandons them, and the browser reports
  // an abandoned request as `net::ERR_ABORTED`, which `recordFailures` above is
  // listening for. The landing page is not exempt from that just because it is
  // the one that found the links.
  await page.waitForLoadState('networkidle');
  await page.close();

  // Each link in a page of its own, and the page holding the links is closed
  // above before the first one opens.
  //
  // This used to be one `page.goto` after another in the context that found
  // them, and that made the *order* of the links on the landing page
  // load-bearing (#528). The workbench goes on fetching its own scripts well
  // after its document has arrived, so navigating away from it abandoned those
  // requests, and the browser reports an abandoned request as
  // `net::ERR_ABORTED` — which `recordFailures` reports, because the tolerance
  // for that error is deliberately narrow and stays narrow: widening it to
  // every aborted request would drop a wrong-prefix asset abandoned by a
  // navigation, which is the failure this whole script exists to catch.
  //
  // A fresh context has nothing to abandon. Nothing is in flight in it when the
  // navigation starts, and closing it is not a navigation, so no surface's
  // requests can be dropped by another surface's visit and the landing page is
  // free to list its links in whatever order reads best.
  for (const link of links) {
    const visit = await browser.newPage();
    recordFailures(visit, failures, 'site');
    try {
      // A response event already reports the status, so what is left to
      // establish is that a document arrived rather than an error page.
      await visit.goto(link);
      // `load` fires when the document and its subresources are in, and the
      // workbench is still fetching after it — so closing the page there would
      // abandon those requests exactly as navigating away used to, and put the
      // same `net::ERR_ABORTED` into the report. Waiting for the network to go
      // quiet is what makes the close above a close of an idle page.
      //
      // A surface that never goes quiet would time out here, and that is the
      // right verdict rather than a limitation: neither surface in this
      // artifact polls or holds a socket open, so a page still talking half a
      // minute after `load` is a finding.
      await visit.waitForLoadState('networkidle');
      const title = await visit.title();
      if (title === '') {
        failures.push(`site: ${link} rendered no document title.`);
      }
    } finally {
      await visit.close();
    }
  }
};

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {string} origin
 * @param {string[]} failures
 */
const checkStorybook = async (browser, origin, failures) => {
  const page = await browser.newPage();
  recordFailures(page, failures, 'storybook');
  await page.goto(`${origin}${storybookPath}`);

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
  // Each surface is built the way `.github/workflows/deploy-site.yml` builds
  // it, including the site being handed nothing: `PLAYDECK_BASE_PATH` is
  // explicitly removed rather than left to whatever the shell running this
  // happens to export, so a stray value cannot make the harness build something
  // the deploy never would.
  //
  // The packages come first, and they are a prerequisite rather than a surface:
  // the site's landing page renders the gzipped size of every bundle
  // `pnpm test:budgets` gates, measured at build time from the module that gate
  // measures with, and that module reads build output. Building them here is
  // what makes `pnpm test:deploy` prove the tree under test rather than
  // whichever `dist/` happened to be lying around. `deploy-site.yml` runs the
  // same filter for the same reason, and `pnpm run` resolves it
  // topologically, so a package is built after the packages it depends on.
  console.log('--- Building the packages the site measures ---');
  execFileSync('pnpm', ['--filter', './packages/*', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit'
  });

  /** @type {[string, string | undefined][]} */
  const builds = [
    ['@playdeck/site', undefined],
    ['@playdeck/storybook', storybookPath]
  ];
  for (const [filter, prefix] of builds) {
    console.log(`--- Building ${filter} for ${prefix ?? sitePath} ---`);
    const env = { ...process.env };
    if (prefix === undefined) delete env.PLAYDECK_BASE_PATH;
    else env.PLAYDECK_BASE_PATH = prefix;
    execFileSync('pnpm', ['--filter', filter, 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env
    });
  }
  // The deploy's own layout, imported rather than restated: two copies would
  // drift, and a harness that went green against a shape the deploy no longer
  // produces is worse than no harness.
  await assembleDeploy(artifactDir);
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
  console.log(`--- Visiting ${origin}${sitePath} ---`);
  await checkSite(browser, origin, failures);
  console.log(`--- Visiting ${origin}${storybookPath} ---`);
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
    `\nThe deployed artifact does not work as served (#519):\n${failures
      .map((failure) => `  ${failure}`)
      .join('\n')}`
  );
  process.exit(1);
}

console.log(
  `\nBoth surfaces load correctly: the site at ${sitePath}, the workbench at ${storybookPath}.`
);
