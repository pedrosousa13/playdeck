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
 * The path the workbench is served from, which is `/` everywhere except a
 * build staged for the deployment: `apps/site` takes the root of
 * `playdeck.video` and the workbench sits one segment inside it, at
 * `/storybook/` (#519). Vite turns this into `import.meta.env.BASE_URL`, which
 * is what `stories/asset-url.ts` resolves the `staticDirs` fixtures against — a
 * root-absolute `/tracer.mp4` would ask the site's root for a clip that is not
 * there and 404 (#435).
 *
 * Read from the environment rather than hard-coded, for two reasons. Where the
 * workbench lands inside the artifact belongs to whoever assembles the
 * artifact, so `scripts/assemble-deploy.mjs` places the directory and the callers
 * that build for it pass the matching prefix; a literal here would be this
 * file's private copy of that decision and would go stale the first time the
 * layout moved. And the default of `/` is what keeps `storybook dev`, the
 * Vitest browser run and `ci.yml`'s `storybook` job building exactly what they
 * build today: each is served from a root, so none of them passes a value. The
 * callers that do pass one are the callers that stage the artifact —
 * `.github/workflows/deploy-site.yml`, and `scripts/check-deploy-artifact.mjs`,
 * which builds under the same prefix in order to prove the result loads under
 * it.
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
