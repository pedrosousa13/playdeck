import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    // Array form, not the equivalent `Record<string, string>` shorthand: a
    // plain string `find` matches by *prefix* (`find` itself, or `find + '/'`),
    // so a bare `@playdeck/react` entry there also intercepts subpath imports
    // like `@playdeck/react/theme.css` and rewrites them against `index.tsx`,
    // 404ing (`BenchIsland.tsx` imports `@playdeck/react/theme.css?url` for a
    // `<link>` tag's `href`, which is what `seek-slider-order.contract.test.ts`
    // exercises by importing `BenchIsland.tsx`). `@playdeck/react` is the only
    // one of these packages with subpath exports to protect — the pnpm
    // workspace already symlinks `@playdeck/react` (and every other package
    // here) into `apps/site/node_modules`, and its `package.json` already maps
    // `./theme.css` and `./docked.css` to the real files, so once the alias
    // stops swallowing the subpath, plain Node resolution answers it with no
    // alias of its own needed. `/^@playdeck\/react$/`, anchored, is what
    // narrows the match to the bare specifier only.
    alias: [
      // `apps/site`'s own alias, the one `astro.config.ts`, its `tsconfig.json`
      // and `components.json` all declare, repeated here so a unit test can
      // import a component that uses it. Nothing outside that app writes
      // `@/`, so a single entry covers it.
      {
        find: '@',
        replacement: fileURLToPath(new URL('./apps/site/src', import.meta.url))
      },
      {
        find: '@playdeck/core',
        replacement: fileURLToPath(
          new URL('./packages/core/src/index.ts', import.meta.url)
        )
      },
      {
        find: /^@playdeck\/react$/,
        replacement: fileURLToPath(
          new URL('./packages/react/src/index.tsx', import.meta.url)
        )
      },
      {
        find: '@playdeck/provider-native',
        replacement: fileURLToPath(
          new URL('./packages/provider-native/src/index.ts', import.meta.url)
        )
      },
      {
        find: '@playdeck/provider-hls',
        replacement: fileURLToPath(
          new URL('./packages/provider-hls/src/index.ts', import.meta.url)
        )
      },
      {
        find: '@playdeck/provider-youtube',
        replacement: fileURLToPath(
          new URL('./packages/provider-youtube/src/index.ts', import.meta.url)
        )
      },
      {
        find: '@playdeck/provider-vimeo',
        replacement: fileURLToPath(
          new URL('./packages/provider-vimeo/src/index.ts', import.meta.url)
        )
      },
      {
        find: '@playdeck/provider-wistia',
        replacement: fileURLToPath(
          new URL('./packages/provider-wistia/src/index.ts', import.meta.url)
        )
      }
    ]
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
