import { expect, test } from 'vitest';
import type { ThumbnailCue } from '@playdeck/core';
import { parseThumbnailCues, thumbnailCueAt } from '@playdeck/core';

test('parses a cue whose payload carries a pixel xywh region', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'sprite.jpg#xywh=0,0,160,90'
  ].join('\n');

  expect(parseThumbnailCues(vtt)).toEqual([
    {
      startTime: 0,
      endTime: 5,
      url: 'sprite.jpg',
      region: { x: 0, y: 0, width: 160, height: 90 }
    }
  ]);
});

test('parses the explicit pixel: unit the same as the unitless form', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'sprite.jpg#xywh=pixel:10,20,160,90'
  ].join('\n');

  expect(parseThumbnailCues(vtt)[0]?.region).toEqual({
    x: 10,
    y: 20,
    width: 160,
    height: 90
  });
});

test('treats a percent: xywh fragment as no region, stripping it from the URL anyway', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'sprite.jpg#xywh=percent:0,0,25,25'
  ].join('\n');

  const [cue] = parseThumbnailCues(vtt);
  expect(cue?.region).toBeNull();
  expect(cue?.url).toBe('sprite.jpg');
});

test('leaves a negative xywh fragment untouched, with no region', () => {
  // A negative offset or extent has no meaning for a sprite region, so this
  // must be treated exactly like any other fragment the module does not
  // recognise: left attached to the URL, not parsed into a region with a
  // negative width and height.
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'sprite.jpg#xywh=-5,-5,-160,-90'
  ].join('\n');

  const [cue] = parseThumbnailCues(vtt);
  expect(cue?.region).toBeNull();
  expect(cue?.url).toBe('sprite.jpg#xywh=-5,-5,-160,-90');
});

test('leaves a payload URL with no xywh fragment untouched, with no region', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'thumb-0.jpg'
  ].join('\n');

  const [cue] = parseThumbnailCues(vtt);
  expect(cue?.region).toBeNull();
  expect(cue?.url).toBe('thumb-0.jpg');
});

test('sorts published cues ascending by startTime regardless of file order', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:05.000 --> 00:00:10.000',
    'second.jpg',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'first.jpg'
  ].join('\n');

  expect(parseThumbnailCues(vtt).map((cue) => cue.url)).toEqual([
    'first.jpg',
    'second.jpg'
  ]);
});

test('freezes the published collection and each cue', () => {
  const vtt = ['WEBVTT', '', '00:00:00.000 --> 00:00:05.000', 'a.jpg'].join(
    '\n'
  );

  const cues = parseThumbnailCues(vtt);
  expect(Object.isFrozen(cues)).toBe(true);
  expect(Object.isFrozen(cues[0])).toBe(true);
});

test('accepts an identifier line above the timing line', () => {
  const vtt = [
    'WEBVTT',
    '',
    'cue-1',
    '00:00:00.000 --> 00:00:05.000',
    'a.jpg'
  ].join('\n');

  expect(parseThumbnailCues(vtt)).toHaveLength(1);
});

test('skips NOTE, STYLE and REGION blocks, even ones whose body itself looks like a cue', () => {
  // Each skipped block's body, after its opening keyword line, is itself a
  // perfectly valid timing line plus payload — text that would parse into a
  // real cue if the block weren't recognised and skipped by its opening
  // keyword. That is what makes this test able to fail: a keyword block
  // with a body that doesn't parse as a cue would be dropped by "no timing
  // line found" regardless of whether the keyword check exists at all.
  const vtt = [
    'WEBVTT',
    '',
    'NOTE',
    '00:00:20.000 --> 00:00:25.000',
    'note.jpg',
    '',
    'STYLE',
    '00:00:30.000 --> 00:00:35.000',
    'style.jpg',
    '',
    'REGION',
    '00:00:40.000 --> 00:00:45.000',
    'region.jpg',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'a.jpg'
  ].join('\n');

  expect(parseThumbnailCues(vtt)).toEqual([
    { startTime: 0, endTime: 5, url: 'a.jpg', region: null }
  ]);
});

test('accepts the MM:SS.mmm short timestamp form', () => {
  const vtt = ['WEBVTT', '', '00:00.000 --> 00:05.000', 'a.jpg'].join('\n');

  expect(parseThumbnailCues(vtt)).toEqual([
    { startTime: 0, endTime: 5, url: 'a.jpg', region: null }
  ]);
});

test('ignores cue settings trailing the timing line', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:05.000 line:0 align:start',
    'a.jpg'
  ].join('\n');

  expect(parseThumbnailCues(vtt)).toEqual([
    { startTime: 0, endTime: 5, url: 'a.jpg', region: null }
  ]);
});

test('drops a cue with no payload line', () => {
  const vtt = ['WEBVTT', '', '00:00:00.000 --> 00:00:05.000', ''].join('\n');

  expect(parseThumbnailCues(vtt)).toEqual([]);
});

test('drops a cue whose timing line does not parse', () => {
  const vtt = ['WEBVTT', '', 'not-a-timestamp --> also-not', 'a.jpg'].join(
    '\n'
  );

  expect(parseThumbnailCues(vtt)).toEqual([]);
});

test('drops a cue whose end is at or before its start', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:05.000 --> 00:00:05.000',
    'a.jpg',
    '',
    '00:00:10.000 --> 00:00:05.000',
    'b.jpg'
  ].join('\n');

  expect(parseThumbnailCues(vtt)).toEqual([]);
});

test('returns an empty collection for a body with no WEBVTT header', () => {
  // The body after the bogus first line is a fully valid timing-line-plus-
  // payload cue — text that would parse into a real cue if the header check
  // weren't there to reject the whole file first. That is what makes this
  // test able to fail: a header-less body with no such cue underneath it
  // would come back empty regardless of whether the header check exists at
  // all.
  const vtt = [
    'not a vtt file at all',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'a.jpg'
  ].join('\n');

  expect(parseThumbnailCues(vtt)).toEqual([]);
});

test('accepts a leading BOM and trailing text on the header line', () => {
  const vtt = [
    '﻿WEBVTT - thumbnails',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'a.jpg'
  ].join('\n');

  expect(parseThumbnailCues(vtt)).toHaveLength(1);
});

test('thumbnailCueAt returns the cue whose [startTime, endTime) contains the time', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:05.000',
    'first.jpg',
    '',
    '00:00:05.000 --> 00:00:10.000',
    'second.jpg'
  ].join('\n');
  const cues = parseThumbnailCues(vtt);

  expect(thumbnailCueAt(cues, 0)?.url).toBe('first.jpg');
  expect(thumbnailCueAt(cues, 4.999)?.url).toBe('first.jpg');
  expect(thumbnailCueAt(cues, 5)?.url).toBe('second.jpg');
  expect(thumbnailCueAt(cues, 9.999)?.url).toBe('second.jpg');
});

test('thumbnailCueAt returns null outside every cue range', () => {
  const vtt = ['WEBVTT', '', '00:00:00.000 --> 00:00:05.000', 'a.jpg'].join(
    '\n'
  );
  const cues = parseThumbnailCues(vtt);

  expect(thumbnailCueAt(cues, 10)).toBeNull();
  expect(thumbnailCueAt([], 0)).toBeNull();
});

// #749: a file whose cue count exceeds the module's own cue cap publishes no
// cues at all, the same "no thumbnails" result an unparseable file already
// gets -- not a truncated list of the cues found before the cap.
//
// The cap itself (../src/thumbnails.ts's THUMBNAIL_CUE_CAP) is deliberately
// not exported: `./thumbnails` is a published subpath, built as its own
// bundle, so anything exported from that file ships in dist/thumbnails.js
// and becomes public API -- an implementation-detail cap is not something
// this module promises consumers. So this test brackets it by behaviour
// instead of by value: 20,000 cues is already well past the ~10,800 a
// 3-hour film produces at one cue per second (the brief's own figure for
// "any real sprite VTT"), and must still parse in full; 1,000,000 is
// unreasonable by any measure, and must come back empty. Both hold
// regardless of the cap's exact number, as long as it sits between them --
// which is what "sized well above any real sprite VTT" requires of it.
//
// Red, natural (with the cap's enforcement line removed): the second
// assertion failed --
//
//   AssertionError: expected [ { startTime: +0, ... }, ...(999999) ] to
//   deeply equal []
//
// (1,000,000 cues came back instead of none). The first assertion, the
// 20,000-cue file, already passed without the enforcement line -- which is
// exactly why it stays in this test: it is what proves the fix does not also
// reject a legitimate, merely very large file.
test('a file with an unreasonable cue count publishes no cues at all, but a merely very large one still parses', () => {
  // A cue count this large runs well past 99 minutes, so a correct
  // HH:MM:SS.mmm needs real wraparound at 60 and 3600 -- not just a fixed
  // "00:" hours prefix, which would push minutes past two digits and fail
  // TIMESTAMP's own `\d{2}` match, silently dropping the cue instead of
  // counting it.
  const formatTimestamp = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
  };

  const cueBlock = (start: number): string =>
    [
      `${formatTimestamp(start)} --> ${formatTimestamp(start + 1)}`,
      `${start}.jpg`
    ].join('\n');

  const vttWithCues = (count: number): string =>
    [
      'WEBVTT',
      '',
      ...Array.from({ length: count }, (_, i) => cueBlock(i))
    ].join('\n\n');

  expect(parseThumbnailCues(vttWithCues(20_000))).toHaveLength(20_000);
  expect(parseThumbnailCues(vttWithCues(1_000_000))).toEqual([]);
});

// #749: `thumbnailCueAt` gained a binary search over the running-maximum
// `endTime` (see its own comment in `../src/thumbnails.ts`), replacing
// `cues.find(...)`. This table exists because that replacement must return
// exactly what the linear scan returned, including the cases a real
// (non-overlapping, gapless) sprite VTT never produces but a malformed one
// could: two cues sharing a `startTime`, and a wide cue's span nested inside
// a narrower one's.
//
// Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
// this table cannot be run against the old linear implementation to get a
// meaningful red, since the assertions ARE the linear scan's own output --
// that would trivially pass. Instead, `thumbnailCueAt`'s binary search had
// its comparison mutated from `maxEnd[mid] > time` to `maxEnd[mid] >= time`
// (an off-by-one at the exact-boundary case), which failed at four of the
// sixteen times in this table:
//
//   time=5:  expected 'tie-first.jpg', received 'a.jpg'
//   time=6:  expected null, received 'tie-second.jpg'
//   time=30: expected null (wide's own exact end boundary), received
//            'wide.jpg'
//   time=45: expected null (last's own exact end boundary), received
//            'last.jpg'
//
// Reverted, and the table passed again.
test('thumbnailCueAt matches a linear scan across ties, overlaps, gaps and both open ends', () => {
  // Built by hand rather than through parseThumbnailCues, already in the
  // startTime-sorted order that parser's own stable sort would produce for a
  // file whose blocks appeared in this order -- exactly so cases that parser
  // never itself produces (a startTime tie, a nested overlap) can still be
  // exercised here.
  const cues: readonly ThumbnailCue[] = [
    { startTime: 0, endTime: 5, url: 'a.jpg', region: null }, // 0
    { startTime: 5, endTime: 5.5, url: 'tie-first.jpg', region: null }, // 1
    { startTime: 5, endTime: 6, url: 'tie-second.jpg', region: null }, // 2
    { startTime: 8, endTime: 30, url: 'wide.jpg', region: null }, // 3
    { startTime: 10, endTime: 12, url: 'nested.jpg', region: null }, // 4
    { startTime: 40, endTime: 45, url: 'last.jpg', region: null } // 5
  ];

  // The reference this binary search must match: the exact linear scan
  // `thumbnailCueAt` used before this issue.
  const linearFind = (time: number): ThumbnailCue | null =>
    cues.find((cue) => time >= cue.startTime && time < cue.endTime) ?? null;

  const times = [
    -1, // before the first cue
    0, // exact start boundary of the first cue
    4.999, // just inside the first cue
    5, // exact tie boundary -- both tie cues start here
    5.4, // inside tie-first only
    5.7, // inside tie-second only, after tie-first ends
    6, // the gap between the tie group and the wide cue
    9, // inside wide, before nested starts
    11, // inside both wide and nested -- wide must win (lower index)
    20, // inside wide only, after nested ends
    30, // wide's own exact end boundary -- half-open, must miss
    35, // inside the gap before the last cue
    40, // exact start of the last cue
    44.999, // just inside the last cue
    45, // the last cue's own exact end boundary -- half-open, must miss
    100 // after the last cue
  ];

  // Collected rather than asserted one at a time, so a run that fails shows
  // every mismatching time at once instead of only the first.
  const mismatches: {
    readonly time: number;
    readonly actual: ThumbnailCue | null;
    readonly expected: ThumbnailCue | null;
  }[] = [];
  for (const time of times) {
    const actual = thumbnailCueAt(cues, time);
    const expected = linearFind(time);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push({ time, actual, expected });
    }
  }
  expect(mismatches).toEqual([]);
});
