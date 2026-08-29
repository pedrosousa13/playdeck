import { defineConfig } from 'astro/config';

/**
 * The path this site is served from, which is `/` everywhere except the hosted
 * build: GitHub Pages serves a project site under `/<repo>/` and never from the
 * domain root, so every asset and internal link has to resolve against that
 * prefix or it reaches `pedrosousa13.github.io/<whatever>` — a different site's
 * root — and 404s (#435, #519).
 *
 * Deliberately the same environment variable `apps/storybook/.storybook/main.ts`
 * reads, rather than a second mechanism beside it. There is one question here —
 * "what prefix is this build served under?" — and one artifact now holds both
 * surfaces, so the two builds differ only in the value they are handed:
 * `.github/workflows/pages.yml` passes the Pages base path to this build and
 * that same path plus `storybook/` to the workbench build. Which prefix a build
 * gets is that file's business; reading it is this one's.
 *
 * Read from the environment rather than hard-coded, for the reason `main.ts`
 * gives: the value comes from `actions/configure-pages`, so the repository name
 * is stated nowhere in this tree and a custom domain later needs no edit here.
 * Leaving the default at `/` keeps `astro dev` and a local `astro build`
 * working against the domain root, which is what they are served from.
 */
const basePath = process.env.PLAYDECK_BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  // Astro's default, restated because it is a requirement rather than a
  // preference: GitHub Pages serves files and runs nothing, so a build that
  // quietly gained a server-rendered route would deploy broken (#519).
  output: 'static'
});
