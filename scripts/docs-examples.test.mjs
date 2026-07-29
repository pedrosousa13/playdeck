import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compilingSources,
  indexFixtures,
  markerNames,
  renderDoc,
  uncoveredExports,
  ungatedFences
} from './docs-examples.mjs';

/** @type {Map<string, { source: string; language: 'ts' | 'tsx' | 'css' }>} */
const fixtures = new Map([
  ['demo', { source: 'export const a = 1;\n', language: 'ts' }],
  ['ui', { source: 'export const B = () => null;\n', language: 'tsx' }],
  ['part', { source: "[data-reely-part='time'] {\n}\n", language: 'css' }]
]);

test('injects a fixture into a marked region in markdown', () => {
  const input = [
    '# Title',
    '',
    '<!-- example:demo -->',
    '',
    '```ts',
    'stale();',
    '```',
    '',
    '<!-- /example -->',
    '',
    'after'
  ].join('\n');

  assert.equal(
    renderDoc(input, 'md', fixtures),
    [
      '# Title',
      '',
      '<!-- example:demo -->',
      '',
      '```ts',
      'export const a = 1;',
      '```',
      '',
      '<!-- /example -->',
      '',
      'after'
    ].join('\n')
  );
});

test('uses the mdx comment syntax and the fixture language', () => {
  const input = [
    '{/* example:ui */}',
    '',
    '```tsx',
    'stale();',
    '```',
    '',
    '{/* /example */}'
  ].join('\n');

  assert.equal(
    renderDoc(input, 'mdx', fixtures),
    [
      '{/* example:ui */}',
      '',
      '```tsx',
      'export const B = () => null;',
      '```',
      '',
      '{/* /example */}'
    ].join('\n')
  );
});

test('injects a css fixture with a css fence', () => {
  const input = [
    '{/* example:part */}',
    '',
    '```css',
    'stale {}',
    '```',
    '',
    '{/* /example */}'
  ].join('\n');

  assert.equal(
    renderDoc(input, 'mdx', fixtures),
    [
      '{/* example:part */}',
      '',
      '```css',
      "[data-reely-part='time'] {",
      '}',
      '```',
      '',
      '{/* /example */}'
    ].join('\n')
  );
});

test('is idempotent', () => {
  const input =
    '<!-- example:demo -->\n\n```ts\nexport const a = 1;\n```\n\n<!-- /example -->\n';
  assert.equal(
    renderDoc(renderDoc(input, 'md', fixtures), 'md', fixtures),
    input
  );
});

test('rejects a marker with no fixture', () => {
  const input = '<!-- example:missing -->\n\n```ts\n```\n\n<!-- /example -->\n';
  assert.throws(
    () => renderDoc(input, 'md', fixtures),
    /no fixture named "missing"/
  );
});

test('rejects an unterminated marker', () => {
  const input = '<!-- example:demo -->\n\n```ts\n```\n';
  assert.throws(() => renderDoc(input, 'md', fixtures), /never closed/);
});

test('leaves an unmarked fence alone', () => {
  const input = '```sh\npnpm add @reely/core\n```\n';
  assert.equal(renderDoc(input, 'md', fixtures), input);
});

test('an export used in a fixture is covered', () => {
  assert.deepEqual(
    uncoveredExports(new Map([['@reely/core', ['detectSource']]]), [
      "import { detectSource } from '@reely/core';\ndetectSource('a.mp4');\n"
    ]),
    []
  );
});

test('a substring is not coverage', () => {
  // `Time` must not be satisfied by the word "sometimes" in a comment.
  assert.deepEqual(
    uncoveredExports(new Map([['@reely/react', ['Time']]]), [
      '// sometimes the runtime is slow\n'
    ]),
    [{ package: '@reely/react', name: 'Time' }]
  );
});

test('reports every uncovered export, not just the first', () => {
  assert.deepEqual(
    uncoveredExports(new Map([['@reely/core', ['a', 'b']]]), [
      'const c = 1;\n'
    ]),
    [
      { package: '@reely/core', name: 'a' },
      { package: '@reely/core', name: 'b' }
    ]
  );
});

test('indexes a fixture by filename and extension, ignoring the rest', () => {
  assert.deepEqual(
    indexFixtures([
      { file: 'core-quickstart.ts', source: 'a' },
      { file: 'react-menus.tsx', source: 'b' },
      { file: 'css-play-button.css', source: 'c' },
      { file: 'tsconfig.json', source: 'd' }
    ]),
    new Map([
      ['core-quickstart', { source: 'a', language: 'ts' }],
      ['react-menus', { source: 'b', language: 'tsx' }],
      ['css-play-button', { source: 'c', language: 'css' }]
    ])
  );
});

test('rejects two fixtures that would answer to the same marker name', () => {
  // A marker name cannot carry an extension or a directory (see MARKERS), so
  // the key is the bare filename and two languages can silently collide on it.
  assert.throws(
    () =>
      indexFixtures([
        { file: 'play-button.tsx', source: 'a' },
        { file: 'play-button.css', source: 'b' }
      ]),
    /play-button\.tsx.*play-button\.css/s
  );
});

test('a css fixture is not export coverage', () => {
  // Only a fixture the `examples` project compiles can prove an export works.
  // A stylesheet mentioning `Poster` in a comment proves nothing.
  assert.deepEqual(
    compilingSources(
      new Map([
        ['react-overlays', { source: '<Player.Poster />', language: 'tsx' }],
        ['css-poster', { source: '/* Poster */', language: 'css' }]
      ])
    ),
    ['<Player.Poster />']
  );
});

test('reports the markers a doc references', () => {
  const input = [
    '<!-- example:demo -->',
    '```ts',
    '```',
    '<!-- /example -->',
    '<!-- example:ui -->',
    '```tsx',
    '```',
    '<!-- /example -->'
  ].join('\n');

  assert.deepEqual(markerNames(input, 'md'), ['demo', 'ui']);
});

test('reports mdx markers too, and nothing for a plain doc', () => {
  assert.deepEqual(markerNames('{/* example:ui */}\n{/* /example */}', 'mdx'), [
    'ui'
  ]);
  assert.deepEqual(markerNames('# Just prose\n', 'md'), []);
});

test('a ts fence inside a marked region is gated', () => {
  const input = [
    '<!-- example:demo -->',
    '',
    '```ts',
    'export const a = 1;',
    '```',
    '',
    '<!-- /example -->'
  ].join('\n');

  assert.deepEqual(ungatedFences(input, 'md'), []);
});

test('a ts fence outside every region is reported with its line', () => {
  const input = ['# Title', '', '```ts', 'stale();', '```'].join('\n');

  assert.deepEqual(ungatedFences(input, 'md'), [3]);
});

test('an explicitly ignored fence is allowed', () => {
  const input = [
    '<!-- example:ignore two import lines, nothing to compile -->',
    '',
    '```ts',
    "import '@reely/react/theme.css';",
    '```'
  ].join('\n');

  assert.deepEqual(ungatedFences(input, 'md'), []);
});

test('a fence in an ungated language is never reported', () => {
  const input = ['```sh', 'pnpm add @reely/core', '```', '```json', '{}', '```']
    .join('\n')
    .concat('\n');

  assert.deepEqual(ungatedFences(input, 'md'), []);
});

test('a css fence outside every region is reported with its line', () => {
  // A css block is shown as the styling contract for a part. Hand-written, it
  // drifts from the stylesheet a story actually mounts, which is the same hole
  // an unmarked ts block leaves.
  const input = ['# Title', '', '```css', 'a {', '}', '```'].join('\n');

  assert.deepEqual(ungatedFences(input, 'md'), [3]);
});

test('a css fence inside a marked region is gated', () => {
  const input = [
    '{/* example:part */}',
    '',
    '```css',
    "[data-reely-part='time'] {",
    '}',
    '```',
    '',
    '{/* /example */}'
  ].join('\n');

  assert.deepEqual(ungatedFences(input, 'mdx'), []);
});

test('an explicitly ignored css fence is allowed', () => {
  const input = [
    '{/* example:ignore one token declaration, no part behind it */}',
    '',
    '```css',
    '.brand {',
    '  --reely-radius: 0;',
    '}',
    '```'
  ].join('\n');

  assert.deepEqual(ungatedFences(input, 'mdx'), []);
});

test('the mdx ignore syntax is its own', () => {
  const ignored = [
    '{/* example:ignore illustrative fragment */}',
    '',
    '```tsx',
    '<Thing />',
    '```'
  ].join('\n');

  assert.deepEqual(ungatedFences(ignored, 'mdx'), []);
  // The markdown syntax must NOT satisfy an mdx doc: an HTML comment there is
  // a build error, so accepting it would wave through a file that cannot ship.
  assert.deepEqual(
    ungatedFences('<!-- example:ignore -->\n\n```tsx\n```', 'mdx'),
    [3]
  );
});
