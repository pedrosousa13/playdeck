import { defineConfig } from 'vite';

// `@playdeck/core/time-boundary`, built on its own rather than as a second
// entry of the build beside it -- the same shape `./thumbnails` and
// `./media-session` already take, for the same reason: a consumer reaching
// this file through its own import, rather than through `dist/index.js`'s
// re-export of it, only keeps the two decoupled if the subpath is its own
// bundle.
//
// The three embed providers (`@playdeck/provider-vimeo`,
// `@playdeck/provider-wistia`, `@playdeck/provider-youtube`) import
// `createTimeBoundary` from this subpath rather than from `@playdeck/core`'s
// main entry. Each provider's own dist file is reached only through a
// dynamic `import()` from `@playdeck/react`'s provider loader, and that
// loader dynamically imports all five provider kinds from the one file that
// wires them up, so every one of those five dist files -- the native
// provider's included -- ends up a sibling chunk of whatever app build
// bundles them, all depending on `@playdeck/core`. A consumer composition
// that never loads an embed provider still builds every provider's dist
// file into that same graph, because which provider actually loads depends
// on a source url a bundler cannot evaluate ahead of time. Where
// `createTimeBoundary` was reached only through `@playdeck/core`'s main
// entry, a bundler that places that entry's module inside the composition's
// own eager chunk -- because the eager chunk needs other bindings from it
// too -- has to make the eager chunk re-export whatever the sibling provider
// chunks import from the same module, including this one, even in a
// composition that never resolves an embed provider's dynamic import at
// runtime. Built as its own bundle, this subpath is a separate module the
// eager chunk never has reason to hold, so a provider's own need for it stays
// inside that provider's own chunk.
//
// `dist/index.js` stays the file it already was: the boundary inlined into
// it, tree-shaken by anyone who does not name it, the same way `./thumbnails`
// and `./media-session` work today. The cost is one copy of the boundary in
// each file, so a consumer who imports `createTimeBoundary` from
// `@playdeck/core` AND composes an embed provider ships it twice.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/time-boundary.ts',
      formats: ['es'],
      fileName: 'time-boundary'
    },
    rollupOptions: { external: [] },
    sourcemap: true,
    // Emptying the directory here would delete the entry build that ran
    // before this one, declarations and all -- see vite.config.ts.
    emptyOutDir: false
  }
});
