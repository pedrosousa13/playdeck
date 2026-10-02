import { defineConfig } from 'vite';

// `@playdeck/core/media-session`, built on its own rather than as a second
// entry of the build beside it -- the same shape `./thumbnails` takes
// (vite.thumbnails.config.ts), for the same reason: a consumer's dynamic
// `import()` of a subpath only moves bytes out of an eager chunk if that
// subpath is its own bundle, not a re-export sharing a chunk with
// `dist/index.js`.
//
// `@playdeck/react`'s `Root` reaches `bindMediaSession` and
// `getMediaSessionCoordinator` through a dynamic `import()` of this subpath
// from inside its mount effect, which never runs on the server or during
// render. Built separately, `dist/index.js` stays the file it already was --
// the binding and its coordinator inlined into it, tree-shaken by anyone who
// does not name them -- while this file gives that effect something to load
// without pulling in the rest of the eager graph.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/media-session.ts',
      formats: ['es'],
      fileName: 'media-session'
    },
    rollupOptions: { external: [] },
    sourcemap: true,
    // Emptying the directory here would delete the entry build that ran
    // before this one, declarations and all -- see vite.config.ts.
    emptyOutDir: false
  }
});
