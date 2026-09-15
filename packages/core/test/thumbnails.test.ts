import { expect, test } from 'vitest';
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
