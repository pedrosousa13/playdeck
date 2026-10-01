---
'@playdeck/provider-native': patch
---

Follow a native caption track's `load`/`error` lifecycle for its `readiness`

A native caption/subtitle track's `readiness` follows its `<track>`
element's `load`/`error` events: `'loaded'` on `load`, `'error'` on a failed
fetch (a 404 or a CORS block), republished only when the value changes. A
`src` change on the element drops the track back to the cue-count reading
until the new resource's own `load`/`error` arrives. A track whose element
has not been discovered keeps the cue-count reading throughout.
