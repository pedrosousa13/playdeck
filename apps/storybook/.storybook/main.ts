import { fileURLToPath, URL } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import remarkGfm from 'remark-gfm';
import type { PluginOption } from 'vite';
import { liveHlsFixture } from './live-playlist-plugin';

/**
 * Serves `/__reely__/pending.png` by never responding, so a poster image can
 * stay in its `loading` state deterministically without touching the network.
 * Only available on dev servers (`storybook dev`, Vitest browser mode); in a
 * static build the URL 404s and the image falls through to `error`.
 */
const pendingAssetPlugin = (): PluginOption => {
  const hang = () => {
    // Intentionally never respond and never call next().
  };
  return {
    name: 'reely-pending-asset',
    configureServer(server) {
      server.middlewares.use('/__reely__/pending.png', hang);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__reely__/pending.png', hang);
    }
  };
};

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
    plugins: [
      ...(viteConfig.plugins ?? []),
      pendingAssetPlugin(),
      liveHlsFixture()
    ],
    resolve: {
      ...viteConfig.resolve,
      alias: {
        ...viteConfig.resolve?.alias,
        '@reely/core': fileURLToPath(
          new URL('../../../packages/core/src/index.ts', import.meta.url)
        ),
        '@reely/provider-native': fileURLToPath(
          new URL(
            '../../../packages/provider-native/src/index.ts',
            import.meta.url
          )
        ),
        '@reely/provider-hls': fileURLToPath(
          new URL(
            '../../../packages/provider-hls/src/index.ts',
            import.meta.url
          )
        ),
        '@reely/provider-youtube': fileURLToPath(
          new URL(
            '../../../packages/provider-youtube/src/index.ts',
            import.meta.url
          )
        ),
        '@reely/provider-vimeo': fileURLToPath(
          new URL(
            '../../../packages/provider-vimeo/src/index.ts',
            import.meta.url
          )
        ),
        '@reely/provider-wistia': fileURLToPath(
          new URL(
            '../../../packages/provider-wistia/src/index.ts',
            import.meta.url
          )
        ),
        '@reely/react': fileURLToPath(
          new URL('../../../packages/react/src/index.tsx', import.meta.url)
        )
      }
    }
  })
};

export default config;
