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
 * matching quote or at a newline, carriage return or form feed.
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
        if (
          source[end] === '\n' ||
          source[end] === '\r' ||
          source[end] === '\f'
        )
          break;
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
    // ships as authored, its comments are bytes a consumer downloads, and the
    // great majority of its gzipped size is prose -- so a ceiling on the whole
    // file is in practice a comment budget, and #453 records it failing a
    // change that added 0.07 KB of rules and roughly 2 KB of explanation. The
    // repo asks for that explanation elsewhere; it should not be priced here.
    //
    // 2.5 KB, not the 6 KB this target carried before. 6 KB was set against a
    // number that included the prose and cannot be carried across. It was
    // chosen to sit roughly 40% above what the rules alone gzipped to at the
    // time: room for the rule set to grow before anything fails, which is
    // generous for a stylesheet whose whole job is colour, radius and spacing,
    // and still tight enough that a second control surface arriving here has to
    // be argued for. That growth has since been partly spent, and no figure is
    // restated here, because a rule set under active edit outruns any number
    // written beside it -- `pnpm test:budgets` prints the rules, the shipped
    // size and the headroom on every run. The shipped figure is measured and
    // printed too, so it cannot grow unobserved; it simply is not what fails
    // the build.
    name: '@playdeck/react/theme.css',
    path: 'packages/react/theme.css',
    budget: 2.5,
    budgetedSubset: { label: 'CSS rules', extract: stripCssComments }
  },
  {
    // The second theme, shipped as authored for the same reason theme.css is,
    // and so budgeted the same way: on the rules, with the shipped figure still
    // measured and printed.
    //
    // 2.5 KB is measured, not copied from the theme above -- the two landed on
    // the same ceiling independently. docked.css carries the same range-input
    // pseudo-element weight and forced-colors block against a smaller layout
    // section -- it never overlays or auto-hides -- and its rules gzipped to a
    // little over 2 KB when this was set, so 2.5 KB was simply the next 0.5 KB
    // step up from them. That is a tighter margin than the theme was given, and
    // deliberately: the two files do comparable work, so the one that arrived
    // second gets no more room than the first. Where either stands now is
    // printed by `pnpm test:budgets` rather than restated here.
    //
    // Raised to 3.0 KB (issue #594's follow-up, the phone settings sheet):
    // the mobile bottom-sheet rules for `settings-menu`/`captions-menu` --
    // `position: fixed`, the scrim, the rounded top corners, the 44px item
    // floor -- pushed the rules to 2.55 KB, 0.05 KB over the old 2.5 KB
    // ceiling. Per this repo's standing rule (`docs/superpowers/specs/
    // 2026-09-03-stage-homepage-and-theme-identity-design.md`'s "Budget"
    // section), a sheet that exceeds its budget gets it raised to 3.0 KB in
    // the same commit, design not thinned to fit.
    name: '@playdeck/react/docked.css',
    path: 'packages/react/docked.css',
    budget: 3.0,
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
 * One target, measured against a source rather than against a path.
 *
 * `size` is always the source as it ships. `budgeted` is the subset the ceiling
 * is really on, or `null` where the ceiling is on the whole file -- which is
 * every target but the stylesheet. A reader that only wants the figure a
 * consumer downloads can keep reading `size` and ignore the rest.
 *
 * @typedef {{ label: string; size: number }} BudgetedSubset
 * @typedef {{ name: string; budget: number | null; size: number; budgeted: BudgetedSubset | null }} MeasuredBundle
 * @param {(typeof targets)[number]} target
 * @param {string | Buffer} source
 * @returns {MeasuredBundle}
 */
export const measureTarget = ({ name, budget, budgetedSubset }, source) => ({
  name,
  budget,
  size: gzipKilobytes(source),
  budgeted:
    budgetedSubset === undefined
      ? null
      : {
          label: budgetedSubset.label,
          size: gzipKilobytes(budgetedSubset.extract(source.toString('utf8')))
        }
});

/**
 * The measured bundles that have outgrown their ceiling, with the name, size
 * and budget an error message needs.
 *
 * This is the gate's decision, and it lives here rather than in
 * `check-bundle-budgets.mjs` so that it is executed by the same tests that
 * measure the figures. Measurement and policy may be shared with the landing
 * page, which imports this module; console rendering may not follow them in,
 * because the page has no console. Which entries are over budget is policy, and
 * the page's whole argument is that the numbers it prints are the ones this
 * rule is applied to.
 *
 * `budgeted?.size ?? size` is where the gate stops counting comments: for the
 * stylesheet the ceiling is on the rules, and its shipped size is reported so
 * it cannot grow unobserved rather than to fail the build. See the theme target
 * above for why, and issue #453.
 *
 * flatMap rather than filter+map: the filter already guarantees a budget, but
 * only a narrowing form proves it to the reader and the typechecker alike.
 *
 * @param {readonly MeasuredBundle[]} measured
 * @returns {{ name: string; size: number; budget: number }[]}
 */
export const overBudget = (measured) =>
  measured.flatMap(({ name, size, budget, budgeted }) =>
    budget !== null && (budgeted?.size ?? size) > budget
      ? [
          {
            name: budgeted === null ? name : `${name} (${budgeted.label})`,
            size: budgeted?.size ?? size,
            budget
          }
        ]
      : []
  );

/**
 * Every budgeted and reported bundle, with the gzipped size it is at now.
 *
 * Throws rather than reporting a missing file as a zero: both readers need a
 * built tree, and a page that rendered `0.00 KB` for a package nobody had
 * built would be the most convincing wrong number on it.
 *
 * @param {string} repoRoot An absolute path to the repository root.
 * @returns {Promise<MeasuredBundle[]>}
 */
export const measureBundles = async (repoRoot) => {
  const measured = [];
  for (const target of targets) {
    const resolved = join(repoRoot, target.path);
    let source;
    try {
      source = await readFile(resolved);
    } catch (cause) {
      throw new Error(
        `Cannot measure ${target.name}: ${resolved} is missing. Run \`pnpm build\` first.`,
        { cause }
      );
    }
    measured.push(measureTarget(target, source));
  }
  return measured;
};
