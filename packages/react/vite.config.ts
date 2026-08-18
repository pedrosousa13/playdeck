import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: 'index' },
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        '@playdeck/core',
        '@playdeck/provider-hls',
        '@playdeck/provider-native',
        '@playdeck/provider-vimeo',
        '@playdeck/provider-wistia',
        '@playdeck/provider-youtube'
      ]
    },
    sourcemap: true,
    // tsc -b emits declarations into dist incrementally; letting Vite empty
    // the directory on every build makes it silently drop them once tsc's
    // build cache decides there is nothing left to re-emit.
    emptyOutDir: false
  }
});
