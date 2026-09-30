/*
 * A shape beside the word, for every cell of the comparison guide's feature
 * table (scope addition to #637). `docs/comparison/features.md` prints five
 * words -- `yes`, `partial`, `plugin`, `no`, `n/a` -- each with a footnote
 * reference, and this draws a small icon in front of the word without
 * touching the word: the markdown stays exactly as
 * `pnpm compare:features` generates it, and this reads the compiled HTML
 * `src/comparison-page.mjs`'s document renders into, after `renderMarkdown`
 * has already turned each `[^n]` into a real footnote link.
 *
 * That ordering -- after rendering, not before -- is why this is its own
 * module rather than a case in `comparison-page.mjs`'s own link rewriting: the
 * markdown text never contains a working footnote link, only the reference
 * that will become one, so a transform run on the markdown would have to
 * either reimplement the footnote it is standing next to or run before it
 * exists to be kept next to. Run on the rendered `<table>` instead, the
 * footnote link is already there and this only wraps the word beside it.
 *
 * Scoped to one table and nothing else. `iconizeFeaturesTable` finds the
 * `<table>` whose header names `Axis` -- the feature table's own first column,
 * unique to it -- and edits nothing outside it: not the results table, not a
 * paragraph, not a footnote definition at the foot of the document. The table
 * it edits is marked with its own class, `cmp-features`, so `doc.css`'s rules
 * for the icons reach only that one table and never the site's other rendered
 * documents.
 *
 * A word is never replaced, only wrapped: `data-status` carries the same
 * string the cell already read, `.cmp-status__word` still prints it at a
 * visible (if small) size, and the icon beside it is `aria-hidden` -- the
 * status is never colour or shape alone. `apps/site/DESIGN.md`'s "Palette"
 * section has the colour mapping and why a plugin answer and a partial one
 * share a colour but not a shape.
 *
 * Inline SVG, `currentColor`-based, and nothing else: no icon font and no new
 * dependency, matching every other graphic on this site (`Sweep.astro`'s
 * gradient, `packages/react`'s own icon set) being an inline `<svg>` rather
 * than a font glyph.
 */

/**
 * One tiny icon per status, sharing one 16x16 viewBox and drawn with
 * `currentColor` so `doc.css` can colour each by `data-status` in one place
 * rather than by editing markup here. `partial` and `plugin` are both drawn in
 * the same colour -- see `DESIGN.md` -- so their shapes are deliberately
 * unrelated: a half-filled circle for an answer the API has and the UI does
 * not, a plug for an answer that lives in a package outside this one.
 *
 * @type {Readonly<Record<'yes' | 'partial' | 'plugin' | 'no' | 'n/a', string>>}
 */
const ICONS = {
  yes: '<svg class="cmp-status__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  partial:
    '<svg class="cmp-status__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2a6 6 0 000 12z" fill="currentColor"/></svg>',
  plugin:
    '<svg class="cmp-status__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 1v4M11 1v4M4 5h8v2a4 4 0 01-4 4 4 4 0 01-4-4V5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  no: '<svg class="cmp-status__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  'n/a':
    '<svg class="cmp-status__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};

/** A whole `<table>…</table>`, captured so a non-matching one passes through untouched. */
const TABLE = /<table>[\s\S]*?<\/table>/g;

/**
 * A data cell holding nothing but one status word and, optionally, the
 * footnote link `renderMarkdown` already turned its `[^n]` reference into.
 * Anchored at both `<td>` and `</td>` with nothing else permitted between them
 * and the status word, so this can never match the axis-name column beside it
 * or a cell in any other table -- a cell's whole content has to be exactly one
 * of the five words for this to touch it.
 */
const STATUS_CELL =
  /<td>\s*(yes|partial|plugin|no|n\/a)\s*(<sup>[\s\S]*?<\/sup>)?\s*<\/td>/g;

/**
 * The features table, with each status cell's word wrapped in an icon and a
 * `data-status` it carries for `doc.css`. Every other table in `html` --
 * `docs/comparison/results.md`'s -- is returned exactly as it arrived.
 *
 * @param {string} html
 * @returns {string}
 */
export const iconizeFeaturesTable = (html) =>
  html.replace(TABLE, (table) => {
    if (!table.includes('>Axis<')) {
      return table;
    }
    return table
      .replace('<table>', '<table class="cmp-features">')
      .replace(STATUS_CELL, (_, status, footnote = '') => {
        const icon = ICONS[status];
        return `<td><span class="cmp-status" data-status="${status}">${icon}<span class="cmp-status__word">${status}</span></span>${footnote}</td>`;
      });
  });
