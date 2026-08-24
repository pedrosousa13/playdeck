import { fileURLToPath, URL } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import remarkGfm from 'remark-gfm';
import type { PluginOption } from 'vite';
import { liveHlsFixture } from './live-playlist-plugin';

/**
 * Serves `/__playdeck__/pending.png` by never responding, so a poster image can
 * stay in its `loading` state deterministically without touching the network.
 * Only available on dev servers (`storybook dev`, Vitest browser mode); in a
 * static build the URL 404s and the image falls through to `error`.
 */
const pendingAssetPlugin = (): PluginOption => {
  const hang = () => {
    // Intentionally never respond and never call next().
  };
  return {
    name: 'playdeck-pending-asset',
    configureServer(server) {
      server.middlewares.use('/__playdeck__/pending.png', hang);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__playdeck__/pending.png', hang);
    }
  };
};

/**
 * The path the workbench is served from, which is `/` everywhere except the
 * hosted build: GitHub Pages serves a project site under `/<repo>/` and never
 * from the domain root. Vite turns this into `import.meta.env.BASE_URL`, which
 * is what `stories/asset-url.ts` resolves the `staticDirs` fixtures against —
 * a root-absolute `/tracer.mp4` reaches `pedrosousa13.github.io/tracer.mp4`,
 * which is a different site's root and 404s (#435).
 *
 * Read from the environment rather than hard-coded, for two reasons.
 * `.github/workflows/pages.yml` takes the value from
 * `actions/configure-pages`, so the repository name is stated nowhere in this
 * tree. And leaving the default at `/` keeps `storybook dev`, the Vitest
 * browser run and `ci.yml`'s `storybook` job byte-identical to what they build
 * today — the deploy is the only caller that sets it.
 */
const basePath = process.env.PLAYDECK_BASE_PATH ?? '/';

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.tsx'],
  staticDirs: ['../public'],
  addons: [
    '@storybook/addon-a11y',
    {
      name: '@storybook/addon-docs',
      options: {
        // Enable GFM so MDX tables (e.g. the capabilities matrix) render.
        mdxPluginOptions: {
          mdxCompileOptions: {
            remarkPlugins: [remarkGfm]
          }
        }
      }
    },
    '@storybook/addon-vitest'
  ],
  framework: '@storybook/react-vite',
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    base: basePath,
    plugins: [
      ...(viteConfig.plugins ?? []),
      pendingAssetPlugin(),
      liveHlsFixture()
    ],
    resolve: {
      ...viteConfig.resolve,
      alias: {
        ...viteConfig.resolve?.alias,
        '@playdeck/core': fileURLToPath(
          new URL('../../../packages/core/src/index.ts', import.meta.url)
        ),
        '@playdeck/provider-native': fileURLToPath(
          new URL(
            '../../../packages/provider-native/src/index.ts',
            import.meta.url
          )
        ),
        '@playdeck/provider-hls': fileURLToPath(
          new URL(
            '../../../packages/provider-hls/src/index.ts',
            import.meta.url
          )
        ),
        '@playdeck/provider-youtube': fileURLToPath(
          new URL(
            '../../../packages/provider-youtube/src/index.ts',
            import.meta.url
          )
        ),
        '@playdeck/provider-vimeo': fileURLToPath(
          new URL(
            '../../../packages/provider-vimeo/src/index.ts',
            import.meta.url
          )
        ),
        '@playdeck/provider-wistia': fileURLToPath(
          new URL(
            '../../../packages/provider-wistia/src/index.ts',
            import.meta.url
          )
        ),
        '@playdeck/react': fileURLToPath(
          new URL('../../../packages/react/src/index.tsx', import.meta.url)
        )
      }
    }
  })
};

export default config;
