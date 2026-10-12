import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// This package's own `src/` -- every file in it (`entry.tsx`,
// `jsx-runtime-18.ts`, `react-shim-18.ts`, `shim-shared.ts`) imports the real
// `react`/`react/jsx-runtime`/`react/jsx-dev-runtime` unaliased, never the
// shims below. Checked by directory rather than by naming each file, so a
// shim added later is exempt the same way without the plugin needing to
// know its name.
const OWN_SRC_DIR = fileURLToPath(new URL('./src/', import.meta.url));
const JSX_SHIM_PATH = fileURLToPath(
  new URL('./src/jsx-runtime-18.ts', import.meta.url)
);
const REACT_SHIM_PATH = fileURLToPath(
  new URL('./src/react-shim-18.ts', import.meta.url)
);

const ALIASED_JSX_SPECIFIERS = new Set([
  'react/jsx-runtime',
  'react/jsx-dev-runtime'
]);

// A plugin rather than `resolve.alias`, because the alias has to be
// conditional on *who is asking*: every module `../react/src` compiles down
// to a `jsx`/`jsxs`/`jsxDEV` call that imports `react/jsx-runtime` (or
// `react/jsx-dev-runtime`), and a `createElement` call that imports `react`
// directly -- see `react-shim-18.ts`'s header for why `../react/src` compiles
// to `createElement` at all for one element. All of those need to resolve to
// this package's own shims; this package's OWN shim/entry files, importing
// the same specifiers to reach the real implementations underneath, must
// not. `resolve.alias` has no notion of the importer; this hook does.
const react18Shims = (): Plugin => ({
  name: 'playdeck-react-18-shims',
  enforce: 'pre',
  resolveId(source, importer) {
    const isOwnSrc = importer?.startsWith(OWN_SRC_DIR) ?? false;

    if (ALIASED_JSX_SPECIFIERS.has(source)) {
      // `rollupOptions.external` can't express "external, but only for this
      // importer": Rolldown resolves any specifier listed there natively,
      // without ever invoking a plugin's `resolveId`, so these two
      // specifiers have to stay OUT of that array entirely (see below) and
      // be externalized here instead, per importer.
      if (isOwnSrc) return { id: source, external: true };
      return JSX_SHIM_PATH;
    }

    if (source === 'react') {
      if (isOwnSrc) return { id: source, external: true };
      return REACT_SHIM_PATH;
    }

    return null;
  }
});

export default defineConfig({
  plugins: [react18Shims()],
  build: {
    lib: { entry: 'src/entry.tsx', formats: ['es'], fileName: 'index' },
    rollupOptions: {
      // Identical to packages/react/vite.config.ts's own list -- see that
      // file for why each of @playdeck/core's two subpaths is named
      // separately. `react`, `react/jsx-runtime` and `react/jsx-dev-runtime`
      // are deliberately NOT listed here, even though all three stay
      // external in the published output: see `react18Shims` above for why
      // this array would make it dead code for every importer, not only for
      // the shims' own.
      external: [
        '@playdeck/core',
        '@playdeck/core/thumbnails',
        '@playdeck/core/media-session',
        '@playdeck/provider-hls',
        '@playdeck/provider-native',
        '@playdeck/provider-vimeo',
        '@playdeck/provider-wistia',
        '@playdeck/provider-youtube'
      ],
      output: {
        chunkFileNames: '[name].js'
      }
    },
    sourcemap: true,
    emptyOutDir: false
  }
});
