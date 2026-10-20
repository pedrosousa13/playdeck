// @vitest-environment node

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
