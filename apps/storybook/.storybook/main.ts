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
 * The path the workbench is served from. Vite turns this into
 * `import.meta.env.BASE_URL`, which is what `stories/asset-url.ts` resolves the
 * `staticDirs` fixtures against — a root-absolute `/tracer.mp4` would ask
 * whatever holds the root for a clip that is not there and 404 (#435).
 *
 * It is `/` for every caller in the repository. `storybook dev`, the Vitest
 * browser run and `ci.yml`'s `storybook` job are each served from a root, so
 * none of them passes a value, and nothing deploys the workbench for any of
 * them to pass one for (#534).
 *
 * Read from the environment rather than hard-coded even so, and that is the
 * decision this comment is here for. It is what lets a person build under a
 * prefix and check that no story has grown a root-absolute literal, which is a
 * defect nothing else in the repository can see; and it is this repository's
 * one answer to what prefix a build is served from, kept single deliberately
 * (#519). `README.md` carries both.
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
