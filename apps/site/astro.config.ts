import { defineConfig } from 'astro/config';

export default defineConfig({
  /**
   * The root, and nothing configurable behind it. This site is served from the
   * apex `playdeck.video`, and an apex has no prefix to resolve against, so
   * there is no question for a build to be handed an answer to (#519).
   *
   * `apps/storybook/.storybook/main.ts` still reads `PLAYDECK_BASE_PATH`, and
   * the asymmetry is the deployment's rather than an inconsistency: the
   * workbench is assembled one segment inside the same artifact, at
   * `/storybook/`, so its build does have to be told where it lands. This one
   * lands where it already defaults to.
   */
  base: '/',
  // Sitemap and canonical URLs, and deliberately not routing: `base` above is
  // what a link or an asset resolves against, and this changes neither.
  site: 'https://playdeck.video',
  // Astro's default, restated because it is a requirement rather than a
  // preference: the Cloudflare Worker behind `playdeck.video` serves static
  // assets and runs no code of this repository's, so a build that quietly
  // gained a server-rendered route would deploy broken (#519).
  output: 'static'
});
