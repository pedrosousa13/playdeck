---
'@playdeck/provider-hls': patch
---

Surface an unclaimed hls.js-path decode error instead of leaving playback stuck reporting "playing"

The embedded native adapter maps the media element's own `error` event to an
errored lifecycle with playback paused, but that patch was discarded outright
on the hls.js engine — hls.js owns error recovery and surfacing on the MSE
path, and hls.js triggers transient element errors of its own during normal
recovery, so publishing the raw event immediately would preempt its bounded
recovery table. What discarding it outright missed: hls.js does not listen
for the element's own `error` event at all, so an element error hls.js never
itself reports as a fatal `ERROR` was not owned by anything. `PlayerState.error`
stayed `null` and `playback` stayed `'playing'` on an element that could never
advance.

A raw element error on the hls.js path is now held, unpublished, for
`HLS_JS_ELEMENT_ERROR_TIMEOUT_MS` (3000ms, derived from hls.js 1.6.16's own
retry cadence — see the constant's comment in `packages/provider-hls/src/index.ts`)
rather than discarded. The hold is cancelled without publishing anything if,
before it expires, hls.js emits an `ERROR` event of its own (fatal or not) or
runs one of its own recovery entry points (both only ever happen from inside
that same listener), or if playback otherwise progresses. If none of that
happens, the player publishes the same errored/paused shape the embedded
native adapter already produces for a decode error — no new lifecycle value.
