import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

// Matches scripts/verify-packaging.mjs: the lint config gives this directory
// node globals, but `console` still has to be reached through globalThis.
const console = globalThis.console;

// Enforces the initial-gzip bundle budgets from the MVP contract (issue #1).
// Without this, the budgets were prose: nothing failed when a package grew.
//
// What is measured, and why it is not exactly what the contract says:
//
// The contract budgets "selected React primitives" — a consumer's chosen
// subset, not the whole package. Measuring a real consumer's closure needs a
// fixture per selection, and tests/bundle/native-only cannot serve as one
// because it must run in a browser, so React is bundled into its single chunk
// and cannot be subtracted.
//
// Instead this measures the ENTIRE built package with React, JSX runtime, core
// and every provider external. That is a strictly stronger guarantee than the
// contract asks for: if the whole primitives surface fits the budget, any
// selected subset does too. It is also stable — no bundler heuristics, no
// fixture to keep in sync.
//
// Provider adapters are reported, never gated: the contract says provider
// chunks are accounted for separately, and they are lazily loaded, so they do
// not compete for the initial-graph budget.

const KB = 1024;

const gzipKilobytes = async (path) => {
  const source = await readFile(new URL(path, import.meta.url));
  return gzipSync(source).length / KB;
};

// `budget: null` means report-only.
const targets = [
  { name: '@reely/core', path: '../packages/core/dist/index.js', budget: 10 },
  {
    name: '@reely/react (primitives, excl. React)',
    path: '../packages/react/dist/index.js',
    budget: 18
  },
  {
    // Shipped as-is rather than built: it is plain CSS, and the primitives
    // never import it, which is what keeps the headless chain CSS-free.
    name: '@reely/react/theme.css',
    path: '../packages/react/theme.css',
    budget: 6
  },
  {
    name: '@reely/provider-native',
    path: '../packages/provider-native/dist/index.js',
    budget: null
  },
  {
    name: '@reely/provider-hls',
    path: '../packages/provider-hls/dist/index.js',
    budget: null
  },
  {
    name: '@reely/provider-youtube',
    path: '../packages/provider-youtube/dist/index.js',
    budget: null
  },
  {
    name: '@reely/provider-vimeo',
    path: '../packages/provider-vimeo/dist/index.js',
    budget: null
  }
];

const measured = [];
for (const target of targets) {
  try {
    measured.push({ ...target, size: await gzipKilobytes(target.path) });
  } catch (cause) {
    throw new Error(
      `Cannot measure ${target.name}: ${fileURLToPath(
        new URL(target.path, import.meta.url)
      )} is missing. Run \`pnpm build\` first.`,
      { cause }
    );
  }
}

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

const over = measured.filter(
  ({ budget, size }) => budget !== null && size > budget
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
