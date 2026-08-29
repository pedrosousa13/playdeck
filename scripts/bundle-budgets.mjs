// What the initial-gzip bundle budgets from the MVP contract (issue #1) are
// measured against, and the measurement itself. Two readers share it:
// `check-bundle-budgets.mjs`, which prints the figures and fails a build that
// went over, and the landing page at `apps/site/src/pages/index.astro`, which
// renders them.
//
// One module rather than a list in each, because the page's whole argument is
// that the figures it prints are the ones a gate enforces. A second copy would
// let the page and the gate disagree about a number while both stayed green,
// which is the one failure a page like that cannot survive.
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

import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const KB = 1024;

// `budget: null` means report-only. Paths are relative to the repository root,
// which the caller supplies, rather than resolved against this module's own
// URL: one of the two callers is an Astro page, and a bundler rewrites
// `import.meta.url` to the chunk it emitted, which is not where this file
// lives. `scripts/workspace-packages.mjs` takes a root for the same reason.
/** @type {readonly { name: string; path: string; budget: number | null }[]} */
const targets = [
  {
    name: '@playdeck/core',
    path: 'packages/core/dist/index.js',
    budget: 10
  },
  {
    name: '@playdeck/react (primitives, excl. React)',
    path: 'packages/react/dist/index.js',
    budget: 18
  },
  {
    // Shipped as-is rather than built: it is plain CSS, and the primitives
    // never import it, which is what keeps the headless chain CSS-free.
    name: '@playdeck/react/theme.css',
    path: 'packages/react/theme.css',
    budget: 6
  },
  {
    name: '@playdeck/provider-native',
    path: 'packages/provider-native/dist/index.js',
    budget: null
  },
  {
    name: '@playdeck/provider-hls',
    path: 'packages/provider-hls/dist/index.js',
    budget: null
  },
  {
    name: '@playdeck/provider-youtube',
    path: 'packages/provider-youtube/dist/index.js',
    budget: null
  },
  {
    name: '@playdeck/provider-vimeo',
    path: 'packages/provider-vimeo/dist/index.js',
    budget: null
  },
  {
    name: '@playdeck/provider-wistia',
    path: 'packages/provider-wistia/dist/index.js',
    budget: null
  }
];

/** @param {string} path */
const gzipKilobytes = async (path) => {
  const source = await readFile(path);
  return gzipSync(source).length / KB;
};

/**
 * Every budgeted and reported bundle, with the gzipped size it is at now.
 *
 * Throws rather than reporting a missing file as a zero: both readers need a
 * built tree, and a page that rendered `0.00 KB` for a package nobody had
 * built would be the most convincing wrong number on it.
 *
 * @typedef {{ name: string; budget: number | null; size: number }} MeasuredBundle
 * @param {string} repoRoot An absolute path to the repository root.
 * @returns {Promise<MeasuredBundle[]>}
 */
export const measureBundles = async (repoRoot) => {
  const measured = [];
  for (const { name, path, budget } of targets) {
    const resolved = join(repoRoot, path);
    try {
      measured.push({ name, budget, size: await gzipKilobytes(resolved) });
    } catch (cause) {
      throw new Error(
        `Cannot measure ${name}: ${resolved} is missing. Run \`pnpm build\` first.`,
        { cause }
      );
    }
  }
  return measured;
};
