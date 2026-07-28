import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@reely/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url)
      ),
      '@reely/react': fileURLToPath(
        new URL('./packages/react/src/index.tsx', import.meta.url)
      ),
      '@reely/provider-native': fileURLToPath(
        new URL('./packages/provider-native/src/index.ts', import.meta.url)
      ),
      '@reely/provider-hls': fileURLToPath(
        new URL('./packages/provider-hls/src/index.ts', import.meta.url)
      ),
      '@reely/provider-youtube': fileURLToPath(
        new URL('./packages/provider-youtube/src/index.ts', import.meta.url)
      ),
      '@reely/provider-vimeo': fileURLToPath(
        new URL('./packages/provider-vimeo/src/index.ts', import.meta.url)
      )
    }
  },
  test: {
    environment: 'happy-dom',
    // Vitest replaces CSS imports with empty strings by default, which would
    // make `theme.contract.test.ts`'s "the <style> carries the stylesheet"
    // assertion pass against nothing. Processed for that one file only.
    css: { include: [/theme\.css/] },
    include: [
      'packages/**/*.test.{ts,tsx}',
      'apps/storybook/stories/**/*.contract.test.ts'
    ],
    // Measured with `pnpm test --coverage`, not gated on. A threshold here
    // would say a number is the goal; the goal is that every load-bearing
    // branch has a test that dies without it, which a percentage cannot tell
    // you (#101 found six branches at 95% line coverage).
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**']
    }
  }
});
