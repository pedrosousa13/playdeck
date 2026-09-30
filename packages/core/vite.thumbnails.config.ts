import { defineConfig } from 'vite';

// `@playdeck/core/thumbnails`, built on its own rather than as a second entry
// of the build beside it -- the same shape `@playdeck/react` gives its
// `./browser` subpath, and here for a reason worth writing down.
//
// The subpath exists so `@playdeck/react`'s `SeekSlider` can reach the
// sprite-cue parser from the chunk it loads only when a consumer sets
// `thumbnails` (#727). Two entries in one build would defeat that on some
// bundlers: Rollup would give the parser one module and have `dist/index.js`
// re-export from it, so every graph that imports `@playdeck/core` at all
// carries an import edge to the parser's file. Rolldown drops that edge when
// nothing uses the symbols; esbuild does not, and links the parser's chunk
// into the entry regardless -- measured while #727 was being built, where it
// put 0.75 KB of parser into every Playdeck composition's eager graph,
// including the ones that render no seek slider.
//
// Built separately, `dist/index.js` is byte for byte the file it was before
// the subpath existed: the parser inlined into it, tree-shaken by anyone who
// does not name it. The cost is one copy of the parser in each file, so a
// consumer who imports `parseThumbnailCues` from `@playdeck/core` AND renders
// a thumbnail preview ships it twice -- half a kilobyte, against the
// alternative of every consumer of either paying for it once whether or not
// they use it.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/thumbnails.ts',
      formats: ['es'],
      fileName: 'thumbnails'
    },
    rollupOptions: { external: [] },
    sourcemap: true,
    // Emptying the directory here would delete the entry build that ran
    // before this one, declarations and all -- see vite.config.ts.
    emptyOutDir: false
  }
});
