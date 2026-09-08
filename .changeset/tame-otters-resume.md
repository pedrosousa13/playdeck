---
'@playdeck/core': patch
---

Stop a playback patch without a confirming event from consuming a command's origin

`PlayerController` consumed a pending play/pause origin whenever a patch
carried a `playback` key, whether or not the patch arrived with the event
that could actually be labelled with it. `provider-native`'s `onPlaying`
reports `playback: 'playing'` with no event of its own, so on an engine that
reports `playing` ahead of `play` that eventless report consumed the pending
origin, and the real `play` event resolved as `'provider'` — a command's own
origin lost, and any consumer reading `event.origin` told that a viewer had
taken over when nobody had.

Origin consumption is now gated on the event, the same way seek-origin
consumption already was: only an event that can actually confirm the
playback state (`'play'` paired with `playback: 'playing'`, `'pause'` paired
with `playback: 'paused'`) consumes the pending origin.
