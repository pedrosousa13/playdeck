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
// An external URL reaches one of three verdicts, and keeping them apart is the
// criterion this check was asked for above all: a request that never got an
// answer is not evidence that a video was taken down. Gone (404, 410) and
// refused (401, 403) both fail the run, and are reported separately because
// they send a reader somewhere different. Everything else — a timeout, a
// refused connection, a 429, a 5xx — is retried and then reported as
// unverified, visible in the log and not fatal, so a runner with a flaky egress
// path does not redden a pull request that changed nothing. The reasoning for
// putting 401 and 403 on the fatal side is above `inspect`.
//
// Run as `pnpm test:site-links`, from a job that has already built the site.
// Unlike `pnpm test:deploy` it starts no browser and builds nothing, which is
// what makes it cheap enough to gate every pull request with.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { layout } from './assemble-deploy.mjs';

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

// The surfaces that are not in this build. `scripts/assemble-deploy.mjs` copies
// each one in beside the site, and the landing page links across that seam — so
// resolving `/storybook/` against `apps/site/dist` finds nothing and would
// report a link that is correct.
//
// Derived from that script's own `layout` rather than written here as a string.
// The exemption then says what it means — "a link into a surface this build
// does not contain" — and it moves when the thing it describes moves: rename a
// destination there and the link into the old one stops matching any mount and
// fails here, which is the failure a hard-coded `/storybook/` would have
// skipped forever.
//
// What this does NOT prove is that the workbench is actually reachable once
// assembled. `pnpm test:deploy` proves that, by assembling both surfaces,
// serving them and following this link in a browser — and it runs on demand
// rather than per pull request, deliberately: its own header records that it is
// several times the work `ci.yml` does. So the honest statement of the gap is
// that this check proves the link points into a surface the deploy places, and
// the deploy check proves the surface answers.
const externalSurfacePrefixes = layout
  .filter(({ to }) => to !== '.')
  .map(({ to }) => `${basePath}${to}/`);

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
 * Links a host answered and turned down — 401 or 403. Fatal, and kept apart
 * from `failures` so the report can say which of the two things went wrong:
 * "this is gone" and "this is no longer ours to read" send a reader to
 * different places.
 *
 * @type {string[]}
 */
const refused = [];
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
    if (externalSurfacePrefixes.some((prefix) => pathname.startsWith(prefix)))
      continue;

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

// One request, and what it can and cannot decide. Three verdicts, not two,
// because the two obvious ones cannot hold the case this check was built for.
//
// A 404 or a 410 is the server saying the thing is not there any more, and that
// is the plainest removal. A refused connection, a timeout, a 429 or a 5xx is a
// statement about the request rather than about the resource, so it is retried
// with a widening pause and then reported as unverified — not fatal, because a
// gate that reddened a pull request over a flaky egress path would teach its
// readers to ignore it.
//
// A 401 or a 403 is neither. The answer arrived, so nothing about it is
// transient, and it says the resource is there and not for us — which is
// exactly what an upload made private looks like, and #528 names that as the
// failure it exists to catch. Filing it under unverified would have printed
// "reachability could not be established" about a request that established
// reachability and was turned down. So it is its own verdict, it fails the run,
// and it is not retried: a deliberate access change does not come good on the
// second ask.
//
// The cost, stated rather than discovered: a host that answers 403 to anything
// that looks automated fails this gate. That is the right way round — a false
// failure here is one person reading one URL, and the silent pass it replaces
// is a dead embed on the documentation site of a library whose whole argument
// is honesty about what works. `user-agent` below is set for this reason.
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
 * @returns {Promise<{ verdict: 'gone' | 'refused' | 'unverified', detail: string } | undefined>}
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
        return { verdict: 'gone', detail: `HTTP ${response.status}` };
      }
      // Returned rather than retried: see the note above. The answer arrived
      // and it was "not for you", which the next two asks will also be.
      if (response.status === 401 || response.status === 403) {
        return { verdict: 'refused', detail: `HTTP ${response.status}` };
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
  return {
    verdict: 'unverified',
    detail: `${last} (after ${attempts} attempts)`
  };
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
    const outcome = await inspect(url);
    if (outcome === undefined) continue;
    const where = [...carriers].map((page) => `      on ${page}`).join('\n');
    const line = `${url} — ${outcome.detail}\n${where}`;
    if (outcome.verdict === 'gone') failures.push(line);
    else if (outcome.verdict === 'refused') refused.push(line);
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

if (refused.length > 0) {
  // Its own paragraph rather than folded into the list below, because the
  // action differs: a removed upload has to be replaced, and a refused one may
  // only have been made private and can be asked back.
  console.error(
    `\nAccess refused — the host answered and declined, which is not transient (#528):\n${refused
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
}

if (failures.length > 0 || refused.length > 0) process.exit(1);

console.log('\nEvery link in the built site resolves.');
