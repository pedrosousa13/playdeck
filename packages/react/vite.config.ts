import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: 'index' },
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        '@playdeck/core',
        // Each of the two subpaths, named separately: an `external` entry is
        // an exact specifier match, so leaving either out would bundle it
        // into the chunk that imports it and publish a second copy of code
        // the consumer already resolves from `@playdeck/core`.
        '@playdeck/core/thumbnails',
        '@playdeck/core/media-session',
        '@playdeck/provider-hls',
        '@playdeck/provider-native',
        '@playdeck/provider-vimeo',
        '@playdeck/provider-wistia',
        '@playdeck/provider-youtube'
      ],
      output: {
        // Two chunks beside the entry: the thumbnail preview `SeekSlider`
        // loads on demand (#727), and the volume-request binding
        // `VolumeSlider`/the `Controls` shortcut layer load on demand
        // (`volume-request-lazy.ts`). Named rather than content-hashed, on
        // vite.browser.config.ts's reasoning for its own chunk names: a hash
        // exists to let a long-lived URL swap in new bytes, and nothing
        // versions these files but the package they ship in. A name is also
        // what lets something else say which file it means --
        // `tests/compare/features.mjs`'s thumbnail anchor reads one of them
        // by path.
        chunkFileNames: '[name].js'
      }
    },
    sourcemap: true,
    // tsc -b emits declarations into dist incrementally; letting Vite empty
    // the directory on every build makes it silently drop them once tsc's
    // build cache decides there is nothing left to re-emit.
    emptyOutDir: false
  }
});
