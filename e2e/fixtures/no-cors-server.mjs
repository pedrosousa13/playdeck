/*
 * A minimal HTTP server for `e2e/native-source-error.spec.ts`'s CORS case:
 * serves `apps/storybook/public/tracer.mp4` at `/tracer.mp4`, deliberately
 * without an `access-control-allow-origin` header, on a fixed origin
 * distinct from the storybook dev server's -- so a `crossOrigin="anonymous"`
 * fetch of it is genuinely subject to CORS (`page.route` interception is
 * not: see that spec's header).
 *
 * Started once by `playwright.config.ts`'s `webServer` array, the way
 * `scripts/serve-site.mjs` is, rather than once per test: chromium and
 * firefox run the same spec in parallel, and a retry can start a third
 * attempt while an earlier one is still tearing down, so a server bound
 * per-test on a fixed port can lose a race to bind it. One process for the
 * whole run has nothing left to race.
 *
 * Usage:
 *   node e2e/fixtures/no-cors-server.mjs --port 4174
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const console = globalThis.console;
const process = globalThis.process;
const URL = globalThis.URL;

/**
 * @param {string[]} argv
 * @returns {{ port: number }}
 */
const parseArgs = (argv) => {
  let port = 4174;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--port') {
      index += 1;
      port = Number(argv[index]);
    } else {
      throw new Error(`Unrecognised argument '${flag}'`);
    }
  }
  return { port };
};

const { port } = parseArgs(process.argv.slice(2));

const clipPath = fileURLToPath(
  new URL('../../apps/storybook/public/tracer.mp4', import.meta.url)
);

const server = createServer((request, response) => {
  if (request.url !== '/tracer.mp4') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
    return;
  }
  void readFile(clipPath).then((body) => {
    response.writeHead(200, {
      'content-length': body.byteLength,
      'content-type': 'video/mp4'
    });
    response.end(body);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${clipPath} at http://127.0.0.1:${port}/tracer.mp4`);
});
