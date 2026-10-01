// `resolveYouTubePosterUrl` is the pure, synchronous half of #859: a poster
// still for a dormant `loading="interaction"` root, or for the server, where
// `poster="provider"` cannot resolve because no provider has attached. These
// tests cover the function itself; `packages/react/test/youtube-poster-ssr.test.tsx`
// covers the no-request promise end to end, through a rendered `Player.Root`.
//
// Demonstrated red (docs/agents/demonstrated-red.md), additive feature, so
// each is the mutation fallback -- named, run against the real suite below,
// and reverted once the real output was recorded:
//
// 1. The two length-boundary tests and the over-long id test: with the
//    `youTubeVideoIdShape.test(videoId)` guard dropped from
//    `resolveYouTubePosterUrl` (`return youTubePosterUrl(videoId);`
//    unconditionally), all three failed, e.g. "returns null for an id one
//    character short of YouTube's 11-character shape" --
//    `expected 'https://i.ytimg.com/vi/dQw4w9WgXc/hqdefault.jpg' to be null`.
//
// 2. The look-alike-host, `javascript:`, `data:`, path-traversal and
//    query-fragment tests (plus the two length-boundary ones and two
//    positive-detection guards, as collateral): with `detectSource` replaced
//    entirely by a naive extraction -- a string's `v=` query param or its
//    last path segment, an object's `videoId` field read and interpolated
//    with no validation at all -- 11 of 15 tests failed. Two from the named
//    group: "returns null for a look-alike host, full URL form" --
//    `expected 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' to be
//    null` (the naive extractor reads `v=dQw4w9WgXcQ` off
//    `https://evil.example/watch?v=dQw4w9WgXcQ` with no host check at all)
//    -- and "returns null for an id carrying a path traversal segment" --
//    `expected 'https://i.ytimg.com/vi/../../etc/passwd/hqdefault.jpg' to be
//    null`.
//
// 3. The fixed-host test: with the return changed to
//    `` `https://${videoId}.i.ytimg.com/vi/${videoId}/hqdefault.jpg` ``,
//    "the returned URL's origin is the fixed ytimg host, with the id the
//    only interpolated part" failed --
//    `expected 'https://m7lc1uvf-ve.i.ytimg.com' to be 'https://i.ytimg.com'`.

import { expect, test } from 'vitest';
import { resolveYouTubePosterUrl } from '../src/adapter-values';

const posterUrl = (id: string): string =>
  `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

test('resolves the still from a full-host watch URL, the same id detectSource would read', () => {
  expect(
    resolveYouTubePosterUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  ).toBe(posterUrl('dQw4w9WgXcQ'));
});

test('resolves the still from a short-host URL', () => {
  expect(resolveYouTubePosterUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
    posterUrl('dQw4w9WgXcQ')
  );
});

test('resolves the still from an explicit { type: "youtube", videoId } source object', () => {
  expect(
    resolveYouTubePosterUrl({ type: 'youtube', videoId: 'dQw4w9WgXcQ' })
  ).toBe(posterUrl('dQw4w9WgXcQ'));
});

test('returns null for a source another provider claims', () => {
  expect(resolveYouTubePosterUrl('https://vimeo.com/76979871')).toBeNull();
  expect(
    resolveYouTubePosterUrl({ type: 'wistia', mediaId: 'abc123' })
  ).toBeNull();
});

test('returns null for a value no detector would resolve at all', () => {
  expect(resolveYouTubePosterUrl(undefined)).toBeNull();
  expect(resolveYouTubePosterUrl(42)).toBeNull();
  expect(resolveYouTubePosterUrl('')).toBeNull();
  expect(
    resolveYouTubePosterUrl('not a url and not an id shape either')
  ).toBeNull();
});

// Security acceptance criteria (issue #859's addendum comment): hostile input
// returns null rather than a URL a consumer would render into an `img src`.

test('returns null for a look-alike host, full URL form', () => {
  expect(
    resolveYouTubePosterUrl('https://evil.example/watch?v=dQw4w9WgXcQ')
  ).toBeNull();
});

test('returns null for a look-alike host built as a YouTube subdomain prefix', () => {
  expect(
    resolveYouTubePosterUrl(
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'
    )
  ).toBeNull();
});

test('returns null for a javascript: URL', () => {
  expect(resolveYouTubePosterUrl('javascript:alert(1)')).toBeNull();
});

test('returns null for a data: URL', () => {
  expect(
    resolveYouTubePosterUrl('data:text/html,<script>alert(1)</script>')
  ).toBeNull();
});

test('returns null for an id carrying a path traversal segment', () => {
  expect(
    resolveYouTubePosterUrl({ type: 'youtube', videoId: '../../etc/passwd' })
  ).toBeNull();
});

test('returns null for an id carrying a query fragment', () => {
  expect(
    resolveYouTubePosterUrl({ type: 'youtube', videoId: 'dQw4w9WgXcQ?x=1' })
  ).toBeNull();
});

test("returns null for an id one character short of YouTube's 11-character shape", () => {
  expect(
    resolveYouTubePosterUrl({ type: 'youtube', videoId: 'dQw4w9WgXc' })
  ).toBeNull();
});

test("returns null for an id one character past YouTube's 11-character shape", () => {
  expect(
    resolveYouTubePosterUrl({ type: 'youtube', videoId: 'dQw4w9WgXcQQ' })
  ).toBeNull();
});

test('returns null for an over-long id', () => {
  expect(
    resolveYouTubePosterUrl({
      type: 'youtube',
      videoId: 'dQw4w9WgXcQ'.repeat(50)
    })
  ).toBeNull();
});

test("the returned URL's origin is the fixed ytimg host, with the id the only interpolated part", () => {
  const url = resolveYouTubePosterUrl({
    type: 'youtube',
    videoId: 'M7lc1UVf-VE'
  });
  expect(url).not.toBeNull();
  const parsed = new URL(url!);
  expect(parsed.origin).toBe('https://i.ytimg.com');
  expect(parsed.pathname).toBe('/vi/M7lc1UVf-VE/hqdefault.jpg');
});
