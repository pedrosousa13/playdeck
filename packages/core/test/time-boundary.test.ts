// @vitest-environment node

import { describe, expect, test } from 'vitest';
import {
  atBoundaryEnd,
  boundaryEnd,
  boundaryStart,
  resolveTimeBoundary,
  withinBoundary
} from '../src/index';

describe('startTime sanitisation', () => {
  test.each<[string, number | undefined, number]>([
    ['undefined', undefined, 0],
    ['zero', 0, 0],
    ['negative', -1, 0],
    ['NaN', Number.NaN, 0],
    ['Infinity', Number.POSITIVE_INFINITY, 0],
    ['-Infinity', Number.NEGATIVE_INFINITY, 0],
    ['a whole second', 12, 12],
    ['a fraction', 1.5, 1.5]
  ])('resolves %s to %s', (_label, startTime, expected) => {
    expect(resolveTimeBoundary({ startTime }).startTime).toBe(expected);
  });
});

describe('endTime sanitisation', () => {
  test.each<[string, number | undefined, number | undefined]>([
    ['undefined', undefined, undefined],
    ['NaN', Number.NaN, undefined],
    ['Infinity', Number.POSITIVE_INFINITY, undefined],
    ['-Infinity', Number.NEGATIVE_INFINITY, undefined],
    ['zero', 0, undefined],
    ['equal to the start', 10, undefined],
    ['below the start', 9, undefined],
    ['above the start', 11, 11]
  ])('resolves %s to %s against a start of 10', (_label, endTime, expected) => {
    expect(resolveTimeBoundary({ startTime: 10, endTime }).endTime).toBe(
      expected
    );
  });

  test('is measured against the sanitised start, not the raw one', () => {
    // A negative start sanitises to 0, so an end of 5 is still above it.
    expect(resolveTimeBoundary({ startTime: -20, endTime: 5 })).toEqual({
      startTime: 0,
      endTime: 5
    });
  });
});

describe('boundaryEnd', () => {
  test.each<
    [string, number | undefined, number | null | undefined, number | undefined]
  >([
    ['no end, finite duration', undefined, 30, 30],
    ['no end, null duration', undefined, null, undefined],
    ['no end, undefined duration', undefined, undefined, undefined],
    ['no end, live duration', undefined, Number.POSITIVE_INFINITY, undefined],
    ['end, no duration', 20, undefined, 20],
    ['end inside duration', 20, 30, 20],
    ['end past duration', 40, 30, 30],
    ['end, live duration', 20, Number.POSITIVE_INFINITY, 20]
  ])('resolves %s', (_label, endTime, duration, expected) => {
    const boundary = resolveTimeBoundary({ startTime: 5, endTime });
    expect(boundaryEnd(boundary, duration)).toBe(expected);
  });
});

describe('boundaryStart', () => {
  test('is the sanitised start when it sits inside the window', () => {
    const boundary = resolveTimeBoundary({ startTime: 5, endTime: 20 });
    expect(boundaryStart(boundary, 30)).toBe(5);
  });

  test('clamps a start past the duration', () => {
    const boundary = resolveTimeBoundary({ startTime: 50 });
    expect(boundaryStart(boundary, 30)).toBe(30);
  });

  test('clamps a start past a duration-clamped end', () => {
    const boundary = resolveTimeBoundary({ startTime: 50, endTime: 80 });
    expect(boundaryStart(boundary, 20)).toBe(20);
  });

  test('is the start itself when there is no effective end', () => {
    const boundary = resolveTimeBoundary({ startTime: 50 });
    expect(boundaryStart(boundary, undefined)).toBe(50);
  });
});

describe('atBoundaryEnd', () => {
  test.each<[string, number | null | undefined, number]>([
    ['no duration', undefined, 999],
    ['at the duration', 30, 30],
    ['past the duration', 30, 31]
  ])('is false with no endTime and %s', (_label, duration, time) => {
    const boundary = resolveTimeBoundary({ startTime: 5 });
    expect(atBoundaryEnd(boundary, duration, time)).toBe(false);
  });

  test.each<[string, number, boolean]>([
    ['before the end', 19.9, false],
    ['exactly at the end', 20, true],
    ['past the end', 21, true]
  ])('is %s at %s', (_label, time, expected) => {
    const boundary = resolveTimeBoundary({ startTime: 5, endTime: 20 });
    expect(atBoundaryEnd(boundary, 30, time)).toBe(expected);
  });

  test('uses the duration-clamped end', () => {
    const boundary = resolveTimeBoundary({ startTime: 5, endTime: 40 });
    expect(atBoundaryEnd(boundary, 30, 30)).toBe(true);
    expect(atBoundaryEnd(boundary, 30, 29)).toBe(false);
  });
});

describe('withinBoundary', () => {
  test.each<[string, number, number]>([
    ['below the start', 1, 5],
    ['at the start', 5, 5],
    ['inside the window', 12, 12],
    ['at the end', 20, 20],
    ['past the end', 25, 20]
  ])('clamps a time %s', (_label, time, expected) => {
    const boundary = resolveTimeBoundary({ startTime: 5, endTime: 20 });
    expect(withinBoundary(boundary, 30, time)).toBe(expected);
  });

  test('has no upper bound with no endTime and no duration', () => {
    const boundary = resolveTimeBoundary({ startTime: 5 });
    expect(withinBoundary(boundary, undefined, 9999)).toBe(9999);
  });

  test('clamps to the duration with no endTime', () => {
    const boundary = resolveTimeBoundary({ startTime: 5 });
    expect(withinBoundary(boundary, 30, 9999)).toBe(30);
  });

  test('clamps to the effective end when the start is past it', () => {
    const boundary = resolveTimeBoundary({ startTime: 50, endTime: 80 });
    expect(withinBoundary(boundary, 20, 0)).toBe(20);
  });
});
