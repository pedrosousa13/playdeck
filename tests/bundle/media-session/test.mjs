// Locks in what `Root`'s Media Session mount effect already does
// (packages/react/src/root.tsx): the `@playdeck/core/media-session` chunk it
// reaches through a dynamic `import()` is absent from every entry's STATIC
// import closure, and is requested after mount in every `loading` strategy
// -- `eager`, `viewport` and `interaction` alike -- never gated behind the
// first play gesture. The mount effect's own dependency array
// (`[controller, sourceKeyForRender]`) names no `loading`, which is why this
// is one claim about all three pages rather than three unrelated ones.
//
// The static half follows tests/bundle/thumbnails/test.mjs's own static
// half: a manifest-walked closure searched for a signature string rather
// than a chunk name, because minification renames chunks but cannot rewrite
// a literal the source quotes unchanged. The runtime half follows that same
// file's runtime half: a real Chromium tracks which scripts a page actually
// requests, and the claim is checked against their bytes on disk rather than
// against a filename guess.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const console = globalThis.console;

const root = new URL('./dist/', import.meta.url);
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

// `'seekbackward'` is a literal `navigator.mediaSession.setActionHandler`
// argument inside `packages/core/src/media-session.ts`'s `wireHandlers`,
// and appears nowhere else in this fixture's build -- confirmed the same
// way tests/bundle/no-build/test.mjs's own comment about this string
// already settles it. It survives minification unchanged because a
// minifier may rename identifiers and requote strings, but not rewrite the
// text a `MediaSessionAction` string literal carries.
const MEDIA_SESSION_NEEDLE = 'seekbackward';

// The native provider's own chunk, resolved from the manifest rather than
// guessed by content: this build's three pages share enough code (core,
// `Root`, `provider-loaders.ts`) that Rollup factors it into one chunk every
// page's entry statically imports, and that shared chunk's own source
// contains the literal identifier `createNativeProvider` too -- the
// `const { createNativeProvider } = await import(...)` destructuring site
// inside `provider-loaders.ts`, not the provider's own implementation. A
// content needle therefore cannot tell "the provider's own code was
// requested" apart from "the always-loaded code that can request it was",
// the way `MEDIA_SESSION_NEEDLE` can for a string with no such call-site
// collision. The manifest key is resolved by a path fragment rather than
// pinned exactly, so it survives this fixture moving relative to the
// workspace root the same way `packageName` resolution elsewhere in this
// repo does.
const nativeProviderManifestEntry = Object.entries(manifest).find(([key]) =>
  key.endsWith('packages/provider-native/dist/index.js')
)?.[1];
if (!nativeProviderManifestEntry) {
  throw new Error(
    'The manifest has no entry for packages/provider-native/dist/index.js.'
  );
}
const NATIVE_PROVIDER_PATHNAME = `/${nativeProviderManifestEntry.file}`;

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

const ENTRY_KEYS = ['eager.html', 'viewport.html', 'interaction.html'];
for (const entryKey of ENTRY_KEYS) {
  if (!manifest[entryKey]?.isEntry) {
    throw new Error(`The build emitted no entry for ${entryKey}.`);
  }
  const source = await closureScriptSource(entryKey);
  if (source.includes(MEDIA_SESSION_NEEDLE)) {
    throw new Error(
      `@playdeck/core/media-session is in ${entryKey}'s static import closure (found ${JSON.stringify(MEDIA_SESSION_NEEDLE)}); it must be reachable only through a dynamic import.`
    );
  }
}

// The check above passes just as well against a build that dropped Media
// Session support altogether, so its absence from the initial graph has to
// be shown against a build that does carry the code somewhere.
const manifestFiles = [
  ...new Set(Object.values(manifest).map((entry) => entry.file))
].filter((file) => file.endsWith('.js'));
const emittedSource = (
  await Promise.all(
    manifestFiles.map((file) => readFile(new URL(file, root), 'utf8'))
  )
).join('\n');
if (!emittedSource.includes(MEDIA_SESSION_NEEDLE)) {
  throw new Error(
    `@playdeck/core/media-session is in no emitted chunk at all (searched for ${JSON.stringify(MEDIA_SESSION_NEEDLE)}); nothing above would prove laziness against a build that shipped no Media Session binding.`
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

const fixtureMp4 = new URL('tracer.mp4', storybookPublic);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const filePath =
      pathname === '/fixture.mp4'
        ? fileURLToPath(fixtureMp4)
        : new URL(`.${pathname}`, root);
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type':
        mime[extname(String(filePath))] ?? 'application/octet-stream'
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

/** @type {import('@playwright/test').Browser | undefined} */
let browser;
try {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not resolve fixture server address.');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });

  // `play-button`: `Player.PlayButton` renders unconditionally regardless of
  // `loading`, so it is a mount marker every one of the three pages shares.
  // `Player.ActivationButton` (`packages/react/src/loading-error.tsx`) is
  // the opposite -- it renders only `if (loading === 'interaction' &&
  // activation !== 'ready')`, so it exists on the interaction page alone,
  // which is exactly the page that needs it as a click target below: only
  // its click handler calls `activateFromInteraction`
  // (packages/react/src/use-activation.ts) and commits the source at all --
  // `PlayButton` merely toggles a playback that has to be committed first.
  const playButton = '[data-playdeck-part="play-button"]';
  const activationButton = '[data-playdeck-part="activation"]';

  /**
   * Loads `page` and waits for the play button to mount (proof the
   * component tree has committed), with no click performed. Returns every
   * script request made up to that point, by pathname, read back off disk.
   * @param {string} page
   */
  const scriptsRequestedByMount = async (page) => {
    /** @type {string[]} */
    const pathnames = [];
    const context = await browser.newPage();
    context.on('request', (request) => {
      if (request.resourceType() === 'script') {
        pathnames.push(new URL(request.url()).pathname);
      }
    });
    await context.goto(`${origin}${page}`);
    await context.locator(playButton).waitFor();
    // A network round trip's worth of idling is what makes "already
    // requested by mount" mean something rather than "not requested yet" --
    // the same reasoning tests/bundle/thumbnails/test.mjs's own hover case
    // already relies on.
    await context.waitForLoadState('networkidle');
    const sources = await Promise.all(
      pathnames.map(async (pathname) => {
        try {
          return await readFile(new URL(`.${pathname}`, root), 'utf8');
        } catch {
          return '';
        }
      })
    );
    await context.close();
    return { pathnames, source: sources.join('\n') };
  };

  for (const { page, loading } of [
    { page: '/eager.html', loading: 'eager' },
    { page: '/viewport.html', loading: 'viewport' }
  ]) {
    const { pathnames, source } = await scriptsRequestedByMount(page);
    if (!source.includes(MEDIA_SESSION_NEEDLE)) {
      throw new Error(
        `loading="${loading}": no script requested by mount carried @playdeck/core/media-session (searched ${pathnames.join(', ')} for ${JSON.stringify(MEDIA_SESSION_NEEDLE)}).`
      );
    }
    console.log(
      `OK: loading="${loading}" requested the media-session chunk by mount, with no click.`
    );
  }

  // `interaction` loading is the sharper case: it defers the native
  // provider's own import until the first gesture (packages/react/src/
  // use-activation.ts), so this is where "the Media Session chunk does not
  // wait for a gesture either" is actually distinguishable from "nothing
  // loads until a gesture". `provider-native` has to be visibly ABSENT at
  // mount for its later presence, after the click below, to mean anything.
  {
    const { pathnames: beforeClick, source: sourceBeforeClick } =
      await scriptsRequestedByMount('/interaction.html');
    const nativeProviderRequestedBeforeClick = beforeClick.includes(
      NATIVE_PROVIDER_PATHNAME
    );
    if (!sourceBeforeClick.includes(MEDIA_SESSION_NEEDLE)) {
      throw new Error(
        `loading="interaction": no script requested by mount (before any click) carried @playdeck/core/media-session (searched ${beforeClick.join(', ')} for ${JSON.stringify(MEDIA_SESSION_NEEDLE)}).`
      );
    }
    if (nativeProviderRequestedBeforeClick) {
      throw new Error(
        'loading="interaction": the native provider chunk was already requested before any click, so its absence below would prove nothing about the Media Session chunk being off the same path.'
      );
    }
    console.log(
      'OK: loading="interaction" requested the media-session chunk by mount, with no click and with the native provider chunk still unrequested.'
    );
  }

  // The click itself: proof this fixture's `interaction` page still plays,
  // the way tests/bundle/no-build/test.mjs's own click-and-play check does,
  // so the "off the path to first play" claim above is about a page that
  // actually reaches first play rather than one that never does.
  {
    const context = await browser.newPage();
    /** @type {string[]} */
    const pathnames = [];
    context.on('request', (request) => {
      if (request.resourceType() === 'script') {
        pathnames.push(new URL(request.url()).pathname);
      }
    });
    await context.goto(`${origin}/interaction.html`);
    const button = context.locator(activationButton);
    await button.waitFor();
    await button.click();
    const video = context.locator('video');
    await video.waitFor();
    const before = await video.evaluate(
      (/** @type {HTMLVideoElement} */ element) => element.currentTime
    );
    await context.waitForFunction(
      (previous) =>
        (globalThis.document.querySelector('video')?.currentTime ?? 0) >
        previous,
      before
    );
    if (!pathnames.includes(NATIVE_PROVIDER_PATHNAME)) {
      throw new Error(
        'loading="interaction": clicking play never requested the native provider chunk -- nothing above would prove it was gated behind the click rather than simply absent.'
      );
    }
    await context.close();
    console.log('OK: loading="interaction" still plays after the click.');
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
