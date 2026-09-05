// The line-level diff both comparison generators print when their `--check`
// mode finds the checked-in document out of date. It lives in its own module
// rather than in either generator because `scripts/compare-features.mjs`
// needs it too, and importing it from `scripts/compare-libraries.mjs` would
// drag Vite, the React plugin and the fixture's own esbuild install into a
// script that bundles nothing.

/**
 * The minimal line-level difference between two documents, as an LCS
 * (longest common subsequence) diff: a line present only in `before` is
 * prefixed `-`, a line present only in `after` is prefixed `+`, and a line
 * identical in both is omitted. LCS rather than a positional
 * (line-by-line-at-the-same-index) comparison because this file's table is
 * padded to the widest cell in each column -- one figure gaining a digit can
 * shift every cell in that column, and a positional diff would then report
 * every row as different instead of naming the one figure that actually
 * changed.
 * @param {string} before
 * @param {string} after
 * @returns {string[]}
 */
export const lineDiff = (before, after) => {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  /** @type {number[][]} */
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, lcs[i]?.[j + 1] ?? 0);
    }
  }

  /** @type {string[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      j += 1;
    }
  }
  while (i < n) {
    out.push(`- ${a[i]}`);
    i += 1;
  }
  while (j < m) {
    out.push(`+ ${b[j]}`);
    j += 1;
  }
  return out;
};
