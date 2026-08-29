import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

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
    define: {
      'import.meta.env.PLAYDECK_REPO_ROOT': JSON.stringify(repoRoot)
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
     */
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false
    }
  }
});
