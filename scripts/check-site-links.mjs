#!/usr/bin/env node
// Checks every link the built site emits — the internal ones against the build
// itself, the external ones against the network (#528).
//
// It reads `apps/site/dist`, and that is the whole point rather than an
// implementation detail. A link is written in an `.astro` template as
// `${import.meta.env.BASE_URL}reference/`, and what a visitor's browser gets is
// whatever the build resolved that to under the configured base. Checking the
// source would prove that the template says the right thing, which is the half
// nobody gets wrong; checking the output is what proves the base path arrived —
// the bug class #435 is about, and the one a hand-written `/reference/` in a
// prefixed build produces.
//
// External URLs are checked because the site points at media and documents this
// repository does not own. Whoever posted an upload can delete it, make it
// private or region-lock it, and nothing else in this repository would notice.
// Every failure names the URL and the page carrying it, because "a link is
// dead" is not actionable and "this link on this page is dead" is.
//
// The two verdicts an external URL can reach are deliberately not the same
// verdict, which is the criterion this check was asked for above all: a request
// that never got an answer is not evidence that a video was taken down. Only a
// definitive removal fails the run. Everything else is retried, and then
// reported as unverified — visible in the log, not fatal — so a runner with a
// flaky egress path does not redden a pull request that changed nothing.
//
// Run as `pnpm test:site-links`, from a job that has already built the site.
// Unlike `pnpm test:deploy` it starts no browser and builds nothing, which is
// what makes it cheap enough to gate every pull request with.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

// As in scripts/serve-site.mjs and scripts/check-deploy-artifact.mjs: the lint
// config grants Node globals to `**/*.{js,ts}` only, so a `.mjs` file reaching
// for one fails `no-undef`. `process` and `URL` are imported above; the rest are
// reached through `globalThis`.
const console = globalThis.console;
const fetch = globalThis.fetch;
const AbortSignal = globalThis.AbortSignal;

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const distDir = join(repoRoot, 'apps', 'site', 'dist');

// The prefix the site is served from, and the same literal
// `apps/site/astro.config.ts` writes into `base`. It is stated here rather than
// read from that file because a config written in TypeScript is not something a
// plain script can import, and it is duplicated deliberately rather than
// inferred: the value is what this check measures against, so guessing it from
// the artifact would let a build that lost its prefix redefine the standard it
// is being held to. The day `base` moves, this moves with it and every
// root-absolute link that did not move fails here.
const basePath = '/';

// The workbench. It is not in this build at all — `scripts/assemble-deploy.mjs`
// copies `apps/storybook/storybook-static` in beside the site, and the landing
// page links to it across that seam — so resolving `/storybook/` against
// `apps/site/dist` finds nothing and would report a link that is correct. It is
// skipped here and proven elsewhere: `pnpm test:deploy` assembles both surfaces
// into one directory, serves it, and follows this exact link in a browser.
const workbenchPrefix = `${basePath}storybook/`;

// Schemes that address nothing this check can resolve. `data:` and `blob:`
// carry their own payload, and the rest hand the URL to something that is not a
// web server.
const opaqueSchemes = new Set([
  'blob:',
  'data:',
  'javascript:',
  'mailto:',
  'tel:'
]);

// Attributes that carry an address. `srcset` is one attribute holding several,
// and is split below.
const urlAttributes =
  /\s(href|src|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// Ids, for fragment targets. `name` is matched too because an anchor written
// the old way is still a valid target for `#name`.
const anchorTargets = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Every `.html` file in the build, as paths relative to it with `/` separators.
 *
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
const collectPages = async (directory) => {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) =>
      relative(directory, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/')
    )
    .sort();
};

/**
 * The URL path a built file is served at. Astro's default output writes a page
 * as `<route>/index.html`, which a static host answers a trailing-slash request
 * with, so the file name is dropped rather than kept in the address.
 *
 * @param {string} page a path relative to the build, with `/` separators
 */
const servedAt = (page) => `${basePath}${page.replace(/index\.html$/, '')}`;

/**
 * The addresses one document carries.
 *
 * Regular expressions over HTML are the wrong tool for reading a document and
 * the right one for this: the input is one generator's output rather than the
 * open web, every address is in a quoted attribute, and the alternative is a
 * parser dependency for a check that runs on ten files. What it cannot see is
 * an address a script assembles at runtime — the site ships one island, and
 * nothing links into it.
 *
 * @param {string} html
 */
const addressesIn = (html) => {
  /** @type {string[]} */
  const found = [];
  for (const [, attribute, doubled, singled] of html.matchAll(urlAttributes)) {
    const value = doubled ?? singled ?? '';
    // `&` is escaped in an attribute value, so a query string arrives as
    // `?a=1&amp;b=2` and would be requested with the entity in it.
    const candidates =
      attribute.toLowerCase() === 'srcset'
        ? value.split(',').map((entry) => entry.trim().split(/\s+/)[0] ?? '')
        : [value];
    for (const candidate of candidates) {
      const address = candidate.replaceAll('&amp;', '&').trim();
      if (address !== '') found.push(address);
    }
  }
  return found;
};

/**
 * @param {string} html
 */
const anchorsIn = (html) =>
  new Set(
    [...html.matchAll(anchorTargets)].map(
      ([, doubled, singled]) => doubled ?? singled ?? ''
    )
  );

const pages = await collectPages(distDir);
if (pages.length === 0) {
  throw new Error(
    `No built pages under ${distDir}. Build the site first: pnpm exec turbo run build --filter=@playdeck/site...`
  );
}

/** @type {Map<string, string>} */
const documents = new Map();
for (const page of pages) {
  documents.set(page, await readFile(join(distDir, page), 'utf8'));
}

/** Broken links, each one fatal. @type {string[]} */
const failures = [];
/** Links that could not be resolved either way. @type {string[]} */
const unverified = [];
/**
 * External URLs, each mapped to every page that carries it. One request per
 * URL rather than one per occurrence: seven reference pages linking the same
 * repository is one fact about that repository, and asking a third party the
 * same question seven times is rude as well as slow.
 *
 * A page is listed once however many times it carries the URL, because the
 * reader of a failure is being told where to go and looking twice at one page
 * is not two pieces of information.
 *
 * @type {Map<string, Set<string>>}
 */
const external = new Map();

let internalChecked = 0;
for (const page of pages) {
  const from = servedAt(page);
  for (const address of addressesIn(documents.get(page) ?? '')) {
    /** @type {URL} */
    let resolved;
    try {
      // A document origin that cannot exist, so a link that names a real one
      // is separable from one resolved against the page.
      resolved = new URL(address, `http://built.invalid${from}`);
    } catch {
      failures.push(`${from} — ${address} is not a URL.`);
      continue;
    }

    if (opaqueSchemes.has(resolved.protocol)) continue;
    if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
      if (resolved.hostname !== 'built.invalid') {
        const carriers = external.get(resolved.href) ?? new Set();
        carriers.add(from);
        external.set(resolved.href, carriers);
        continue;
      }
    } else {
      failures.push(
        `${from} — ${address} uses the unsupported scheme ${resolved.protocol}`
      );
      continue;
    }

    internalChecked += 1;
    const { pathname, hash } = resolved;
    if (!pathname.startsWith(basePath)) {
      failures.push(
        `${from} — ${address} resolves to ${pathname}, which is outside the base path ${basePath}.`
      );
      continue;
    }
    if (pathname.startsWith(workbenchPrefix)) continue;

    // What a static host answers this path with: the file at it, or the
    // `index.html` inside the directory at it. `scripts/serve-site.mjs` and the
    // Cloudflare Worker behind `playdeck.video` both resolve it that way.
    const withinBuild = pathname.slice(basePath.length);
    const asFile = withinBuild;
    const asDirectory = posix.join(withinBuild, 'index.html');
    const target = documents.has(asFile)
      ? asFile
      : documents.has(asDirectory)
        ? asDirectory
        : undefined;

    if (target === undefined) {
      // A non-HTML asset — the hero's clip, a stylesheet, a font — is on disk
      // rather than in the document map.
      const onDisk = await stat(join(distDir, ...withinBuild.split('/')))
        .then((entry) => entry.isFile())
        .catch(() => false);
      if (!onDisk) {
        failures.push(
          `${from} — ${address} is not in the build (looked for ${withinBuild} and ${asDirectory}).`
        );
      }
      continue;
    }

    if (hash === '' || hash === '#') continue;
    const fragment = decodeURIComponent(hash.slice(1));
    if (!anchorsIn(documents.get(target) ?? '').has(fragment)) {
      failures.push(
        `${from} — ${address} points at #${fragment}, which ${servedAt(target)} does not carry.`
      );
    }
  }
}

// One request, and what it can and cannot decide.
//
// A 404 or a 410 is the server saying the thing is not there any more, and that
// is the removal this check exists to catch. Every other unhappy answer — a
// refused connection, a timeout, a 429, a 5xx, a 403 from a host that dislikes
// automation — is a statement about the request rather than about the resource,
// so it is retried with a widening pause and then reported as unverified.
//
// The residual, stated rather than left to be discovered: a host that answers
// 200 with a page saying the video is unavailable is indistinguishable here
// from a host that answers 200 with the video. This check proves an address is
// still served; it does not watch what comes back. A provider-specific probe
// (oEmbed answers definitively for two of the five) would close that, and is
// deliberately not written until there is an embed on the site to aim it at.
const attempts = 3;
const requestTimeout = 15_000;

/**
 * @param {string} url
 * @returns {Promise<{ removed: boolean, detail: string } | undefined>}
 */
const inspect = async (url) => {
  let last = 'no attempt was made';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(requestTimeout),
        headers: {
          // Named, so an operator reading their own logs can see who this is.
          'user-agent':
            'playdeck-link-check (+https://github.com/pedrosousa13/playdeck)'
        }
      });
      // The body is never read — the status is the whole answer — and an
      // unread body holds the connection open.
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) {
        return { removed: true, detail: `HTTP ${response.status}` };
      }
      if (response.ok) return undefined;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    // 1s then 2s. Long enough to outlast the momentary failures this is for,
    // short enough that a genuinely unreachable host does not hold a job.
    if (attempt < attempts) await delay(1000 * attempt);
  }
  return { removed: false, detail: `${last} (after ${attempts} attempts)` };
};

// `--internal-only` is for working offline and for reproducing an internal
// failure without waiting on the network. It is never what CI runs: the
// external half is the reason this check exists.
const skipExternal = process.argv.includes('--internal-only');

if (skipExternal) {
  console.log(`Skipping ${external.size} external URLs (--internal-only).\n`);
} else {
  const inOrder = [...external].sort(([one], [other]) =>
    one.localeCompare(other)
  );
  for (const [url, carriers] of inOrder) {
    const verdict = await inspect(url);
    if (verdict === undefined) continue;
    const where = [...carriers].map((page) => `      on ${page}`).join('\n');
    const line = `${url} — ${verdict.detail}\n${where}`;
    if (verdict.removed) failures.push(line);
    else unverified.push(line);
  }
}

console.log(
  `Checked ${internalChecked} internal links across ${pages.length} built pages, and ${skipExternal ? 0 : external.size} external URLs.`
);

if (unverified.length > 0) {
  // Reported, and not fatal. See the note above `inspect`: an unanswered
  // request is not evidence that anything was taken down, and a gate that
  // failed on one would teach its readers to ignore it.
  console.log(
    `\nUnverified — reachability could not be established, which is not a removal:\n${unverified
      .map((entry) => `  ${entry}`)
      .join('\n')}`
  );
}

if (failures.length > 0) {
  console.error(
    `\nThe built site has broken links (#528):\n${failures
      .map((failure) => `  ${failure}`)
      .join('\n')}`
  );
  process.exit(1);
}

console.log('\nEvery link in the built site resolves.');
