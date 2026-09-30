// Proves the no-build entry the way tests/bundle/native-only/test.mjs proves
// the default one: by actually driving a browser, rather than asserting
// anything about the build's static output. What is different here is the
// page it drives -- `index.html` is served byte for byte as authored, with no
// bundler between it and the browser, because that is the property this
// entry exists to have. The one piece of tooling in this file is Playwright,
// standing in for the browser a real consumer would open.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Matches scripts/check-bundle-budgets.mjs's own convention: the lint config
// gives this directory node globals, but `console` still has to be reached
// through `globalThis`.
const console = globalThis.console;

// Resolved the way a consumer's own `import` would resolve it -- through
// Node's package resolution reading `@playdeck/react`'s real `exports` map --
// rather than a path assembled by hand, so a subpath this fixture no longer
// carries fails here instead of silently serving a stale file.
const browserEntry = fileURLToPath(
  import.meta.resolve('@playdeck/react/browser')
);
const reactDist = dirname(browserEntry);
const reactRoot = dirname(reactDist);
const fixtureRoot = fileURLToPath(new URL('./', import.meta.url));
const tracerMp4 = fileURLToPath(
  new URL('../../../apps/storybook/public/tracer.mp4', import.meta.url)
);

/** @type {Record<string, string>} */
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mp4': 'video/mp4'
};

/** @param {string} pathname */
const resolveRequest = (pathname) => {
  if (pathname === '/') return join(fixtureRoot, 'index.html');
  if (pathname === '/theme.css') return join(reactRoot, 'theme.css');
  if (pathname === '/tracer.mp4') return tracerMp4;
  // Every other request is a chunk `browser.js` names by a relative
  // specifier -- `core.js`, `provider-native.js` -- so it is served straight
  // out of the same directory the entry itself came from.
  return join(reactDist, pathname.replace(/^\//, ''));
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    );
    const filePath = resolveRequest(pathname);
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': mime[extname(filePath)] ?? 'application/octet-stream'
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) =>
  server.listen(0, '127.0.0.1', () => resolve(undefined))
);

const youtubeDomains = ['youtube.com', 'youtube-nocookie.com', 'youtu.be'];
const vimeoDomains = ['vimeo.com', 'vimeocdn.com'];
const wistiaDomains = ['wistia.com', 'wistia.net', 'fast.wistia.com'];
/**
 * @param {string} hostname
 * @param {readonly string[]} domains
 */
const isHost = (hostname, domains) =>
  domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );

/** @type {string[]} */
const requestedScripts = [];
/** @type {URL[]} */
const requestedUrls = [];
/** @type {string[]} */
const consoleErrors = [];
/** @type {import('@playwright/test').Browser | undefined} */
let browser;
try {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not resolve fixture server address.');
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('request', (request) => {
    requestedUrls.push(new URL(request.url()));
    if (request.resourceType() === 'script') {
      requestedScripts.push(new URL(request.url()).pathname);
    }
  });

  await page.goto(`http://127.0.0.1:${address.port}`);

  // Whether the native provider chunk loads on mount or waits for a gesture
  // is `loading`'s concern (covered where that prop is tested); this fixture
  // sets neither, so it does not assert a request ordering it did not ask for.
  // What it does assert -- unconditionally, not only after some interaction
  // -- is that the four providers this build never carries are not among the
  // scripts requested, checked once below.
  const playButton = page.getByRole('button', { name: 'Play' });
  await playButton.waitFor();
  await playButton.click();

  // The one real proof the acceptance criteria ask for: the media element
  // actually plays, not merely that it mounted. `currentTime` only advances
  // once the browser has decoded and is presenting frames.
  const video = page.locator('video');
  await video.waitFor();
  const before = await video.evaluate(
    (/** @type {HTMLVideoElement} */ element) => element.currentTime
  );
  await page.waitForFunction(
    (previous) =>
      (globalThis.document.querySelector('video')?.currentTime ?? 0) > previous,
    before
  );

  // The native provider is the one this build does carry, and it has to have
  // actually been requested as its own file for the laziness claim below to
  // mean anything -- a build that inlined it into `browser.js` (or one that
  // silently failed to code-split it) would also show zero foreign requests.
  if (!requestedScripts.includes('/provider-native.js')) {
    throw new Error(
      'The native provider never loaded as its own chunk -- nothing below would prove laziness against a build that inlined it instead.'
    );
  }

  // Providers this build does not carry -- vite.browser.config.ts leaves them
  // external -- must never be requested and never contacted, the same
  // guarantee tests/bundle/native-only holds for the default entry.
  const foreignChunks = requestedScripts.filter((pathname) =>
    /(?:hls|hls\.light|player\.es|provider-(?:hls|vimeo|wistia|youtube))/.test(
      pathname
    )
  );
  if (foreignChunks.length > 0) {
    throw new Error(
      `A provider this build does not carry was requested: ${foreignChunks.join(', ')}`
    );
  }
  for (const requested of requestedUrls) {
    if (
      isHost(requested.hostname, youtubeDomains) ||
      isHost(requested.hostname, vimeoDomains) ||
      isHost(requested.hostname, wistiaDomains)
    ) {
      throw new Error(`The no-build fixture contacted ${requested.href}.`);
    }
  }
  if (consoleErrors.length > 0) {
    throw new Error(
      `The page logged console errors: ${consoleErrors.join('; ')}`
    );
  }

  // The whole graph, named rather than merely filtered. The two checks above
  // catch a missing native chunk and a foreign provider, but neither would
  // notice a chunk that is new and unaccounted for -- a primitive split out
  // on its own, or a second copy of something already in the graph. This
  // entry's initial cost is four files, and that is the claim its budget
  // rows are written against, so the test asserts the set rather than
  // reporting it.
  //
  // `react.js` is the fourth, and it arrived with the thumbnail preview
  // moving behind a dynamic import (#727): the entry and that preview are
  // both React code, so Rollup factors React itself out of the entry into a
  // chunk they share. It is one more request at the same depth in the
  // waterfall as `core.js`, not one more round trip after it, and it is
  // fewer bytes overall -- the entry's eager gzip total fell from 93.76 KB
  // to 92.87 KB across that change, measured on this build with the preview
  // absent, which is the case this page is. A page that does set
  // `thumbnails` pays for the preview then, and only then.
  const expectedScripts = [
    '/browser.js',
    '/core.js',
    '/provider-native.js',
    '/react.js'
  ];
  const unexpected = requestedScripts.filter(
    (pathname) => !expectedScripts.includes(pathname)
  );
  if (
    unexpected.length > 0 ||
    requestedScripts.length !== expectedScripts.length
  ) {
    throw new Error(
      `The no-build entry requested ${requestedScripts.length} scripts, not the ${expectedScripts.length} it is budgeted for: ${requestedScripts.join(', ')}.`
    );
  }

  console.log('OK: the no-build entry played tracer.mp4 with no bundler.');
  console.log(`Scripts requested: ${requestedScripts.join(', ')}`);
} finally {
  try {
    await browser?.close();
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined)))
    );
  }
}
