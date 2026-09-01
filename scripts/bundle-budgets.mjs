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

/**
 * The stylesheet with its CSS comments removed, and nothing else changed.
 *
 * A scanner rather than a regular expression, because a comment opener is only
 * an opener outside strings and unquoted `url()` values, and a pattern that
 * cannot tell those apart fails in the direction that matters: it would delete
 * real declarations and quietly lower the number the budget is enforced
 * against. A `content` string holding comment delimiters, and an inline SVG
 * data URL holding them, are both legal and both appear in stylesheets that
 * draw their own icons.
 *
 * Where it stops short of a full CSS tokenizer, deliberately:
 *
 * - A comment is deleted rather than replaced with a space, so a comment used
 *   as a token separator joins its neighbours together. That changes what the
 *   output would parse as, and does not change what it weighs, which is all
 *   this output is ever used for.
 * - Escaped identifiers -- `\75 rl(...)` written for `url(...)` -- are not
 *   decoded, so such a value's contents are scanned as ordinary CSS. Nothing in
 *   this repo writes one, and the cost if something did is a stripped sequence
 *   inside a URL.
 *
 * Everything else follows the CSS syntax spec: comments do not nest, a comment
 * ends at the first closing delimiter whatever quoting appears inside it, an
 * unterminated comment runs to end of file, and a string ends at an unescaped
 * matching quote or a newline.
 *
 * @param {string} source
 * @returns {string}
 */
export const stripCssComments = (source) => {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];

    if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close === -1) break;
      index = close + 2;
      continue;
    }

    if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (source[end] === '\n') break;
        end += 1;
        if (source[end - 1] === char) break;
      }
      out += source.slice(index, end);
      index = end;
      continue;
    }

    // An unquoted `url()` value is one token whose contents are not CSS, so it
    // is copied through whole. The name is matched only where an identifier
    // could start, so `myurl(` is an ordinary function call and its argument is
    // scanned normally. A quoted argument is left to the string branch above,
    // which already handles it.
    if (
      (char === 'u' || char === 'U') &&
      /^url\(/i.test(source.slice(index, index + 4)) &&
      !/[\w-]/.test(source[index - 1] ?? '')
    ) {
      let end = index + 4;
      while (end < source.length && /\s/.test(source[end])) end += 1;
      if (source[end] !== '"' && source[end] !== "'") {
        while (end < source.length && source[end] !== ')') {
          end += source[end] === '\\' ? 2 : 1;
        }
        out += source.slice(index, Math.min(end, source.length));
        index = Math.min(end, source.length);
        continue;
      }
      out += source.slice(index, index + 4);
      index += 4;
      continue;
    }

    out += char;
    index += 1;
  }
  return out;
};

/** @param {string | Buffer} source */
const gzipKilobytes = (source) => gzipSync(source).length / KB;

/**
 * The two figures a stylesheet target reports: what a consumer downloads, and
 * the part of that a ceiling is worth setting on.
 *
 * Exported so the decision the gate makes can be tested on synthetic CSS
 * without editing the real stylesheet, which is the one file this change is
 * meant to stop being edited for byte-count reasons.
 *
 * @param {string} source
 * @returns {{ shipped: number; rules: number }}
 */
export const measureStylesheet = (source) => ({
  shipped: gzipKilobytes(source),
  rules: gzipKilobytes(stripCssComments(source))
});

// Exported for the tests, which assert what the ceilings are and which target
// carries a subset without needing a built tree to measure against.
//
// `budget: null` means report-only. `budgetedSubset` moves the ceiling off the
// whole file and onto a part of it, leaving the file's own size measured and
// reported: the only target that needs it is the stylesheet, and it needs it
// because the file is shipped as authored (see below). Paths are relative to
// the repository root, which the caller supplies, rather than resolved against
// this module's own URL: one of the two callers is an Astro page, and a bundler
// rewrites `import.meta.url` to the chunk it emitted, which is not where this
// file lives.
/**
 * @type {readonly {
 *   name: string;
 *   path: string;
 *   budget: number | null;
 *   budgetedSubset?: { label: string; extract: (source: string) => string };
 * }[]}
 */
export const targets = [
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
    // never import it, which is what keeps the headless chain CSS-free. That
    // decision is also why the ceiling below is on a subset. Because the file
    // ships as authored, its comments are bytes a consumer downloads, and about
    // seventy percent of its gzipped size is prose -- so a ceiling on the whole
    // file is in practice a comment budget, and #453 records it failing a
    // change that added 0.07 KB of rules and roughly 2 KB of explanation. The
    // repo asks for that explanation elsewhere; it should not be priced here.
    //
    // 2.5 KB, not the 6 KB this target carried before. 6 KB was set against a
    // number that included the prose and cannot be carried across. The rules
    // alone gzip to 1.77 KB as of this change (5.79 KB shipped), so 2.5 KB
    // leaves 0.73 KB of headroom: room for the rule set to grow by roughly 40%
    // before anything fails, which is generous for a stylesheet whose whole job
    // is colour, radius and spacing, and still tight enough that a second
    // control surface arriving here has to be argued for. The shipped figure
    // is still measured and printed every run, so it cannot grow unobserved; it
    // simply is not what fails the build.
    name: '@playdeck/react/theme.css',
    path: 'packages/react/theme.css',
    budget: 2.5,
    budgetedSubset: { label: 'CSS rules', extract: stripCssComments }
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

/**
 * Every budgeted and reported bundle, with the gzipped size it is at now.
 *
 * `size` is always the file as it ships. `budgeted` is the subset the ceiling
 * is really on, or `null` where the ceiling is on the whole file -- which is
 * every target but the stylesheet. A reader that only wants the figure a
 * consumer downloads can keep reading `size` and ignore the rest.
 *
 * Throws rather than reporting a missing file as a zero: both readers need a
 * built tree, and a page that rendered `0.00 KB` for a package nobody had
 * built would be the most convincing wrong number on it.
 *
 * @typedef {{ label: string; size: number }} BudgetedSubset
 * @typedef {{ name: string; budget: number | null; size: number; budgeted: BudgetedSubset | null }} MeasuredBundle
 * @param {string} repoRoot An absolute path to the repository root.
 * @returns {Promise<MeasuredBundle[]>}
 */
export const measureBundles = async (repoRoot) => {
  const measured = [];
  for (const { name, path, budget, budgetedSubset } of targets) {
    const resolved = join(repoRoot, path);
    let source;
    try {
      source = await readFile(resolved);
    } catch (cause) {
      throw new Error(
        `Cannot measure ${name}: ${resolved} is missing. Run \`pnpm build\` first.`,
        { cause }
      );
    }
    measured.push({
      name,
      budget,
      size: gzipKilobytes(source),
      budgeted:
        budgetedSubset === undefined
          ? null
          : {
              label: budgetedSubset.label,
              size: gzipKilobytes(
                budgetedSubset.extract(source.toString('utf8'))
              )
            }
    });
  }
  return measured;
};
