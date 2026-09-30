/*
 * A static file server for the built site, for the e2e suite to drive.
 *
 * The site is `output: 'static'` and the Worker that serves it in production
 * runs no code of this repository's, so the thing a test has to exercise is a
 * directory of files served over HTTP and nothing else. `astro dev` would be
 * the wrong server twice over: it transforms modules on request rather than
 * serving the artifact, and `apps/site/package.json`'s `build` runs Pagefind
 * over `dist/` *after* Astro has finished, so the search index only exists in
 * the built output. A test against the dev server would be testing a site with
 * no index in it.
 *
 * ---- why it mounts more than one directory ---------------------------------
 *
 * The site ships from the apex, so `base` is `/`, and every path a page emits
 * is built from `import.meta.env.BASE_URL`. That habit is only worth anything
 * if something checks it, and it cannot be checked at the prefix where a
 * correct answer and a hard-coded one are the same string. So `e2e/
 * site-search.spec.ts` builds the site a second time under a non-root prefix
 * and runs the same assertions against it, which needs both builds reachable
 * at once — the shipped one at `/`, the second at the prefix it was built for.
 *
 * Mounts are given longest-prefix-first at match time, so a mount at `/` does
 * not swallow one at `/playdeck/`.
 *
 * Usage:
 *   node scripts/serve-site.mjs --port 4322 \
 *     --mount /=apps/site/dist --mount /playdeck/=apps/site/dist-base
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

// As in scripts/assemble-deploy.mjs: these still have to be reached through
// globalThis for the lint config to see them declared.
const console = globalThis.console;
const process = globalThis.process;
const URL = globalThis.URL;

/** What the browser is told a file is. Only the types this site emits. */
const CONTENT_TYPES = new Map(
  Object.entries({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp4': 'video/mp4',
    // `scripts/media-sprite-fright.mjs`'s HLS ladder: the manifest and its
    // MPEG-TS segments, the same pair the Worker's own asset serving resolves
    // by extension in production. Without these two this server would answer
    // `application/octet-stream` for both, which hls.js and Safari's native
    // engine are lenient enough about to still play -- but a mismatch here
    // would be this server disagreeing with what production actually serves,
    // which is exactly the gap `scripts/serve-site.mjs`'s own header explains
    // this file exists to close.
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
    // Pagefind's own index shards and metadata. It fetches them itself and does
    // not care what they are called, but a server that returns them as
    // `application/octet-stream` is the honest description.
    '.pagefind': 'application/octet-stream',
    '.pf_meta': 'application/octet-stream',
    '.pf_fragment': 'application/octet-stream',
    '.pf_index': 'application/octet-stream'
  })
);

/**
 * @param {string[]} argv
 * @returns {{ port: number; mounts: { prefix: string; dir: string }[] }}
 */
const parseArgs = (argv) => {
  let port = 4322;
  const mounts = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--port') {
      index += 1;
      port = Number(argv[index]);
    } else if (flag === '--mount') {
      index += 1;
      const value = argv[index] ?? '';
      const split = value.indexOf('=');
      if (split === -1) {
        throw new Error(`--mount wants <prefix>=<directory>, got '${value}'`);
      }
      const prefix = value.slice(0, split);
      if (!prefix.startsWith('/') || !prefix.endsWith('/')) {
        throw new Error(
          `--mount prefix has to start and end with '/', got '${prefix}'`
        );
      }
      mounts.push({ prefix, dir: resolve(value.slice(split + 1)) });
    } else {
      throw new Error(`Unrecognised argument '${flag}'`);
    }
  }
  if (mounts.length === 0) {
    throw new Error('At least one --mount is required');
  }
  // Longest first, so a mount at `/` cannot answer for a path another mount
  // claims.
  mounts.sort((a, b) => b.prefix.length - a.prefix.length);
  return { port, mounts };
};

const { port, mounts } = parseArgs(process.argv.slice(2));

/**
 * The file a request resolves to, or `undefined` for a path no mount claims or
 * that escapes the directory it was resolved inside.
 *
 * @param {string} pathname
 * @returns {Promise<string | undefined>}
 */
const resolveFile = async (pathname) => {
  for (const { prefix, dir } of mounts) {
    if (!pathname.startsWith(prefix)) continue;
    // `normalize` collapses any `..` the request tried to smuggle in; the
    // containment check below is what makes that a refusal rather than a
    // traversal. A test server still gets this right — it is served on
    // localhost with a repository behind it.
    const candidate = normalize(join(dir, pathname.slice(prefix.length)));
    if (candidate !== dir && !candidate.startsWith(dir + sep)) continue;

    for (const attempt of [candidate, join(candidate, 'index.html')]) {
      try {
        const stats = await stat(attempt);
        if (stats.isFile()) return attempt;
      } catch {
        // Not a file, so try the next shape of the same request.
      }
    }
  }
  return undefined;
};

const server = createServer((request, response) => {
  const { pathname } = new URL(
    request.url ?? '/',
    `http://${request.headers.host}`
  );
  void resolveFile(decodeURIComponent(pathname)).then((file) => {
    if (file === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`Not found: ${pathname}\n`);
      return;
    }
    response.writeHead(200, {
      'content-type':
        CONTENT_TYPES.get(extname(file)) ?? 'application/octet-stream',
      // The suite rebuilds the site between runs and a cached document would
      // hide the change under test, so nothing addressed by a stable path is
      // storable.
      //
      // `/_astro/` is the exception, and it is safe for the reason a
      // production CDN caches it forever: every file under it is
      // content-addressed — Astro puts a hash of the contents in the name — so
      // a rebuild that changes a file changes its address, and a cached copy
      // can only ever be a copy of the bytes that were asked for. It is served
      // cacheable because `e2e/site-receipt.spec.ts` has to observe a cache hit
      // to check that the receipt prints one as a cache hit rather than as a
      // page that weighs nothing, and `no-store` on every response made that
      // unobservable.
      'cache-control': pathname.includes('/_astro/')
        ? 'public, max-age=600'
        : 'no-store'
    });
    createReadStream(file).pipe(response);
  });
});

server.listen(port, '127.0.0.1', () => {
  for (const { prefix, dir } of mounts) {
    console.log(`serving ${dir} at http://127.0.0.1:${port}${prefix}`);
  }
});
