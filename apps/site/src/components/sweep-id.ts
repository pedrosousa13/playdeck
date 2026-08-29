// One counter for the whole build, so that every `<linearGradient>` this site
// emits carries an id no other one on the page can hold. Two elements sharing
// an id is invalid, and the second `url(#…)` reference resolves to the first
// element rather than to its own — silent today, because both sweeps are the
// same gradient, and a wrong fill the moment they are not.
//
// The counter lives in a module rather than in `Sweep.astro`'s frontmatter
// because frontmatter runs once per instance: a `let` there would be reset to
// its initial value by the very second render it needs to count.
let rendered = 0;

export const nextSweepId = (): string => `chroma-sweep-${(rendered += 1)}`;
