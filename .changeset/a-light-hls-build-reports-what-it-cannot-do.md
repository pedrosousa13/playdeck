---
'@playdeck/core': minor
'@playdeck/provider-hls': minor
---

A light hls.js build reports the captions it cannot show, and a subtitle-less stream stops claiming to be checking

Two capability bugs on the hls.js engine, both of them `selectTextTrack`
reporting `unknown` / `provider-check` for the whole session — the value that
means "still checking" — long after the answer was known.

**A stream with no subtitles.** The capability was only ever written by the
`SUBTITLE_TRACKS_UPDATED` handler, and real hls.js does not fire that event when
a manifest declares no subtitle renditions at all. So an ordinary subtitle-less
HLS stream never settled. The unit test that covered the `unavailable` / `source`
branch fired the event with an empty array by hand, which hls.js never does, so
the gap did not show. It is now settled from `MANIFEST_PARSED`, which fires for
every manifest.

**A light hls.js build.** `hls.js/light`, reachable through `loadHls`, saves
about 53 KB gzip by compiling out the subtitle controllers along with alternate
audio, CMCD and EME. It still parses subtitle renditions and reports them once,
then never emits `SUBTITLE_TRACKS_UPDATED`, so the tracks could be counted and
never selected. That combination now publishes:

```ts
capabilities.selectTextTrack; // { status: 'unavailable', reason: 'provider-build' }
```

`Availability` gains the `provider-build` reason for it. Neither neighbour was
true: the provider is able, so `provider` would be wrong, and the media does
carry subtitles, so `source` would be wrong. It is breaking for a consumer
switching exhaustively on the reason, which is why it lands before 1.0.

The build is told apart by reading `Hls.DefaultConfig` for the controllers the
light build omits — synchronous, settled before anything loads, and no deadline.
A module exposing no `DefaultConfig` is read as the full build, so an
unrecognised one behaves exactly as it did before.
