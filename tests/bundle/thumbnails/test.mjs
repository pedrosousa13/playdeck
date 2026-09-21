// Proves that `SeekSlider`'s thumbnail preview is code a consumer pays for
// only when they set the `thumbnails` prop -- the claim issue #727 is about.
//
// Two pages are bundled from one consumer-shaped `vite build`
// (vite.config.ts), differing in that prop and nothing else, and both halves
// of the claim are checked against them:
//
//   absent  -- no chunk in the no-prop page's STATIC import closure carries
//              the preview code, and a real browser loading that page never
//              requests a script that does, even after hovering the slider.
//   present -- the page that sets the prop reaches the same code through a
//              dynamic import: the chunk is requested after mount, and the
//              `thumbnail` part crops the cue under the pointer.
//
// The static half follows tests/bundle/native-only/test.mjs, which reads the
// Vite manifest and searches the closure's own bytes for an icon path; the
// runtime half follows tests/bundle/no-build/test.mjs, which lists the
// scripts a real browser requested. Neither half alone is enough: a static
// check cannot see a chunk fetched on mount, and a request listing cannot
// see code inlined into a chunk the page fetches anyway.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import {
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep
} from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const console = globalThis.console;

const root = new URL('./dist/', import.meta.url);
const rootPath = fileURLToPath(root);
const storybookPublic = new URL(
  '../../../apps/storybook/public/',
  import.meta.url
);

/**
 * A Vite manifest, keyed by source path.
 * @type {Record<string, { file: string; name?: string; isEntry?: boolean; imports?: string[] }>}
 */
const manifest = JSON.parse(
  await readFile(new URL('.vite/manifest.json', root), 'utf8')
);

// One string per package that owns part of the preview, rather than one for
// the feature: the two halves ship from different packages and split on
// different mechanisms (`@playdeck/react`'s own dynamic `import()`, and
// `@playdeck/core`'s second export subpath), so a regression in either one
// alone has a name here rather than hiding behind the other.
//
// Both are chosen for surviving minification unchanged: the inline `transform`
// that centres the `thumbnail` part on the previewed time, and the source text
// of the media-fragment pattern the parser matches a cue's `#xywh=` against.
// A minifier renames every identifier around them and rewrites the quotes, so
// neither is matched with its own quoting; the text between them is what a
// minifier has no licence to change.
//
// Each is unique to the preview in the tree as it stands, which is a property
// of today's code rather than a guarantee: an eagerly rendered part that
// centres itself the same way would fail this from the other direction. That
// failure is loud and says which string it found where, which is the right
// place to pick a sharper needle -- not a reason to search for something
// vaguer now.
const PREVIEW_SIGNATURES = [
  {
    owner: "@playdeck/react's `thumbnail` part",
    needle: 'translateX(-50%)'
  },
  {
    owner: "@playdeck/core's sprite media-fragment parser",
    needle: 'xywh='
  }
];

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

/** @param {string} entryKey @returns {Promise<string>} */
const closureScriptSource = async (entryKey) => {
  const files = [...staticClosure(entryKey)]
    .map((key) => manifest[key]?.file)
    .filter((file) => file !== undefined && file.endsWith('.js'));
  if (files.length === 0) {
    throw new Error(`${entryKey} has no JavaScript in its static closure.`);
  }
  return (
    await Promise.all(
      files.map((file) => readFile(new URL(file, root), 'utf8'))
    )
  ).join('\n');
};

const PLAIN_ENTRY = 'index.html';
const THUMBNAILS_ENTRY = 'with-thumbnails.html';
for (const entryKey of [PLAIN_ENTRY, THUMBNAILS_ENTRY]) {
  if (!manifest[entryKey]?.isEntry) {
    throw new Error(`The build emitted no entry for ${entryKey}.`);
  }
  const source = await closureScriptSource(entryKey);
  for (const { owner, needle } of PREVIEW_SIGNATURES) {
    if (source.includes(needle)) {
      throw new Error(
        `${owner} is in ${entryKey}'s static import closure (found ${JSON.stringify(needle)}); the preview must be reachable only through a dynamic import.`
      );
    }
  }
}

// The check above passes just as well against a build that dropped the
// feature altogether, so the code has to be found somewhere before its
// absence from the initial graph means anything.
const emitted = (await readdir(rootPath, { recursive: true })).filter((entry) =>
  entry.endsWith('.js')
);
const emittedSource = (
  await Promise.all(
    emitted.map((file) => readFile(new URL(file, root), 'utf8'))
  )
).join('\n');
for (const { owner, needle } of PREVIEW_SIGNATURES) {
  if (!emittedSource.includes(needle)) {
    throw new Error(
      `${owner} is in no emitted chunk at all (searched for ${JSON.stringify(needle)}); nothing above would prove laziness against a build that shipped no preview.`
    );
  }
}

/** @type {Record<string, string>} */
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.vtt': 'text/vtt'
};

// The sprite-cue fixtures the storybook workbench already owns, reached the
// way tests/bundle/no-build reaches `tracer.mp4` from the same directory:
// this fixture's claim is about which bytes load, not about the cue file, and
// a second copy of a sprite and its five timestamps would be one more place
// for the mapping between them to drift.
/** @type {Record<string, URL>} */
const fixtureAssets = {
  '/fixture.mp4': new URL('tracer-10s.mp4', storybookPublic),
  '/thumbnails.vtt': new URL('thumbnails.vtt', storybookPublic),
  '/thumbnails-sprite.svg': new URL('thumbnails-sprite.svg', storybookPublic)
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname =
      requestUrl.pathname === '/'
        ? '/index.html'
        : decodeURIComponent(requestUrl.pathname);
    const asset = fixtureAssets[pathname];
    const filePath = asset ? fileURLToPath(asset) : resolveInDist(pathname);
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

/** @param {string} pathname */
function resolveInDist(pathname) {
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
  return filePath;
}

await new Promise((resolve) =>
  server.listen(0, '127.0.0.1', () => resolve(undefined))
);

/** @type {import('@playwright/test').Browser | undefined} */
let browser;
try {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not resolve fixture server address.');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });

  /**
   * Every script the page requested, as `{ pathname, source }` -- read off
   * disk rather than off the response, so the bytes searched are the ones the
   * build emitted.
   * @param {string} page
   * @param {(page: import('@playwright/test').Page) => Promise<void>} drive
   */
  const requestedScripts = async (page, drive) => {
    /** @type {string[]} */
    const pathnames = [];
    const context = await browser.newPage();
    context.on('request', (request) => {
      if (request.resourceType() === 'script') {
        pathnames.push(new URL(request.url()).pathname);
      }
    });
    await context.goto(`${origin}${page}`);
    await drive(context);
    const sources = await Promise.all(
      pathnames.map((pathname) => readFile(resolveInDist(pathname), 'utf8'))
    );
    await context.close();
    return { pathnames, source: sources.join('\n') };
  };

  const slider = '[data-playdeck-part="seek-slider"]';
  const thumbnail = '[data-playdeck-part="thumbnail"]';

  // The no-prop page, hovered: the gesture that arms the preview on the page
  // below must not so much as fetch its module here.
  const plain = await requestedScripts('/', async (page) => {
    await page.locator(slider).waitFor();
    await page.hover(slider);
    // A hover starts no request on this page, so there is nothing to wait
    // for; a network round trip's worth of idling is what makes "never
    // requested" mean something rather than "not requested yet".
    await page.waitForLoadState('networkidle');
    if ((await page.locator(thumbnail).count()) !== 0) {
      throw new Error(
        'The no-prop page rendered a `thumbnail` part; the preview is not opt-in.'
      );
    }
  });
  for (const { owner, needle } of PREVIEW_SIGNATURES) {
    if (plain.source.includes(needle)) {
      throw new Error(
        `${owner} was downloaded by the no-prop page (found ${JSON.stringify(needle)} in ${plain.pathnames.join(', ')}).`
      );
    }
  }

  // The page that sets the prop reaches the same code, and renders with it.
  const withThumbnails = await requestedScripts(
    '/with-thumbnails.html',
    async (page) => {
      await page.locator(slider).waitFor();
      const box = await page.locator(slider).boundingBox();
      if (!box) throw new Error('The seek slider has no box to hover.');
      // 30% across a 10s window: 3s, inside thumbnails.vtt's 2-4s cue.
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
      await page
        .locator(`${thumbnail}[data-state="visible"]`)
        .waitFor({ timeout: 10_000 });
      const left = await page
        .locator(`${thumbnail} img`)
        .evaluate((image) => image.style.left);
      if (left !== '-160px') {
        throw new Error(
          `The previewed cue cropped to ${left}, not tile 1's -160px.`
        );
      }
    }
  );
  for (const { owner, needle } of PREVIEW_SIGNATURES) {
    if (!withThumbnails.source.includes(needle)) {
      throw new Error(
        `${owner} was never downloaded by the page that sets the prop (searched ${withThumbnails.pathnames.join(', ')} for ${JSON.stringify(needle)}).`
      );
    }
  }

  const lazyScripts = withThumbnails.pathnames.filter(
    (pathname) => !plain.pathnames.includes(pathname)
  );
  console.log(
    `OK: the preview is absent from the no-prop page (${plain.pathnames.length} scripts) and reached by dynamic import when the prop is set (${lazyScripts.join(', ') || 'no extra script'}).`
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined)))
    );
  }
}
