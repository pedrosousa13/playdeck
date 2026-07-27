import assert from 'node:assert/strict';
import test from 'node:test';
import { markerNames, renderDoc, uncoveredExports } from './docs-examples.mjs';

/** @type {Map<string, { source: string; language: 'ts' | 'tsx' }>} */
const fixtures = new Map([
  ['demo', { source: 'export const a = 1;\n', language: 'ts' }],
  ['ui', { source: 'export const B = () => null;\n', language: 'tsx' }]
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
