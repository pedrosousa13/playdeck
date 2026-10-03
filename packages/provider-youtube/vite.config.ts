import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: {
      // `./time-boundary` named separately from `@playdeck/core`: an
      // `external` entry is an exact specifier match, so leaving it out
      // would bundle the boundary into this provider's own chunk instead of
      // resolving it from the subpath `@playdeck/core` already publishes it
      // from.
      external: ['@playdeck/core', '@playdeck/core/time-boundary']
    },
    sourcemap: true,
    // tsc -b emits declarations into dist incrementally; letting Vite empty
    // the directory on every build makes it silently drop them once tsc's
    // build cache decides there is nothing left to re-emit.
    emptyOutDir: false
  }
});
