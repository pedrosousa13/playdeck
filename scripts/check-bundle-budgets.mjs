import { fileURLToPath, URL } from 'node:url';
import { measureBundles, overBudget } from './bundle-budgets.mjs';

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

// A target whose ceiling is on a subset prints two rows, and the enforced one
// is the indented child rather than the headline. That order is the point: the
// headline stays the number a consumer downloads, so nobody has to know which
// of two figures is the real cost, and the row carrying `/ N KB` is the only
// one that can ever say OVER. Naming the subset on its own row is also what
// keeps `1.77 KB` from reading as a claim about the file.
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
    console.log(`${row(name, size, null)}  (shipped as authored, not gated)`);
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
// reason the measurement is: the landing page has to be able to say the figures
// it prints are the ones this rule is applied to. This file only formats the
// answer and throws on it.
const over = overBudget(measured);
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
