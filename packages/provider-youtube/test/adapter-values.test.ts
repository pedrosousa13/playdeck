import { expect, test } from 'vitest';
import { nextBufferView } from '../src/adapter-values';

test('reports no range while the buffer end sits at or behind the playhead', () => {
  expect(nextBufferView(undefined, 10, 10)).toBeUndefined();
  expect(nextBufferView(undefined, 10, 4)).toBeUndefined();
});

test('anchors a first range at the playhead that proved it', () => {
  expect(nextBufferView(undefined, 5, 30)).toEqual({ anchor: 5, end: 30 });
});

test('keeps the earliest playhead seen while one range holds the thumb', () => {
  const first = nextBufferView(undefined, 5, 30);
  const second = nextBufferView(first, 9, 40);
  expect(second).toEqual({ anchor: 5, end: 40 });
  expect(nextBufferView(second, 7, 45)).toEqual({ anchor: 5, end: 45 });
});

test('re-anchors on a playhead past the end of the range it remembered', () => {
  const previous = { anchor: 5, end: 30 };
  expect(nextBufferView(previous, 31, 60)).toEqual({ anchor: 31, end: 60 });
});

test('keeps the anchor when the playhead lands exactly on the known end', () => {
  const previous = { anchor: 5, end: 30 };
  expect(nextBufferView(previous, 30, 60)).toEqual({ anchor: 5, end: 60 });
});

test('drops the range, anchor and all, once playback outruns the buffer', () => {
  expect(nextBufferView({ anchor: 5, end: 30 }, 31, 30)).toBeUndefined();
});
