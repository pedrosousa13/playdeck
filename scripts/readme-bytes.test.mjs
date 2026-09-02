import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeRows,
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

const budgets = { core: 10, primitives: 18, theme: 2.5 };
const versions = { 'hls.js': '1.6.16', '@vimeo/player': '2.30.4' };

const readme = [
  'Gzip, excluding React itself and the optional',
  '`theme.css` (0.0 KB):',
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
  'core at',
  '0 KB, the primitives at 0 KB and `theme.css` at 0 KB.',
  '',
  'builds of hls.js 0.0.0 and `@vimeo/player` 0.0.0 —',
  ''
].join('\n');

const anchors = () => proseAnchors(figures, budgets, versions);

test('replaces the marked region with the table and leaves the rest alone', () => {
  const out = renderReadme(readme, 'the table', anchors());
  assert.match(out, /<!-- bytes:table -->\n\nthe table\n\n<!-- \/bytes -->/);
  assert.doesNotMatch(out, /stale table/);
});

test('rewrites every figure the prose repeats from the table', () => {
  const out = renderReadme(readme, 'the table', anchors());
  assert.match(out, /`theme\.css` \(5\.8 KB\)/);
  assert.match(out, /smallest build is 106\.4 KB/);
  assert.match(out, /adapter over it is 4\.8\./);
  assert.match(out, /saves 53\.5 KB/);
  assert.match(out, /core at\n10 KB, the primitives at 18 KB/);
  assert.match(out, /`theme\.css` at 2\.5 KB/);
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
