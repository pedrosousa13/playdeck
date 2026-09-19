import assert from 'node:assert/strict';
import test from 'node:test';

import { targets } from './bundle-budgets.mjs';
import {
  composeRows,
  driftReasons,
  pinnedVersion,
  proseAnchors,
  renderReadme,
  renderTable,
  tenths
} from './readme-bytes.mjs';

// Deliberately not the real measurements: this file runs in the `static` CI
// job, which builds no `dist/`, and a fixture that has to be re-typed whenever
// a bundle moves would be the same rot one level down.
const figures = {
  core: 78,
  primitives: 172,
  theme: 58,
  themeRules: 20,
  docked: 62,
  dockedRules: 24,
  native: 58,
  hlsAdapter: 48,
  youtube: 61,
  vimeo: 78,
  wistia: 53,
  hlsJs: 1599,
  hlsJsLight: 1064,
  vimeoSdk: 77
};

// ---- the rows --------------------------------------------------------------

test('adds the addends a row prints rather than the figures behind them', () => {
  const [mp4] = composeRows({ ...figures, core: 78, primitives: 172 });
  assert.equal(mp4?.downloads, 'core 7.8 + primitives 17.2 + native 5.8');
  assert.equal(mp4?.total, 308);
});

test('carries the previous total into a row that says "the above"', () => {
  const [, native, mse] = composeRows(figures);
  assert.equal(native?.downloads, 'the above + HLS adapter 4.8');
  assert.equal(native?.total, 308 + 48);
  assert.equal(mse?.downloads, 'the above + **hls.js 159.9**');
  assert.equal(mse?.total, 308 + 48 + 1599);
});

test('the light row spells out the same subtotal the row above carries', () => {
  const [, native, , light] = composeRows(figures);
  assert.equal(
    light?.downloads,
    'core + primitives + native + HLS adapter 35.6 + hls.js light 106.4'
  );
  assert.equal(light?.total, (native?.total ?? 0) + 1064);
});

test('counts the Vimeo SDK on top of the Vimeo adapter', () => {
  const vimeo = composeRows(figures).find((row) => row.playing === 'Vimeo');
  assert.equal(
    vimeo?.downloads,
    'core 7.8 + primitives 17.2 + adapter 7.8 + `@vimeo/player` 7.7'
  );
  assert.equal(vimeo?.total, 78 + 172 + 78 + 77);
});

test('rounds to tenths of a kilobyte, half up', () => {
  assert.equal(tenths(7.78), 78);
  assert.equal(tenths(17.21), 172);
  assert.equal(tenths(5.75), 58);
});

// ---- the table -------------------------------------------------------------

test('pads every cell in a column to the widest, the way Prettier does', () => {
  const lines = renderTable([
    { playing: 'MP4 or WebM', downloads: 'core 7.8', total: 78 },
    { playing: 'HLS on Safari and iOS', downloads: 'the above', total: 356 }
  ]).split('\n');

  assert.deepEqual(lines, [
    '| Playing               | Downloads | Total       |',
    '| --------------------- | --------- | ----------- |',
    '| MP4 or WebM           | core 7.8  | **7.8 KB**  |',
    '| HLS on Safari and iOS | the above | **35.6 KB** |'
  ]);
});

// ---- the document ----------------------------------------------------------

const versions = { 'hls.js': '1.6.16', '@vimeo/player': '2.30.4' };

const readme = [
  'Gzip, excluding React itself and the optional',
  '`theme.css` (0.0 KB) and `docked.css` (0.0 KB):',
  '',
  '<!-- bytes:table -->',
  '',
  'stale table',
  '',
  '<!-- /bytes -->',
  '',
  "hls.js's own smallest build is 0.0 KB,",
  "and Playdeck's HLS adapter over it is 0.0.",
  '',
  '`hls.js/light` saves 0.0 KB and gives up subtitles.',
  '',
  'core weighs in at',
  '0.0 KB, the primitives at 0.0 KB, `theme.css` at 0.0 KB and `docked.css` at 0.0 KB.',
  '',
  'builds of hls.js 0.0.0 and `@vimeo/player` 0.0.0 —',
  ''
].join('\n');

const anchors = () => proseAnchors(figures, versions);

test('replaces the marked region with the table and leaves the rest alone', () => {
  const out = renderReadme(readme, 'the table', anchors());
  assert.match(out, /<!-- bytes:table -->\n\nthe table\n\n<!-- \/bytes -->/);
  assert.doesNotMatch(out, /stale table/);
});

test('rewrites every figure the prose repeats from the table', () => {
  const out = renderReadme(readme, 'the table', anchors());
  assert.match(out, /`theme\.css` \(5\.8 KB\)/);
  assert.match(out, /`docked\.css` \(6\.2 KB\)/);
  assert.match(out, /smallest build is 106\.4 KB/);
  assert.match(out, /adapter over it is 4\.8\./);
  assert.match(out, /saves 53\.5 KB/);
  assert.match(out, /core weighs in at\n7\.8 KB, the primitives at 17\.2 KB/);
  assert.match(out, /`theme\.css` at 2\.0 KB/);
  assert.match(out, /`docked\.css` at 2\.4 KB/);
  assert.match(out, /hls\.js 1\.6\.16 and `@vimeo\/player` 2\.30\.4/);
});

test('an anchor whose sentence was reworded away fails rather than passing', () => {
  assert.throws(
    () =>
      renderReadme(
        readme.replace(
          '`hls.js/light` saves 0.0 KB',
          'the light build is smaller'
        ),
        'the table',
        anchors()
      ),
    /matched 0 places/
  );
});

test('an anchor that matches twice fails rather than rewriting both', () => {
  assert.throws(
    () =>
      renderReadme(
        `${readme}\n\`hls.js/light\` saves 0.0 KB again`,
        'the table',
        anchors()
      ),
    /matched 2 places/
  );
});

// The forward edge of the coupling between the two scripts. `sizeOf` and
// `rulesSizeOf` in `readme-bytes.mjs` already throw when `bundle-budgets.mjs`
// STOPS measuring a name they ask for; a target arriving there that nothing
// here asks for was unguarded, and `measure()`'s `figures` is a hand-written
// object literal, so nothing structural would have noticed. That is how
// `docked.css` drifted (#601): the budget script measured it, the README named
// only `theme.css`, and `docs:bytes:check` stayed green on a sentence that
// listed one stylesheet out of two.
//
// Only the `budgetedSubset` targets are held to this. Core and the primitives
// are budgeted and named in the prose too, but their figure is on the whole
// file; a subset budget is what a file shipped as authored gets, which today
// means a stylesheet, and a stylesheet the section omits is the failure above.
//
// The names come from `targets` rather than from a list typed here, because a
// list typed here would go stale the same way the `figures` literal does.
//
// The backticks around the name are required rather than incidental: without
// them an anchor for a `dark-theme.css` that does not exist yet reports
// `theme.css` as named, and the run goes green with no sentence naming the
// file. Every stylesheet anchor already writes the name in backticks, so one
// that does not fails here loudly rather than passing quietly -- a spurious
// red an author can act on, which is the direction to be wrong in.
//
// What this does NOT catch: the match is on a basename, so two budgeted
// stylesheets sharing one at different paths would each be satisfied by the
// other's anchor. Today's targets cannot collide that way, and the rest of the
// coupling keys on `target.name` rather than a basename, so closing it means
// changing what an anchor is expected to write -- out of scope here, and worth
// its own issue if a second package ever ships a stylesheet.
test('anchors every stylesheet bundle-budgets.mjs budgets a subset of', () => {
  const sources = proseAnchors(figures, versions).map(({ pattern }) =>
    pattern.source.replaceAll('\\', '')
  );
  const unanchored = targets
    .filter(({ budgetedSubset }) => budgetedSubset !== undefined)
    .map(({ path }) => path.split('/').at(-1))
    .filter(
      (file) => !sources.some((source) => source.includes(`\`${file}\``))
    );

  assert.deepEqual(
    unanchored,
    [],
    `bundle-budgets.mjs budgets a subset of ${unanchored.join(', ')}, which no anchor in proseAnchors names. Give the figure a key in measure()'s figures, an anchor per sentence that prints it, and a sentence in README.md for each anchor to own.`
  );
});

test('names the row and the prose figure that drifted, not just "something"', () => {
  const table = renderTable(composeRows(figures));
  const drifted = readme.replace('stale table', table.replace('4.8', '9.9'));
  const reasons = driftReasons(drifted, table, anchors());

  assert.deepEqual(reasons, [
    '  The row for HLS on Safari and iOS measures the above + HLS adapter 4.8 = **35.6 KB**, and README.md prints the above + HLS adapter 9.9 = **35.6 KB**.',
    '  The prose figure for the stylesheet, excluded from every row measures 5.8, and README.md prints 0.0.',
    '  The prose figure for the docked stylesheet, excluded from every row measures 6.2, and README.md prints 0.0.',
    "  The prose figure for hls.js's smallest build measures 106.4, and README.md prints 0.0.",
    '  The prose figure for the HLS adapter over it measures 4.8, and README.md prints 0.0.',
    '  The prose figure for what `hls.js/light` saves measures 53.5, and README.md prints 0.0.',
    "  The prose figure for core's measured size measures 7.8, and README.md prints 0.0.",
    "  The prose figure for the primitives' measured size measures 17.2, and README.md prints 0.0.",
    "  The prose figure for the stylesheet's measured rules size measures 2.0, and README.md prints 0.0.",
    "  The prose figure for the docked stylesheet's measured rules size measures 2.4, and README.md prints 0.0.",
    '  The prose figure for the measured hls.js version measures 1.6.16, and README.md prints 0.0.0.',
    '  The prose figure for the measured `@vimeo/player` version measures 2.30.4, and README.md prints 0.0.0.'
  ]);
});

test('a figure that widened a column reports its row and not the delimiter', () => {
  const table = renderTable(composeRows(figures));
  const wider = renderTable(composeRows({ ...figures, hlsJs: 15990 }));
  const reasons = driftReasons(
    readme.replace('stale table', wider),
    table,
    anchors()
  );

  assert.deepEqual(
    reasons.filter((reason) => reason.includes('The row for')),
    [
      '  The row for HLS on Chrome, Edge, Firefox measures the above + **hls.js 159.9** = **195.5 KB**, and README.md prints the above + **hls.js 1599.0** = **1634.6 KB**.'
    ]
  );
  assert.deepEqual(
    reasons.filter((reason) => reason.includes('---')),
    []
  );
});

test('reports nothing once the section already carries the measurements', () => {
  const table = renderTable(composeRows(figures));
  assert.deepEqual(
    driftReasons(renderReadme(readme, table, anchors()), table, anchors()),
    []
  );
});

test('a document with no marker fails rather than being left unchanged', () => {
  assert.throws(
    () => renderReadme('no marker here', 'the table', []),
    /no <!-- bytes:table --> marker/
  );
});

test('an unclosed marker fails rather than swallowing the rest of the file', () => {
  assert.throws(
    () => renderReadme('<!-- bytes:table -->\n\nrows\n', 'the table', []),
    /never closed/
  );
});

// ---- the third-party pins --------------------------------------------------

const hlsTarget = {
  package: 'hls.js',
  pinnedIn: {
    manifest: 'packages/provider-hls/package.json',
    field: 'dependencies'
  }
};
const manifests = {
  'packages/provider-hls/package.json': { 'hls.js': '1.6.16' }
};

test('accepts an install that is the version its manifest pins', () => {
  assert.equal(pinnedVersion(hlsTarget, '1.6.16', manifests), '1.6.16');
});

test('refuses to measure an install that is not the pinned version', () => {
  assert.throws(
    () => pinnedVersion(hlsTarget, '1.6.15', manifests),
    /installed at 1\.6\.15 but packages\/provider-hls\/package\.json pins 1\.6\.16/
  );
});

test('refuses a manifest that no longer declares the package at all', () => {
  assert.throws(
    () =>
      pinnedVersion(hlsTarget, '1.6.16', {
        'packages/provider-hls/package.json': {}
      }),
    /no longer declares hls\.js/
  );
});
