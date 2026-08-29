/**
 * The site's syntax colour, in one place, because two things ask for it and
 * they have to agree.
 *
 * `astro.config.ts` hands it to `markdown.shikiConfig`, which is what colours
 * the fences inside the package READMEs the reference pages render. Astro's
 * `<Code>` component — which the landing page uses to render a real file from
 * `examples/` — reads none of that configuration: it takes its own props and
 * defaults to a single `github-dark` theme with `defaultColor: 'light'`. So the
 * page has to pass the same values, and a page passing values it typed out
 * itself would eventually colour one example differently from every fence
 * beside it, or lose `defaultColor: false` and paint a dark block into a light
 * page.
 *
 * What each value is for is `DESIGN.md`'s "Code, and the one exception to rule
 * 1" and `astro.config.ts`'s comment above the field: the two theme names are
 * the only colours on this site that do not come from `tokens.css`, and
 * `defaultColor: false` is what leaves the choice between them an ordinary
 * cascade decision that `base.css` makes with the same three-state selector
 * every other colour here uses.
 */
export const shikiConfig = {
  themes: { light: 'github-light', dark: 'github-dark' },
  defaultColor: false
} as const;
