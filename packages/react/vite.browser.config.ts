import { defineConfig } from 'vite';

// Every provider package's own `dist/index.js`, plus `@playdeck/core` (which
// every provider and the entry itself import), gets a chunk name derived from
// its own package directory rather than a content hash. A hash exists to let a
// long-lived URL swap in new bytes without a stale cache; this build has no
// such URL, since npm and any CDN mirroring it version the whole package at
// once. A predictable name is also what lets scripts/bundle-budgets.mjs name a
// chunk instead of matching a hash that changes on every build.
const PACKAGE_CHUNK = /packages\/([\w-]+)\/dist\/index\.js$/;

// React's own modules, which land in a chunk of their own for the same reason
// `@playdeck/core` does: this entry and the thumbnail preview `SeekSlider`
// loads on demand (#727) are both React code, so Rollup factors out what they
// share. It is named on the same reasoning as the package chunks above --
// nothing versions these files but the package they ship in, and a name is
// what lets tests/bundle/no-build and scripts/bundle-budgets.mjs say which
// file they mean. Rolldown's own derived name for it is `jsx-runtime`, after
// whichever of React's entry points seeded the chunk, which is neither what
// the file holds nor stable against a change in how this entry imports React.
const REACT_MODULE = /node_modules\/react\//;

export default defineConfig({
  // The no-build entry ships as the final artifact a browser runs, not source
  // for another bundler to finish -- so unlike the default `.` build, which
  // leaves `react` external and lets the consumer's own bundler decide,
  // `process.env.NODE_ENV` has to be resolved here. Left unresolved, Rollup
  // cannot tell which half of React's own `if (process.env.NODE_ENV ===
  // 'production')` branch is dead, and ships both.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    lib: { entry: 'src/browser.ts', formats: ['es'], fileName: 'browser' },
    // A map for this file would inline or reference source for everything
    // bundled into it, React and ReactDOM included, and ran well past a
    // megabyte -- large enough that `scripts/verify-packaging.mjs` reading it
    // back out of the packed tarball overran `execFileSync`'s output buffer
    // and failed the build outright. The default `.` entry's own map stays
    // small because React is external there; this is the one build in the
    // package where that stops being true.
    sourcemap: false,
    // tsc -b emits declarations into dist incrementally; letting Vite empty
    // the directory on every build makes it silently drop them once tsc's
    // build cache decides there is nothing left to re-emit.
    emptyOutDir: false,
    rollupOptions: {
      // Only the native provider ships in this bundle -- HLS, YouTube, Vimeo
      // and Wistia stay external, exactly as they are for the default entry,
      // rather than pulled in and code-split the way native is. A build a
      // consumer loads with one `<script>` tag has no bundler to resolve those
      // bare specifiers from, so a source that needs one of them fails at the
      // point of use with an unresolved dynamic import; that is the honest
      // shape of the tradeoff, documented in the README, rather than a gap to
      // paper over.
      //
      // The alternative -- carrying every provider, the way the entry point
      // itself is bundled -- was tried first and reverted: hls.js and
      // `@vimeo/player` would ship inside `@playdeck/react`'s own tarball,
      // which every consumer downloads whether or not they load this entry.
      // It would also misrepresent the library's size to exactly the audience
      // this entry exists for: someone evaluating Playdeck from one HTML page
      // reads the number they download as the number it costs.
      external: [
        '@playdeck/provider-hls',
        '@playdeck/provider-vimeo',
        '@playdeck/provider-wistia',
        '@playdeck/provider-youtube'
      ],
      output: {
        chunkFileNames: (chunkInfo) => {
          // `@playdeck/core` is the one dependency shared between the entry
          // and every provider, so Rollup factors it into its own chunk with
          // no facade module of its own -- `facadeModuleId` is only set for a
          // chunk that IS an entry or a dynamic import's own root. Its single
          // module id stands in for the facade in that one case.
          const id =
            chunkInfo.facadeModuleId ??
            (chunkInfo.moduleIds.length === 1 ? chunkInfo.moduleIds[0] : null);
          const match = id?.match(PACKAGE_CHUNK);
          if (match) return `${match[1]}.js`;
          // Bundler-internal helper modules carry a synthetic id (`\0...`)
          // and belong to whatever real code they were emitted beside, so
          // they are not what decides a chunk's identity here.
          const authored = chunkInfo.moduleIds.filter(
            (moduleId) => !moduleId.startsWith('\0')
          );
          if (
            authored.length > 0 &&
            authored.every((moduleId) => REACT_MODULE.test(moduleId))
          ) {
            return 'react.js';
          }
          // Everything else keeps Rolldown's own derived name, and still no
          // hash: this build writes into a `dist` it never empties (see
          // `emptyOutDir` below), so a hashed chunk leaves its previous
          // copies behind on every change to it, which is how a stale
          // `assets/` accumulates in a package that ships `dist` whole.
          return 'assets/[name].js';
        }
      }
    }
  }
});
