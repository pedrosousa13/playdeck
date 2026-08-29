import { fileURLToPath, URL } from 'node:url';
import { measureBundles } from './bundle-budgets.mjs';

// Matches scripts/verify-packaging.mjs: the lint config gives this directory
// node globals, but `console` still has to be reached through globalThis.
const console = globalThis.console;

// Enforces the initial-gzip bundle budgets from the MVP contract (issue #1).
// Without this, the budgets were prose: nothing failed when a package grew.
//
// What is measured and why is `bundle-budgets.mjs`'s to say. This file is the
// gate: it prints what that module measured and fails the build on a package
// that has outgrown its ceiling. The split exists because the landing page
// renders the same figures, and a page arguing that a number is enforced has to
// be reading the enforced number rather than a second copy of it.

// Resolved from this file's own URL rather than from `process.cwd()`, which is
// whatever directory the command was typed in. This script is never bundled, so
// its `import.meta.url` is where it actually lives.
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const measured = await measureBundles(repoRoot);

const column = Math.max(...measured.map(({ name }) => name.length));
for (const { name, size, budget } of measured) {
  const actual = `${size.toFixed(2)} KB`.padStart(9);
  if (budget === null) {
    console.log(`${name.padEnd(column)}  ${actual}  (lazy, not budgeted)`);
    continue;
  }
  const headroom = budget - size;
  const note =
    headroom >= 0
      ? `${headroom.toFixed(2)} KB headroom`
      : `${(-headroom).toFixed(2)} KB OVER`;
  console.log(
    `${name.padEnd(column)}  ${actual}  / ${String(budget).padStart(2)} KB   ${note}`
  );
}

// flatMap rather than filter+map: the filter already guarantees a budget, but
// only a narrowing form proves it to the reader and the typechecker alike.
const over = measured.flatMap(({ name, size, budget }) =>
  budget !== null && size > budget ? [{ name, size, budget }] : []
);
if (over.length > 0) {
  const detail = over
    .map(
      ({ name, size, budget }) =>
        `  ${name}: ${size.toFixed(2)} KB gzip exceeds its ${budget} KB budget by ${(size - budget).toFixed(2)} KB`
    )
    .join('\n');
  throw new Error(`Bundle budget exceeded (issue #1):\n${detail}`);
}

console.log('\nAll budgeted bundles are within their gzip budgets.');
