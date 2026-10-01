// Proves the bundle criterion issue #859 names: importing only
// `resolveYouTubePosterUrl` must not pull `@playdeck/provider-youtube`'s
// attachment/boundary/playback/presentation/text-tracks/time-updates
// machinery, or its iframe API loader, into a consumer's bundle.
//
// A static check over the built output rather than a Playwright run, because
// the claim is about what a bundler emits -- `tests/bundle/native-only` and
// `tests/bundle/no-build` drive a real browser because their claims are
// about what a page requests at runtime; this one is already settled once
// the bytes are on disk. Two needles, the same shape
// `tests/bundle/thumbnails/test.mjs` uses for the same reason: each survives
// a production minifier (esbuild renames identifiers and rewrites quotes, but
// leaves string-literal contents alone), so a match is not an artefact of
// unminified output.
//
// Demonstrated red (docs/agents/demonstrated-red.md), additive feature, so
// the mutation fallback: with `src/main.ts` temporarily edited to also call
// `createYouTubeProvider(document.createElement('div'), 'dQw4w9WgXcQ')`
// alongside `resolveYouTubePosterUrl`, the build's single JS asset grew from
// 6.35 kB (gzip 2.27 kB) to 22.71 kB (gzip 7.81 kB) and this file's own
// `node test.mjs` failed with the exact error the leak check below raises:
// `Error: The YouTube iframe API loader leaked into a bundle that imports
// only resolveYouTubePosterUrl (found 'iframe_api').` Reverted, the build is
// back to the single 6.35 kB asset and this file passes.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const root = new URL('./dist/', import.meta.url);

const assetFiles = (await readdir(new URL('./assets/', root))).filter((file) =>
  file.endsWith('.js')
);
if (assetFiles.length === 0) {
  throw new Error('The consumer build emitted no JS asset to check.');
}

const sources = (
  await Promise.all(
    assetFiles.map((file) =>
      readFile(fileURLToPath(new URL(file, new URL('./assets/', root))), 'utf8')
    )
  )
).join('\n');

// Sanity: the helper itself must actually be in the bundle, or the absence
// checks below would pass for the trivial reason that nothing shipped at all.
if (!sources.includes('hqdefault.jpg')) {
  throw new Error('resolveYouTubePosterUrl (used) did not ship in the bundle.');
}

// `loader.ts`'s script URL for the IFrame Player API -- present only if the
// loader module reached the bundle, which it does only through
// `createYouTubeProvider` or the loader exports, neither of which this
// fixture imports.
if (sources.includes('https://www.youtube.com/iframe_api')) {
  throw new Error(
    "The YouTube iframe API loader leaked into a bundle that imports only resolveYouTubePosterUrl (found 'iframe_api')."
  );
}

// `loader.ts`'s own guard message -- a second, independent needle from the
// same module, in case a future refactor moves the URL literal elsewhere
// without this check noticing.
if (
  sources.includes('The YouTube iframe API requires a browser environment.')
) {
  throw new Error(
    'The YouTube iframe API loader leaked into a bundle that imports only resolveYouTubePosterUrl.'
  );
}
