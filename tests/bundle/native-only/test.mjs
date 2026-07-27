import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep
} from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = new URL('./dist/', import.meta.url);
const rootPath = fileURLToPath(root);
/**
 * A Vite manifest, keyed by source path.
 * @type {Record<string, { file: string; name?: string; isEntry?: boolean; imports?: string[] }>}
 */
const manifest = JSON.parse(
  await readFile(new URL('.vite/manifest.json', root), 'utf8')
);
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entryKey) throw new Error('The Vite manifest has no entry.');

/** @param {string} rootKey */
const staticClosure = (rootKey) => {
  /** @type {Set<string>} */
  const closure = new Set();
  /** @param {string} key */
  const visit = (key) => {
    if (closure.has(key)) return;
    closure.add(key);
    for (const imported of manifest[key]?.imports ?? []) visit(imported);
  };
  visit(rootKey);
  return closure;
};
const staticKeys = staticClosure(entryKey);

/** @param {string} key */
const isProviderEntry = (key) => {
  const name = manifest[key]?.name ?? '';
  return (
    /(?:packages|@reely)\/provider-(?:native|hls|youtube|vimeo)/.test(key) ||
    /(?:packages|@reely)\/provider-(?:native|hls|youtube|vimeo)/.test(name)
  );
};
const providerKeys = Object.keys(manifest).filter(isProviderEntry);
const nativeProviderKey = providerKeys.find((key) => {
  const name = manifest[key]?.name ?? '';
  return key.includes('provider-native') || name.includes('provider-native');
});
if (!nativeProviderKey) {
  throw new Error('The consumer build did not emit a native provider chunk.');
}
for (const key of providerKeys) {
  if (staticKeys.has(key)) {
    throw new Error(`Provider adapter leaked into the initial graph: ${key}`);
  }
}

const hlsLibraryKeys = Object.keys(manifest).filter(
  (key) =>
    /node_modules\/.*hls\.js\//.test(key) || manifest[key]?.name === 'hls'
);
if (hlsLibraryKeys.length === 0) {
  throw new Error('The consumer build did not emit an hls.js chunk.');
}
const hlsProviderKey = providerKeys.find((key) => {
  const name = manifest[key]?.name ?? '';
  return key.includes('provider-hls') || name.includes('provider-hls');
});
if (!hlsProviderKey) {
  throw new Error('The consumer build did not emit an HLS provider chunk.');
}
// The native MP4 initial graph and the native-HLS initial graph (the HLS
// provider chunk on the native engine) must both reach hls.js only through a
// dynamic import.
const nativeHlsKeys = staticClosure(hlsProviderKey);
for (const key of hlsLibraryKeys) {
  if (staticKeys.has(key)) {
    throw new Error(`hls.js leaked into the native MP4 initial graph: ${key}`);
  }
  if (nativeHlsKeys.has(key)) {
    throw new Error(`hls.js leaked into the native-HLS initial graph: ${key}`);
  }
}

// Icon tree-shaking: an icon rendered in the fixture ships in the static
// bundle; an icon that is never imported is dropped from it.
const closureFiles = new Set(
  [...staticKeys].map((key) => manifest[key].file).filter(Boolean)
);
const closureSources = (
  await Promise.all(
    [...closureFiles].map((file) => readFile(new URL(file, root), 'utf8'))
  )
).join('\n');
if (!closureSources.includes('M8 5v14l11-7z')) {
  throw new Error('PlayIcon (used) did not ship in the static bundle.');
}
if (closureSources.includes('M12 5V2L7 6')) {
  throw new Error(
    'ReplayIcon (unused) did not tree-shake out of the static bundle.'
  );
}

/** @type {Record<string, string>} */
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4'
};
const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname =
      requestUrl.pathname === '/'
        ? '/index.html'
        : decodeURIComponent(requestUrl.pathname);
    const safePath = normalize(pathname.replaceAll('\\', '/')).replace(
      /^[/\\]+/,
      ''
    );
    const filePath = resolve(rootPath, safePath);
    const relativePath = relative(rootPath, filePath);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error('Fixture request escaped the distribution directory.');
    }
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
// `resolve` takes an argument, so passing it straight to `listen` matched the
// (port, backlog, listener) overload rather than the (port, host, listener)
// one -- which typechecked '127.0.0.1' as a backlog size.
await new Promise((resolve) =>
  server.listen(0, '127.0.0.1', () => resolve(undefined))
);

const nativeFile = `/${manifest[nativeProviderKey].file}`;
const foreignProviderFiles = providerKeys
  .filter((key) => key !== nativeProviderKey)
  .map((key) => `/${manifest[key].file}`);
const youtubeDomains = [
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'ytimg.com',
  'googlevideo.com'
];
/** @param {string} hostname */
const isYouTubeHost = (hostname) =>
  youtubeDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
const vimeoDomains = ['vimeo.com', 'vimeocdn.com'];
/** @param {string} hostname */
const isVimeoHost = (hostname) =>
  vimeoDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
/** @type {string[]} */
const requestedScripts = [];
/** @type {URL[]} */
const requestedUrls = [];
/** @type {import('@playwright/test').Browser | undefined} */
let browser;
try {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not resolve fixture server address.');
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('request', (request) => {
    requestedUrls.push(new URL(request.url()));
    if (request.resourceType() === 'script') {
      requestedScripts.push(new URL(request.url()).pathname);
    }
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const activationButton = page.getByRole('button', { name: 'Play video' });
  await activationButton.waitFor();
  await activationButton.evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        globalThis.document.documentElement.dataset.nativeRequestClickTime =
          String(globalThis.performance.now());
      },
      { capture: true, once: true }
    );
  });
  if (requestedScripts.includes(nativeFile)) {
    throw new Error('Native provider loaded before interaction.');
  }
  const nativeUrl = new URL(nativeFile, page.url()).href;
  await Promise.all([
    page.waitForRequest((request) => {
      return request.resourceType() === 'script' && request.url() === nativeUrl;
    }),
    activationButton.click()
  ]);
  await page.waitForFunction(
    (url) =>
      globalThis.performance.getEntriesByName(url, 'resource').length > 0,
    nativeUrl
  );
  const { clickTime, startTimes } = await page.evaluate(
    (url) => ({
      clickTime: Number(
        globalThis.document.documentElement.dataset.nativeRequestClickTime
      ),
      startTimes: globalThis.performance
        .getEntriesByName(url, 'resource')
        .map(({ startTime }) => startTime)
    }),
    nativeUrl
  );
  if (
    !Number.isFinite(clickTime) ||
    startTimes.length === 0 ||
    startTimes.some((startTime) => startTime < clickTime)
  ) {
    throw new Error('Native provider request started before interaction.');
  }
  // Lazy provider chunks on disk are fine; requesting them is not. A native
  // fixture must stay YouTube-free at runtime as well as in its static graph.
  for (const foreignFile of foreignProviderFiles) {
    if (requestedScripts.includes(foreignFile)) {
      throw new Error(
        `A foreign provider chunk was requested at runtime: ${foreignFile}`
      );
    }
  }
  const youtubeRequest = requestedUrls.find((url) =>
    isYouTubeHost(url.hostname)
  );
  if (youtubeRequest) {
    throw new Error(
      `The native fixture contacted a YouTube domain: ${youtubeRequest.href}`
    );
  }
  const vimeoRequest = requestedUrls.find((url) => isVimeoHost(url.hostname));
  if (vimeoRequest) {
    throw new Error(
      `The native fixture contacted a Vimeo domain: ${vimeoRequest.href}`
    );
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined)))
    );
  }
}
