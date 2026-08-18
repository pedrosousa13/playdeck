---
'@playdeck/react': patch
---

`Player.Poster` now stays visible when autoplay is refused on a native or HLS
source (#242). A decoded first frame hides the poster on purpose — it is what
the poster stood in for, and a preload that reaches a frame without playing
never confirms playback for the poster to react to — but that writer read no
autoplay state at all, so a `loadeddata` after Safari rejected an audible
attempt uncovered a paused frame: no cover, no playback, and no gesture that
asked for either.

The frame writer now defers for as long as autoplay is configured and has not
played: while the attempt is still to come, while it is in flight, and once it
has ended without playback. An attempt still in flight counts because a decode
that beat the rejection would put the poster back out of reach; one still to
come counts because media that attaches already decodable — a cached clip, or a
`loadeddata` that arrives before the provider loads — reaches this writer before
the attempt can start. Confirmed playback is unaffected: the poster hides the
moment playback starts, autoplay-driven or not, and a source with no autoplay
still uncovers itself on the first frame.
