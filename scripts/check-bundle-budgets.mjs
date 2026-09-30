import { fileURLToPath, URL } from 'node:url';
import { measureBundles, overBudget } from './bundle-budgets.mjs';

// Matches scripts/verify-packaging.mjs: the lint config gives this directory
// node globals, but `console` still has to be reached through globalThis.
const console = globalThis.console;

// Reports the initial-gzip bundle sizes from the MVP contract (issue #1)
// against each one's reference figure. It used to fail the build on a package
// that grew past its figure; the maintainer's ruling on issue #674 ended that
// — "make sure the package is lean but don't enforce limits ever" — so this
// file now only ever reports. What stays is the visibility: every run still
// prints the full table, headroom and an explicit OVER note included.
//
// What is measured and why is `bundle-budgets.mjs`'s to say. This file only
// prints what that module measured. The split exists because the landing page
// renders the same figures, and a page arguing that a number is watched has to
// be reading the watched number rather than a second copy of it.

// Resolved from this file's own URL rather than from `process.cwd()`, which is
// whatever directory the command was typed in. This script is never bundled, so
// its `import.meta.url` is where it actually lives.
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const measured = await measureBundles(repoRoot);

// A target whose reference figure is on a subset prints two rows, and the
// compared one is the indented child rather than the headline. That order is
// the point: the headline stays the number a consumer downloads, so nobody has
// to know which of two figures is the real cost, and the row carrying
// `/ N KB` is the only one that can ever say OVER. Naming the subset on its
// own row is also what keeps `1.77 KB` from reading as a claim about the file.
const column = Math.max(
  ...measured.map(({ name, budgeted }) =>
    budgeted === null
      ? name.length
      : Math.max(name.length, budgeted.label.length + 4)
  )
);

/**
 * @param {string} label
 * @param {number} size
 * @param {number | null} budget
 */
const row = (label, size, budget) => {
  const actual = `${size.toFixed(2)} KB`.padStart(9);
  if (budget === null) return `${label.padEnd(column)}  ${actual}`;
  const headroom = budget - size;
  const note =
    headroom >= 0
      ? `${headroom.toFixed(2)} KB headroom`
      : `${(-headroom).toFixed(2)} KB OVER`;
  return `${label.padEnd(column)}  ${actual}  / ${String(budget).padStart(3)} KB   ${note}`;
};

for (const { name, size, budget, budgeted } of measured) {
  if (budgeted !== null) {
    console.log(
      `${row(name, size, null)}  (shipped as authored; measured against the ${budgeted.label} row below)`
    );
    console.log(row(`  └ ${budgeted.label}`, budgeted.size, budget));
    continue;
  }
  if (budget === null) {
    console.log(`${row(name, size, null)}  (lazy, not budgeted)`);
    continue;
  }
  console.log(row(name, size, budget));
}

// Which targets are over is `bundle-budgets.mjs`'s to decide, for the same
// reason the measurement is: the landing page has to be able to say the
// figures it prints are the ones this note is about. This file only formats
// the answer — and, per issue #674, never exits over it. The per-row OVER
// marker printed above already carries this; the summary line below just
// says whether one fired, so a reader does not have to scan the table for it.
const over = overBudget(measured);
if (over.length > 0) {
  const detail = over
    .map(
      ({ name, size, budget }) =>
        `  ${name}: ${size.toFixed(2)} KB gzip is ${(size - budget).toFixed(2)} KB over its ${budget} KB reference figure`
    )
    .join('\n');
  console.log(
    `\n${over.length} bundle${over.length === 1 ? '' : 's'} over its reference figure (reporting only — this never fails the build):\n${detail}`
  );
} else {
  console.log('\nAll bundles are within their reference figures.');
}
