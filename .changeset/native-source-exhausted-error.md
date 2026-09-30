---
'@playdeck/provider-native': patch
---

Publish a `PlayerError` when every native `<source>` candidate fails to load

A `<source>` child fires `error` on itself, not on the media element, when
its candidate fails to load -- a CORS block and a 404 both produce this
shape -- so the media element's own `error` listener never runs and
`PlayerState.error` stays null while the player sits paused with no loadable
source.

The native provider's attachment listens for `error` on every `<source>`
child alongside the media element's own, and publishes a fatal `source`
`PlayerError` once `networkState` reaches `NETWORK_NO_SOURCE` -- the
browser's own signal that no further candidate remains. The message names
`crossOrigin` when it is set, since a host missing CORS headers is the
likeliest cause. A candidate that fails while a later one still succeeds
publishes nothing, and a `src`-attribute media element with no `<source>`
children is unaffected: it already errors on itself.
