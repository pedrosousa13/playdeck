#!/usr/bin/env node
// Keeps the README's "What a page actually downloads" section honest: every
// byte figure in it is measured here rather than typed there.
//
// The shape is `docs-examples.mjs`'s -- a marked region the generator owns, a
// `--check` mode that fails instead of writing -- applied to numbers instead of
// code. The reason is the same failure this repo has already had twice: a
// hand-maintained table is falsified by any change that moves a bundle, and
// nothing goes red. #509 shipped that table with three figures already stale
// from its own sibling commits, and #317 was the same rot on the origins table.
//
// Two sources are read, and they are not equally strong.
//
// The first-party figures come from `bundle-budgets.mjs`, which is what
// `pnpm test:budgets` gates against, so the table cannot disagree with the
// gate. The two third-party figures cannot: hls.js and `@vimeo/player` are
// external to those bundles, so the budget script never sees them. They are
// measured here from the installed packages instead, and the version each was
// measured at is checked against the manifest that pins it -- a stale install
// would otherwise bake a number for a version nobody ships.
//
// Prose is rewritten in place rather than generated. The figures that repeat
// the table's numbers -- the stylesheet's size, hls.js's smallest build, what
// `hls.js/light` saves -- are reached through the anchors below, each of which
// replaces one number and fails unless it matches exactly once. Generating
// those sentences would mean keeping the prose in this file; leaving them alone
// would mean the section could contradict its own table.

import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { measureBundles, targets } from './bundle-budgets.mjs';

const console = globalThis.console;
const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const README = 'README.md';
const OPEN = '<!-- bytes:table -->';
const CLOSE = '<!-- /bytes -->';

/**
 * Every figure is carried and added as an integer number of tenths of a
 * kilobyte, which is the precision the section prints at.
 *
 * A total is the sum of the addends the row shows, not the rounded sum of what
 * was measured. Those differ by up to half a tenth per addend, and when they
 * do it is the printed row that stops adding up -- which is the one error a
 * reader can catch unaided, and the one that makes them distrust the rest.
 * @param {number} kilobytes
 * @returns {number}
 */
export const tenths = (kilobytes) => Math.round(kilobytes * 10);

/** @param {number} value @returns {string} */
const kb = (value) => (value / 10).toFixed(1);

/**
 * @typedef {{ label: string; size: number; emphasis?: boolean }} Part
 * @typedef {{ playing: string; prefix?: string; parts: readonly Part[]; carried?: number }} Row
 */

/**
 * The table's rows, in tenths, from the measured figures.
 *
 * `carried` is what "the above" stands for: the two HLS rows quote the row
 * before them rather than repeating its addends, so the total has to be told
 * what it is adding to. `emphasis` is on one addend only, and deliberately: the
 * hls.js figure is six times the row it is added to, and it is the reason that
 * row is worth printing at all.
 * @param {Record<string, number>} figures
 * @returns {{ playing: string; downloads: string; total: number }[]}
 */
export const composeRows = (figures) => {
  const base = /** @type {const} */ ([
    { label: 'core', size: figures.core },
    { label: 'primitives', size: figures.primitives }
  ]);
  const mp4 = base.reduce((sum, part) => sum + part.size, figures.native);
  const nativeHls = mp4 + figures.hlsAdapter;

  /** @type {readonly Row[]} */
  const rows = [
    {
      playing: 'MP4 or WebM',
      parts: [...base, { label: 'native', size: figures.native }]
    },
    {
      playing: 'HLS on Safari and iOS',
      prefix: 'the above + ',
      parts: [{ label: 'HLS adapter', size: figures.hlsAdapter }],
      carried: mp4
    },
    {
      playing: 'HLS on Chrome, Edge, Firefox',
      prefix: 'the above + ',
      parts: [{ label: 'hls.js', size: figures.hlsJs, emphasis: true }],
      carried: nativeHls
    },
    {
      playing: 'HLS on Chrome, Edge, Firefox, with `hls.js/light`',
      parts: [
        {
          label: 'core + primitives + native + HLS adapter',
          size: nativeHls
        },
        { label: 'hls.js light', size: figures.hlsJsLight }
      ]
    },
    {
      playing: 'YouTube',
      parts: [...base, { label: 'adapter', size: figures.youtube }]
    },
    {
      playing: 'Vimeo',
      parts: [
        ...base,
        { label: 'adapter', size: figures.vimeo },
        { label: '`@vimeo/player`', size: figures.vimeoSdk }
      ]
    },
    {
      playing: 'Wistia',
      parts: [...base, { label: 'adapter', size: figures.wistia }]
    }
  ];

  return rows.map(({ playing, prefix = '', parts, carried = 0 }) => ({
    playing,
    downloads:
      prefix +
      parts
        .map(({ label, size, emphasis }) =>
          emphasis ? `**${label} ${kb(size)}**` : `${label} ${kb(size)}`
        )
        .join(' + '),
    total: parts.reduce((sum, part) => sum + part.size, carried)
  }));
};

/**
 * The table, padded the way Prettier pads a markdown table: every cell in a
 * column to the width of the widest, and the delimiter row to match. Emitting
 * it any other way would leave `pnpm format:check` and this generator undoing
 * each other's work forever.
 * @param {readonly { playing: string; downloads: string; total: number }[]} rows
 * @returns {string}
 */
export const renderTable = (rows) => {
  const header = ['Playing', 'Downloads', 'Total'];
  const body = rows.map(({ playing, downloads, total }) => [
    playing,
    downloads,
    `**${kb(total)} KB**`
  ]);
  const widths = header.map((_, column) =>
    Math.max(
      header[column]?.length ?? 0,
      ...body.map((cells) => cells[column]?.length ?? 0)
    )
  );
  /** @param {readonly string[]} cells */
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`;

  return [
    line(header),
    line(widths.map((width) => '-'.repeat(width))),
    ...body.map(line)
  ].join('\n');
};

/**
 * The numbers the prose around the table repeats, each addressed by a pattern
 * that matches the digits alone.
 *
 * Lookaround rather than a capture group so the match IS the number and the
 * replacement is the whole match: a capture would have to be spliced back,
 * which is a second place for the sentence's wording to live.
 * @param {Record<string, number>} figures
 * @param {{ core: number; primitives: number; theme: number }} budgets
 * @param {Record<string, string>} versions
 * @returns {{ label: string; pattern: RegExp; value: string }[]}
 */
export const proseAnchors = (figures, budgets, versions) => [
  {
    label: 'the stylesheet, excluded from every row',
    pattern: /(?<=`theme\.css`\s\()\d+\.\d(?=\sKB\))/,
    value: kb(figures.theme)
  },
  {
    label: "hls.js's smallest build",
    pattern: /(?<=hls\.js's\sown\ssmallest\sbuild\sis\s)\d+\.\d(?=\sKB)/,
    value: kb(figures.hlsJsLight)
  },
  {
    label: 'the HLS adapter over it',
    pattern: /(?<=Playdeck's\sHLS\sadapter\sover\sit\sis\s)\d+\.\d/,
    value: kb(figures.hlsAdapter)
  },
  {
    label: 'what `hls.js/light` saves',
    pattern: /(?<=`hls\.js\/light`\ssaves\s)\d+\.\d(?=\sKB)/,
    value: kb(figures.hlsJs - figures.hlsJsLight)
  },
  {
    label: "core's budget",
    pattern: /(?<=core\sat\s)\d+(?:\.\d+)?(?=\sKB)/,
    value: String(budgets.core)
  },
  {
    label: "the primitives' budget",
    pattern: /(?<=the\sprimitives\sat\s)\d+(?:\.\d+)?(?=\sKB)/,
    value: String(budgets.primitives)
  },
  {
    label: "the stylesheet's budget",
    pattern: /(?<=`theme\.css`\sat\s)\d+(?:\.\d+)?(?=\sKB)/,
    value: String(budgets.theme)
  },
  {
    label: 'the measured hls.js version',
    pattern: /(?<=hls\.js\s)\d+\.\d+\.\d+/,
    value: versions['hls.js'] ?? ''
  },
  {
    label: 'the measured `@vimeo/player` version',
    pattern: /(?<=`@vimeo\/player`\s)\d+\.\d+\.\d+/,
    value: versions['@vimeo/player'] ?? ''
  }
];

/**
 * The document with the marked table replaced and every prose anchor rewritten.
 *
 * An anchor that matches anything other than exactly once is an error rather
 * than a no-op. Zero means the sentence it guards was reworded and is now
 * ungated -- the silent failure this whole script exists to prevent -- and more
 * than one means it is guarding a number it was not aimed at.
 * @param {string} text
 * @param {string} table
 * @param {readonly { label: string; pattern: RegExp; value: string }[]} anchors
 * @returns {string}
 */
export const renderReadme = (text, table, anchors) => {
  const open = text.indexOf(`${OPEN}\n`);
  if (open === -1) throw new Error(`${README} has no ${OPEN} marker.`);
  const close = text.indexOf(`\n${CLOSE}`, open);
  if (close === -1) throw new Error(`Marker ${OPEN} is never closed.`);

  let out = `${text.slice(0, open)}${OPEN}\n\n${table}\n${text.slice(close)}`;

  for (const { label, pattern, value } of anchors) {
    const matches = out.match(new RegExp(pattern, 'g')) ?? [];
    if (matches.length !== 1) {
      throw new Error(
        `The anchor for ${label} matched ${matches.length} places in ${README}, not one. Its sentence was reworded, or the pattern is aimed too widely.`
      );
    }
    out = out.replace(pattern, value);
  }

  return out;
};

// Where the two third-party figures come from, and the manifest that pins each.
// The minified build rather than the ESM one a bundler consumes: what a page
// downloads is what came out of the consumer's minifier, and the published
// `.min.js` is the closest thing to that which does not depend on whose
// bundler it is. `packages/provider-hls/node_modules` and not the root, because
// that is the copy the adapter's `import('hls.js')` resolves to.
/**
 * @type {readonly {
 *   key: string;
 *   package: string;
 *   installedAt: string;
 *   pinnedIn: { manifest: string; field: string };
 *   file: string;
 * }[]}
 */
export const thirdParty = [
  {
    key: 'hlsJs',
    package: 'hls.js',
    installedAt: 'packages/provider-hls/node_modules/hls.js',
    pinnedIn: {
      manifest: 'packages/provider-hls/package.json',
      field: 'dependencies'
    },
    file: 'dist/hls.min.js'
  },
  {
    key: 'hlsJsLight',
    package: 'hls.js',
    installedAt: 'packages/provider-hls/node_modules/hls.js',
    pinnedIn: {
      manifest: 'packages/provider-hls/package.json',
      field: 'dependencies'
    },
    file: 'dist/hls.light.min.js'
  },
  {
    key: 'vimeoSdk',
    package: '@vimeo/player',
    installedAt: 'packages/provider-vimeo/node_modules/@vimeo/player',
    pinnedIn: {
      manifest: 'packages/provider-vimeo/package.json',
      field: 'dependencies'
    },
    file: 'dist/player.min.js'
  }
];

/**
 * The installed version of a third-party target, refused unless it is the one
 * its manifest pins.
 *
 * Refused rather than reported: the number this script writes into the README
 * is measured from whatever is on disk, and a tree left behind by an
 * interrupted install would put a figure for one version under the name of
 * another. Both pins are exact, so equality is the whole test.
 * @param {{ package: string; pinnedIn: { manifest: string; field: string } }} target
 * @param {string} installed
 * @param {Record<string, Record<string, string> | undefined>} manifests
 * @returns {string}
 */
export const pinnedVersion = (target, installed, manifests) => {
  const declared = manifests[target.pinnedIn.manifest]?.[target.package];
  if (declared === undefined) {
    throw new Error(
      `${target.pinnedIn.manifest} no longer declares ${target.package} under ${target.pinnedIn.field}.`
    );
  }
  if (declared !== installed) {
    throw new Error(
      `${target.package} is installed at ${installed} but ${target.pinnedIn.manifest} pins ${declared}. Run \`pnpm install\` before measuring.`
    );
  }
  return installed;
};

/** @param {string} path @returns {Promise<Record<string, unknown>>} */
const readJson = async (path) =>
  JSON.parse(await readFile(join(repoRoot, path), 'utf8'));

/**
 * @returns {Promise<{
 *   figures: Record<string, number>;
 *   budgets: { core: number; primitives: number; theme: number };
 *   versions: Record<string, string>;
 * }>}
 */
const measure = async () => {
  const measured = await measureBundles(repoRoot);
  /** @param {string} name */
  const sizeOf = (name) => {
    const found = measured.find((bundle) => bundle.name === name);
    if (!found)
      throw new Error(`bundle-budgets.mjs no longer measures ${name}`);
    return tenths(found.size);
  };
  /** @param {string} name */
  const budgetOf = (name) => {
    const found = targets.find((target) => target.name === name);
    if (found?.budget == null) {
      throw new Error(`bundle-budgets.mjs no longer budgets ${name}`);
    }
    return found.budget;
  };

  /** @type {Record<string, number>} */
  const figures = {
    core: sizeOf('@playdeck/core'),
    primitives: sizeOf('@playdeck/react (primitives, excl. React)'),
    theme: sizeOf('@playdeck/react/theme.css'),
    native: sizeOf('@playdeck/provider-native'),
    hlsAdapter: sizeOf('@playdeck/provider-hls'),
    youtube: sizeOf('@playdeck/provider-youtube'),
    vimeo: sizeOf('@playdeck/provider-vimeo'),
    wistia: sizeOf('@playdeck/provider-wistia')
  };

  /** @type {Record<string, Record<string, string> | undefined>} */
  const manifests = {};
  /** @type {Record<string, string>} */
  const versions = {};
  for (const target of thirdParty) {
    if (!(target.pinnedIn.manifest in manifests)) {
      const manifest = await readJson(target.pinnedIn.manifest);
      manifests[target.pinnedIn.manifest] =
        /** @type {Record<string, string> | undefined} */ (
          manifest[target.pinnedIn.field]
        );
    }
    const installed = String(
      (await readJson(`${target.installedAt}/package.json`)).version
    );
    versions[target.package] = pinnedVersion(target, installed, manifests);
    figures[target.key] = tenths(
      gzipSync(await readFile(join(repoRoot, target.installedAt, target.file)))
        .length / 1024
    );
  }

  return {
    figures,
    budgets: {
      core: budgetOf('@playdeck/core'),
      primitives: budgetOf('@playdeck/react (primitives, excl. React)'),
      theme: budgetOf('@playdeck/react/theme.css')
    },
    versions
  };
};

const main = async () => {
  const check = process.argv.includes('--check');
  const { figures, budgets, versions } = await measure();
  const path = join(repoRoot, README);
  const before = await readFile(path, 'utf8');
  const after = renderReadme(
    before,
    renderTable(composeRows(figures)),
    proseAnchors(figures, budgets, versions)
  );

  if (before === after) {
    if (!check) console.log(`${README} already matches the measurements.`);
    return;
  }
  if (check) {
    throw new Error(
      `${README}'s byte figures no longer match what is built and installed — run \`pnpm docs:bytes\`.`
    );
  }
  await writeFile(path, after);
  console.log(`Rewrote ${README}'s byte figures from the measured bundles.`);
};

// Only when run as a command: readme-bytes.test.mjs imports this module for its
// pure functions, and importing it must not rewrite the README.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
