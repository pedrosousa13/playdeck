import { expect, test } from 'vitest';
import { numberField } from '../src/adapter-values';

// The bridge these values cross is `postMessage`, so what arrives is whatever
// the far side put on the wire and nothing type-checks it on the way. #463 is
// the case that proved it: the SDK's own `vimeo_t_` listener calls
// `setCurrentTime` with the url substring it matched — a string — and the embed
// echoes that value straight back in the `seconds` of the events it publishes.
// These tests pin both halves: a plain decimal number that arrived in string
// form is read, and every other string shape is refused — including the exotic
// numeric literals `Number` would otherwise accept, since the string on this
// path is a slice of the embedding page's url and nobody here chose it.

test('reads a number that arrived as a number', () => {
  expect(numberField({ seconds: 45 }, 'seconds')).toBe(45);
  expect(numberField({ seconds: 0 }, 'seconds')).toBe(0);
  expect(numberField({ seconds: -1.5 }, 'seconds')).toBe(-1.5);
});

// The defect itself, pinned so the coercion cannot silently narrow again.
test('reads a number that arrived as a string', () => {
  expect(numberField({ seconds: '45' }, 'seconds')).toBe(45);
  expect(numberField({ seconds: '45.5' }, 'seconds')).toBe(45.5);
  expect(numberField({ seconds: '0' }, 'seconds')).toBe(0);
  expect(numberField({ seconds: ' 45 ' }, 'seconds')).toBe(45);
  expect(numberField({ seconds: '-45' }, 'seconds')).toBe(-45);
});

// A leading `+` is the one sign-bearing form kept, because `'+45'` spells the
// value it reads as. The literal notations below do not, and that is the whole
// reason they are refused rather than an accident of the grammar.
test('reads a decimal string carrying a leading plus', () => {
  expect(numberField({ seconds: '+45' }, 'seconds')).toBe(45);
});

// The trap this fix has to walk around. `Number('')` is 0, not `NaN`, and so is
// `Number(' ')`, `Number([])` and `Number(false)` — a bare `Number(value)` would
// turn every one of them into a valid playhead position of zero and publish it.
// `'12abc'` and `'Infinity'` are the other two shapes a url substring can take
// that must not become a position.
//
// The literal notations below are the same trap one level down: `Number` reads
// the whole JavaScript numeric-literal grammar, so a bare coercion answers 16
// for `'0x10'` and 1000 for `'1e3'` — a position nothing in the url spells. The
// non-breaking space is the trap in the gate rather than the coercion: `trim`
// strips U+00A0, so a trim-based gate would have let `'\u00a045'` through as
// 45. The SDK forwards none of these for a real seek, so none of them is read.
test.each([
  ['an empty string', ''],
  ['a whitespace-only string', ' '],
  ['a non-numeric string', 'abc'],
  ['a string with a numeric prefix', '12abc'],
  ['the string Infinity', 'Infinity'],
  ['the string NaN', 'NaN'],
  ['a hexadecimal literal', '0x10'],
  ['a binary literal', '0b11'],
  ['an octal literal', '0o17'],
  ['exponent notation', '1e3'],
  ['a string padded with a non-breaking space', '\u00a045'],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['null', null],
  ['undefined', undefined],
  ['true', true],
  ['false', false],
  ['an empty array', []],
  ['an array holding a number', [45]],
  ['an object', {}]
])('refuses %s', (_label, value) => {
  expect(numberField({ seconds: value }, 'seconds')).toBeUndefined();
});

test('refuses a field that is not there at all', () => {
  expect(numberField({}, 'seconds')).toBeUndefined();
  expect(numberField(null, 'seconds')).toBeUndefined();
  expect(numberField('not a record', 'seconds')).toBeUndefined();
});
