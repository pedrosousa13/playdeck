---
'@reely/core': minor
'@reely/react': minor
---

Seeks now carry a provenance, the way playback commands already do (#186).
`PlayerController` gains `seekToWithOrigin` and `seekByWithOrigin`, each taking
the same `PlayerEventOrigin` the playback commands take, and `PlayerState` gains
`seekOrigin`. `Player.SeekSlider` tags the seeks it asks for as `'user'`, and
the untagged `seekTo` and `seekBy` keep their signatures and delegate with
`'api'`, exactly as the untagged `play` already did. A seek nobody asked for
stays `'provider'`.

`seeking` is untouched: still a boolean, still true over the same interval.
`seekOrigin` is the additive field beside it, set exactly while a seek is in
flight and `null` the rest of the time — a seek that is not happening has no
provenance. A seek already under way keeps the origin it started with, so a
provider that re-reports `seeking` does not relabel it.

Provider adapters are unchanged. They go on stamping every report they make
`'provider'`, which says who reported the seek and not who asked for it; the
controller replaces that stamp on the `seeking` and `seeked` events whose seek
it holds a request for. What each provider reports therefore decides what a
consumer sees:

- **Native** reports both halves of a seek, so both events carry the origin,
  and `seekOrigin` is readable for the whole of the seek.
- **HLS** forwards the native reports, so it behaves identically.
- **Vimeo** reports both halves off its SDK, so it behaves identically.
- **Wistia** reports only the settled half. `seeked` carries the origin; there
  is no `seeking` report to label, and `seekOrigin` is never set.
- **YouTube** reports no seek at all, so nothing is labelled. This changes
  nothing about YouTube — it published neither event before this.

The request is held until the provider confirms it, and dropped when it cannot
be: a seek command that fails drops its own request, and swapping the provider
or advancing the controller generation drops every request outstanding. A
provider that accepts a seek and then reports nothing for it leaves the request
held, which is what a play command that is never confirmed already does.

This reuses the machinery that already reconciles playback provenance rather
than adding a second one beside it. Playback and seek requests are held apart
because both can be outstanding at once, but they share one lifecycle, and
playback provenance is unchanged in every respect.
