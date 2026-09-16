// Shared with theme.test.ts (which strips its own comments and passes its own
// `theme.css` source) and tokens.contract.test.ts (which builds a combined
// theme.css + primitive-source corpus). Neither file owns this any more than
// the other, so it lives beside them rather than inside either.

/**
 * `source` with the contents of its first `@media (max-width: 48rem)` block
 * removed. Nothing in that block gives a token a second, phone-only fallback
 * today -- the docking layout that once did was reversed on 2026-09-04 once
 * the idle fade made the floating bar a sound phone layout on its own. Callers
 * exclude it defensively rather than folding the exclusion away: a future
 * phone-only override would otherwise make `tokenDefault` throw for the wrong
 * reason -- a second fallback found, rather than the cross-file disagreement
 * it exists to catch. A source with no such block (any non-CSS text included)
 * is returned unchanged.
 *
 * `theme.css` carries a second `@media (max-width: 48rem)` block further down
 * (the settings/captions menu's phone sheet), which this function's "first"
 * leaves in place. It needs no matching exclusion: every `var(--playdeck-*, ...)`
 * read inside it repeats a fallback already used elsewhere in the file (the
 * `--playdeck-radius-large`/`--playdeck-space-2` reads there match the base
 * rules'), and its one size override -- `min-block-size: 2.75rem` on
 * `menu-item`/`menu-radio-item` -- sets that property directly rather than
 * through `var()`. `tokenDefault`'s `var(--playdeck-NAME, ...)` regex does not
 * see either kind of declaration, stripped or not, so this block cannot be
 * the source of the "wrong reason" throw the first block is excluded against.
 */
export const withoutPhoneDockingBlock = (source: string): string => {
  const query = /@media\s*\(\s*max-width:\s*48rem\s*\)/.exec(source);
  if (query === null) return source;
  const start = query.index;
  let depth = 0;
  let end = source.indexOf('{', start);
  for (; end < source.length; end++) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}' && --depth === 0) break;
  }
  return source.slice(0, start) + source.slice(end + 1);
};

/**
 * The default a token is read with, taken from `source` rather than restated
 * by hand: editing a default without editing whatever checks it has to fail,
 * or the check drifts away from what ships. Every `var()` read of a token in
 * `source` has to agree on its fallback, so disagreement is itself a failure,
 * and so is a token `source` never reads with one at all. Walks nested parens
 * so a `rgb(...)`/`linear-gradient(...)` fallback is taken whole.
 *
 * `label` names what `source` is, for the error message only.
 */
export const tokenDefault = (
  source: string,
  name: string,
  label = 'the source'
): string => {
  const reads = new RegExp(`var\\(\\s*${name}\\s*,\\s*`, 'g');
  const defaults = new Set<string>();
  for (
    let read = reads.exec(source);
    read !== null;
    read = reads.exec(source)
  ) {
    const start = read.index + read[0].length;
    let depth = 1;
    let end = start;
    for (; end < source.length && depth > 0; end++) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')') depth--;
    }
    defaults.add(source.slice(start, end - 1).trim());
  }
  if (defaults.size !== 1)
    throw new Error(
      `${name}: expected one fallback default in ${label}, found ${
        defaults.size === 0 ? 'none' : [...defaults].join(' / ')
      }`
    );
  return [...defaults][0];
};
