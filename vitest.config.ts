import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      // `apps/site`'s own alias, the one `astro.config.ts`, its `tsconfig.json`
      // and `components.json` all declare, repeated here so a unit test can
      // import a component that uses it. Nothing outside that app writes
      // `@/`, so a single entry covers it.
      '@': fileURLToPath(new URL('./apps/site/src', import.meta.url)),
      '@playdeck/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url)
      ),
      '@playdeck/react': fileURLToPath(
        new URL('./packages/react/src/index.tsx', import.meta.url)
      ),
      '@playdeck/provider-native': fileURLToPath(
        new URL('./packages/provider-native/src/index.ts', import.meta.url)
      ),
      '@playdeck/provider-hls': fileURLToPath(
        new URL('./packages/provider-hls/src/index.ts', import.meta.url)
      ),
      '@playdeck/provider-youtube': fileURLToPath(
        new URL('./packages/provider-youtube/src/index.ts', import.meta.url)
      ),
      '@playdeck/provider-vimeo': fileURLToPath(
        new URL('./packages/provider-vimeo/src/index.ts', import.meta.url)
      ),
      '@playdeck/provider-wistia': fileURLToPath(
        new URL('./packages/provider-wistia/src/index.ts', import.meta.url)
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
      'apps/site/test/**/*.test.{ts,tsx}',
      'apps/storybook/stories/**/*.contract.test.ts',
      // Lives beside the module it tests (e2e/background-image-scan.ts): a
      // project that *imports* from another project needs that project to
      // emit declarations, and the `e2e` project deliberately does not
      // (`noEmit`, like `scripts` and `tests` — none of them are a type
      // source for anything else). Importing e2e/background-image-scan.ts
      // from apps/storybook instead errors with TS6310 ("Referenced project
      // may not disable emit"); the root tsconfig.json's own reference to
      // `./e2e` is build-order aggregation for `tsc -b`, not a type-consuming
      // import, so that one reference is unaffected. See
      // playwright.config.ts's `testIgnore` for how this file stays out of
      // Playwright's own collection.
      'e2e/*.contract.test.ts'
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
