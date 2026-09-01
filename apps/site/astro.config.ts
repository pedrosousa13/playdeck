import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { shikiConfig } from './src/shiki';

/*
 * Where the repository starts, resolved from this file rather than from the
 * working directory. The reference pages ask `scripts/workspace-packages.mjs`
 * which packages are publishable and it needs an absolute root to run
 * `pnpm list -r` in, so the answer has to be one a build cannot get wrong.
 * `process.cwd()` is whatever directory the command was typed in — right under
 * `pnpm --filter` and under turbo, wrong under anything else — while a config
 * file's own URL is fixed by where the file is. Astro resolves `base` in
 * `src/content.config.ts` against the project root for the same reason.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

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
  /**
   * React, for the routes that mount a player. Playdeck is a React library and
   * pages arguing for it that showed no player would be arguing from
   * description alone, so the renderer is here to make those claims
   * demonstrable rather than to open the site to components in general.
   *
   * Two routes carry one: `src/pages/index.astro` mounts the hero, whose island
   * renders the player and the capability ledger reading it, and
   * `src/pages/archetypes.astro` mounts the two composed archetypes beside the
   * source of each. Every `client:` directive in the site is on one of those
   * two pages and every one of them is `client:only` — see
   * `src/components/HeroPlayer.astro` for why that rather than a hydrating
   * variant.
   *
   * Registering the integration costs nothing by itself. Astro ships a renderer
   * only to a page that mounts an island, so every other route in this build
   * stays what it was: HTML, CSS, the inline theme and rail scripts, and the
   * search module.
   */
  integrations: [react()],
  // Sitemap and canonical URLs, and deliberately not routing: `base` above is
  // what a link or an asset resolves against, and this changes neither.
  site: 'https://playdeck.video',
  // Astro's default, restated because it is a requirement rather than a
  // preference: the Cloudflare Worker behind `playdeck.video` serves static
  // assets and runs no code of this repository's, so a build that quietly
  // gained a server-rendered route would deploy broken (#519).
  output: 'static',
  // Substituted into the frontmatter that reads it, so the value is a build-time
  // constant rather than something the page discovers at runtime. It is under
  // `import.meta.env` rather than a bare global so that it reads as build
  // configuration at the point of use, alongside `BASE_URL`, which is the other
  // thing a page there gets from this file.
  vite: {
    // Build-time only: Tailwind's Vite plugin scans source files and emits
    // CSS during `astro build`/`astro dev`, and nothing it produces makes a
    // network request of its own. `src/styles/tailwind.css` is the file that
    // actually decides what ships — see its own comment for why Preflight is
    // excluded and why what remains is layered under this site's existing
    // stylesheets rather than fighting them.
    plugins: [tailwindcss()],
    define: {
      'import.meta.env.PLAYDECK_REPO_ROOT': JSON.stringify(repoRoot)
    },
    resolve: {
      /*
       * Where `@playdeck/react` is, stated once for every importer rather than
       * left to a walk up the directory tree.
       *
       * `/archetypes` mounts two compositions that live in `examples/`, and a
       * bare specifier resolves from the importing file's own directory: the
       * walk up from `examples/` never reaches `apps/site/node_modules`, where
       * the workspace link to this package is, so the resolver fell through to
       * the `paths` entry in `examples/tsconfig.json` and handed the bundler a
       * `.d.ts` — a declaration file, with no code in it and no sibling modules
       * to follow. That is the failure this replaces, and it was a build error
       * rather than something subtle.
       *
       * The target is the built ESM entry, which is what the package's own
       * `exports` field already resolves `.` to, so nothing changes for the
       * hero island in `src/` that was resolving through `node_modules`.
       *
       * A `RegExp` anchored at both ends, deliberately. A string `find` is a
       * prefix match, and `@playdeck/react/theme.css` — the stylesheet
       * `HeroPlayer.astro` imports — would be rewritten into a path inside
       * `dist/` that does not exist.
       */
      alias: [
        {
          find: /^@playdeck\/react$/,
          replacement: fileURLToPath(
            new URL('../../packages/react/dist/index.js', import.meta.url)
          )
        },
        // `@/*` -> `src/*`, the alias shadcn's own tooling assumes and
        // `components.json` declares. Nothing under `src/` needed one before
        // this; it exists now so a component added by that tooling in phase 2
        // resolves its sibling imports the way the tool that generated it
        // expects, rather than everyone hand-rewriting them to relative paths.
        {
          find: /^@\//,
          replacement: fileURLToPath(new URL('./src/', import.meta.url))
        }
      ]
    }
  },
  markdown: {
    /*
     * Syntax colour for the package READMEs the reference pages render, from
     * the highlighter Astro already ships. No new dependency, and nothing that
     * touches the text: Shiki tokenises and wraps, so the characters inside a
     * fence come out as they went in. That matters more here than it usually
     * does, because `scripts/docs-examples.mjs` generates those fences from
     * real files in `examples/` and `pnpm docs:check` compares them byte for
     * byte — a highlighter that re-indented or re-wrapped would put the site
     * and the gate into disagreement about what the example is.
     *
     * `defaultColor: false` is the whole reason both themes work here. What it
     * changes about the emitted markup was read off the Shiki that `astro`
     * 7.2.9 ships, which is the exact version `package.json` pins rather than a
     * range, so the upgrade that moves that pin is the moment to re-read this.
     * Left at its default, Shiki writes one theme's colours into a `color:`
     * declaration
     * on every span and leaves the other theme's in a `--shiki-dark` custom
     * property, which a stylesheet can then only reach past with `!important`.
     * Turned off, neither theme is privileged: every span carries
     * `--shiki-light` and `--shiki-dark` and nothing else, and which one is
     * spent is an ordinary cascade decision that `base.css` makes with the same
     * three-state selector `tokens.css` uses for every other colour on this
     * site. That is what lets a reader's explicit choice beat the operating
     * system in both directions, which the media query Astro's documented dual
     * theme CSS reaches for cannot do on its own.
     *
     * The values themselves live in `src/shiki.ts` because Astro's `<Code>`
     * component reads nothing from here, and the landing page uses it to render
     * a real file from `examples/`. That file explains why the two readers
     * cannot be allowed to drift.
     */
    shikiConfig
  }
});
