// Serves `apps/site/dist` in the foreground, for the Playwright `webServer`
// entry in `playwright.config.ts` that the landing page's specs need.
//
// `astro preview` is what a person would reach for and it cannot be used here:
// Astro 7's CLI starts the preview server as a background daemon and exits, and
// Playwright treats a server command that exits before its URL answers as a
// failure. `astro dev` refuses outright to start a second server for a project
// that already has one. Neither is a foreground process holding a port for as
// long as a test run, which is the whole of what a `webServer` entry needs.
//
// `scripts/check-deploy-artifact.mjs` also serves a directory over
// `node:http`, and this is not that. That script assembles the deploy artifact,
// serves it on an ephemeral port and runs its own checks against it — it is a
// check with a server inside it, and it exits when the check is done. This is a
// server and nothing else.
//
// Usage: node scripts/serve-site.mjs <port>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
// `process` and `URL` are imported rather than taken from the global scope.
// `eslint.config.js` grants Node globals to `**/*.{js,ts}` only, so a `.mjs`
// file reaching for either fails `no-undef` — and every other script here
// happens to name them only in prose. Importing them is the smaller fix: it
// keeps this file self-contained and leaves the shared config, which would
// newly cover every `.mjs` in the repo, alone.
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../apps/site/dist/', import.meta.url));

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`serve-site: expected a port, got ${process.argv[2]}`);
}

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

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
  try {
    const target = join(root, pathname.slice(1));
    // A trailing-slash route is a directory holding an `index.html`, which is
    // how Astro's static output addresses every page it builds.
    const entry = await stat(target).catch(() => null);
    const file = entry?.isDirectory() ? join(target, 'index.html') : target;
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': mimeTypes[extname(file)] ?? 'application/octet-stream'
    });
    response.end(body);
  } catch {
    // A miss stays a miss. Falling back to the site's own index would answer a
    // request for something that is not there with a page that looks fine.
    response.writeHead(404);
    response.end();
  }
});

// The (port, host, listener) overload, for the reason
// `scripts/check-deploy-artifact.mjs` gives at its own call: a `resolve` passed
// straight through takes an argument, and matches (port, backlog, listener).
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`serve-site: http://127.0.0.1:${port}/\n`);
});
