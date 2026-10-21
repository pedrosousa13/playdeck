// @vitest-environment node
//
// Demonstrated red by substitute mutation (docs/agents/demonstrated-red.md):
// `isValidMediaQuery` has no prior version to revert to, so two mutations
// stand in for it, each run against the real implementation below and
// reverted after.
//
// `isValidMediaQuery = () => false` falsified every "accepts a real
// breakpoint query" case: 7 failed, each `expected false to be true`.
//
// `isValidMediaQuery = () => true` falsified every "rejects" case: 15
// failed, each `expected true to be false` -- the 5 hostile-value cases, the
// 6 malformed-shape cases, and the 4 non-string cases this file's last block
// adds. The non-string block has its own, non-substitute red recorded
// beside it: `null` genuinely threw against the unguarded implementation.

import { expect, test } from 'vitest';
import { isValidMediaQuery } from '../src/index';

test.each([
  '(max-width: 600px)',
  '(min-width: 1024px)',
  '(orientation: portrait)',
  '(prefers-color-scheme: dark)',
  'screen and (max-width: 600px)',
  'not all and (monochrome)',
  '(min-resolution: 2dppx)'
])('accepts a real breakpoint query: %s', (value) => {
  expect(isValidMediaQuery(value)).toBe(true);
});

// A hostile string never reaches a `media` attribute or `matchMedia`
// (`viewport-media.tsx`): a quote or an angle bracket could break out of the
// attribute context in server HTML, and a `javascript:` attempt is refused
// the same way a source URL is, even though `media` is never resolved as a
// URL -- the validator's shape allowlist simply has no scheme in it.
test.each([
  ['a quote', '(max-width: 600px)"'],
  ['an angle bracket', '<script>alert(1)</script>'],
  ['a javascript: attempt', 'javascript:alert(1)'],
  ['an empty string', ''],
  [
    'an over-long value',
    `screen and ${'(max-width: 600px) and '.repeat(10)}(max-width: 600px)`
  ]
])('rejects a hostile value (%s)', (_label, value) => {
  expect(isValidMediaQuery(value)).toBe(false);
});

// Shape, not merely charset: unbalanced parens, a stray colon outside one and
// doubled whitespace are all refused rather than quietly accepted.
test.each([
  '(max-width: 600px',
  'max-width: 600px)',
  'screen:  (max-width: 600px)',
  ' (max-width: 600px)',
  '(max-width: 600px) ',
  '(max-width:600px)and(max-width:1200px)'
])('rejects a malformed query shape: %s', (value) => {
  expect(isValidMediaQuery(value)).toBe(false);
});

// `candidate.media` is typed `string | undefined` in
// `VideoFileSource['sources']`, but the call site in `viewport-media.tsx`
// only excludes `undefined` -- untyped CMS or JSON data walking past that
// declared type can still hand this a `null`, a number or an object, the
// same gap #224's own comment (`viewport-media.tsx`) already names for other
// declared-`string` fields. Every one of these must be rejected, never
// thrown: a throw here would crash the whole `Media` render instead of
// dropping the one poisoned entry and publishing the notice.
//
// Demonstrated red: run against the code as it stood before this commit
// (`value.length > 0 && …`, no type guard), `null` failed with
//
//   TypeError: Cannot read properties of null (reading 'length')
//
// -- a crash, not a rejection -- which is exactly the bug this guards
// against. `42` and `{}` did not throw (neither has a `.length`, so
// `undefined > 0` is simply `false`), but passed only by accident, with no
// guard making that a deliberate answer; `isNonEmptyString` makes it one.
test.each([
  ['null', null],
  ['a number', 42],
  ['an object', {}],
  ['an empty string', '']
])('rejects a non-string value without throwing (%s)', (_label, value) => {
  expect(() => isValidMediaQuery(value)).not.toThrow();
  expect(isValidMediaQuery(value)).toBe(false);
});
