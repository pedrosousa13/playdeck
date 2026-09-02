/**
 * The site's syntax colour, in one place, because two things ask for it and
 * they have to agree.
 *
 * `astro.config.ts` hands it to `markdown.shikiConfig`, which is what colours
 * the fences inside the package READMEs the reference pages render. Astro's
 * `<Code>` component — which `/archetypes` uses for the source wells it prints
 * beside its players, and `/start` for the compositions it prints from
 * `examples/` — reads none of that configuration: it takes its
 * own props and defaults to a single `github-dark` theme with
 * `defaultColor: 'light'`. So the page has to pass the same values, and a page
 * passing values it typed out itself would eventually colour one example
 * differently from every fence beside it, or lose `defaultColor: false` and
 * paint a dark block into a light page.
 *
 * What each value is for is `DESIGN.md`'s "Code, and the one exception to rule
 * 1" and `astro.config.ts`'s comment above the field: the colours below are the
 * only ones on this site that do not come from `tokens.css`, and
 * `defaultColor: false` is what leaves the choice between the two themes an
 * ordinary cascade decision that `base.css` makes with the same three-state
 * selector every other colour here uses.
 */

/**
 * Every token colour the two GitHub themes paint that does not meet WCAG AA on
 * this site's code-block ground, and what this site paints instead. The table
 * below is the count as well as the values; no prose here restates its length,
 * because a number written beside a list is a claim that goes stale the first
 * time the list moves.
 *
 * A code block here is a `--color-sunken` well and not the theme's own
 * background — `base.css` emits `--shiki-light-bg` and `--shiki-dark-bg` and
 * reads neither — so every published ratio for these themes is a ratio against
 * a ground this site does not use. Measured against `--color-sunken` with
 * `packages/react/test/contrast.ts`, four of `github-light`'s eight painted
 * colours and one of `github-dark`'s fell under the 4.5 that body text owes:
 * keywords at 4.04, comments at 4.25 and 4.00, `variable` at 3.08 and
 * `entity.name.tag` at 4.09. Comments are the worst of it in kind rather than
 * in number — the prose inside an example is what a reader reads most closely.
 *
 * ---- why not simply a different pair of themes ------------------------------
 *
 * Because the failure is not this pair's. GitHub ships two later answers to the
 * same question and both are tuned against `#ffffff`, which is not the ground
 * here: `github-light-default`'s comment colour `#6e7781` measures 4.55 on
 * white and 4.02 on `--color-sunken`, and even `github-light-high-contrast`'s
 * `#66707b` only reaches 4.45. Swapping wholesale would repaint every block on
 * the site and still leave the comment colour failing, so the smaller change is
 * also the only one of the two that works. What the site keeps is the palette a
 * reader of GitHub already knows; what it changes is the entries in it that
 * this ground cannot carry.
 *
 * ---- why these values -------------------------------------------------------
 *
 * Each holds its hue and moves only in lightness, which is what `DESIGN.md`'s
 * "Three values changed from the design comp" already does to three role
 * tokens for the same reason. The target is not the floor but the band the
 * theme's own passing accents already sit in — `#005cc5` at 5.56 and `#6f42c1`
 * at 5.75 in light, nothing below 7.25 in dark — so the block stays a palette
 * rather than becoming four hues darkened until a number went green.
 *
 * Light comments land on `#586069`, which `github-light` already paints for its
 * bracket highlighter, so the light palette gains no new neutral. `#cb2431` is
 * the one entry that clears its floor by less than its neighbours, at 4.83
 * against their 5.5: the next step down that hue is `#b31d28`, which is this
 * theme's own `invalid` and `message.error`, and a keyword that looks like an
 * error is a worse defect than a red sitting closer to its floor. Orange has to
 * travel furthest, `#e36209` to `#a04100`, because orange is the lightest of
 * these hues at any given lightness — which is also why it was the worst
 * failure in the table, at 3.08. Every entry holds its hue to within two
 * degrees; nothing here is a recolouring.
 *
 * The tables are in `DESIGN.md`'s "Measured contrast", beside the role tokens',
 * and `e2e/site-contrast.spec.ts` measures them from a served page on every
 * e2e run rather than trusting either this comment or that table.
 *
 * Keyed by the custom property rather than by the colour alone, because
 * `#6a737d` is the comment colour in *both* themes and the two have to move in
 * opposite directions: away from a near-white ground in light, away from a
 * near-black one in dark.
 */
const CONTRAST_FIXES: Record<string, Record<string, string>> = {
  '--shiki-light': {
    // `keyword`, `storage`, `storage.type`
    '#d73a49': '#cb2431',
    // `comment`, `punctuation.definition.comment`, `string.comment`
    '#6a737d': '#586069',
    // `variable`, the markdown list bullet, `markup.changed`
    '#e36209': '#a04100',
    // `entity.name.tag`, `markup.inserted`, `markup.quote`, regexp escapes
    '#22863a': '#176f2c'
  },
  '--shiki-dark': {
    // `comment`, `punctuation.definition.comment`, `string.comment`
    '#6a737d': '#959da5'
  }
};

/**
 * As much of Shiki's token as this file touches. Written out rather than
 * imported: `shiki` and `@shikijs/types` are Astro's dependencies and not this
 * package's, so nothing under `apps/site` can name `ThemedToken` — which is the
 * same reason the repaint is a transformer and not a theme object with
 * `colorReplacements` on it, since building one of those would mean importing
 * the bundled theme to add the field to.
 *
 * `htmlStyle` is what `defaultColor: false` produces: with neither theme baked
 * into a `color:` declaration, each token carries `--shiki-light` and
 * `--shiki-dark` and nothing else, and the values are the two themes' hexes
 * verbatim. The lookup below normalises case rather than assuming one, because
 * which case Shiki emits is its business and not a fact this file should have
 * to be right about — the table is written lower-case and the key is lowered to
 * match it, so either answer works and neither has to be checked.
 */
type PaintedToken = { htmlStyle?: Record<string, string> };

/**
 * The repaint, run once per code block at build time on both readers of
 * `shikiConfig`.
 *
 * `tokens` is the last hook before the tokens become HTML and the first one
 * after the two themes have been merged into one token apiece, so it is the one
 * place where both of a token's colours are in hand and neither has been
 * serialised yet. Mutating in place and returning nothing is deliberate:
 * Shiki replaces the token list when the hook returns one, and this changes two
 * strings on some tokens rather than producing a list.
 */
const repaintForContrast = {
  name: 'playdeck:syntax-contrast',
  tokens: (lines: PaintedToken[][]): void => {
    for (const line of lines)
      for (const token of line) {
        const style = token.htmlStyle;
        if (style === undefined) continue;
        for (const property of Object.keys(CONTRAST_FIXES)) {
          const painted = style[property];
          if (painted === undefined) continue;
          const repainted = CONTRAST_FIXES[property][painted.toLowerCase()];
          if (repainted !== undefined) style[property] = repainted;
        }
      }
  }
};

export const shikiConfig = {
  themes: { light: 'github-light', dark: 'github-dark' } as const,
  defaultColor: false as const,
  // Two narrow `as const`s above rather than one over the whole object: both
  // readers' types ask for a mutable `ShikiTransformer[]`, and an `as const`
  // here would freeze this array into a `readonly` tuple that neither accepts.
  transformers: [repaintForContrast]
};
