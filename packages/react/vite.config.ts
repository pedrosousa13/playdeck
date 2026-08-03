import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: 'index' },
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        '@reely/core',
        '@reely/provider-hls',
        '@reely/provider-native',
        '@reely/provider-vimeo',
        '@reely/provider-wistia',
        '@reely/provider-youtube'
      ]
    },
    sourcemap: true,
    // tsc -b emits declarations into dist incrementally; letting Vite empty
    // the directory on every build makes it silently drop them once tsc's
    // build cache decides there is nothing left to re-emit.
    emptyOutDir: false
  }
});
