---
'@playdeck/provider-vimeo': minor
---

The Vimeo embed iframe now declares `referrerpolicy="strict-origin-when-cross-origin"`,
so the embedding page's path and query no longer reach Vimeo with the iframe
request — only its origin does, which is what Vimeo's domain-restriction check
needs, so a private or domain-locked source still loads. This half is a
narrowing of what the existing embed sends, nothing more.

The `allow` list also drops `encrypted-media`. `autoplay`, `fullscreen` and
`picture-in-picture` are unchanged and keep working exactly as before, but this
half is a capability withdrawal, not a narrowing: a Vimeo source that needs EME
(Widevine/FairPlay) for DRM-protected playback — an Enterprise/OTT video —
relied on that grant to call `requestMediaKeySystemAccess` from inside the
iframe, and will stop playing after this change where it played before. Nothing
in Playdeck's own option surface ever turned that grant on or off; it is the video
ID a consumer passes, not a Playdeck option, that decides whether a source needs
it. There is no flag to opt back in today — DRM support is out of scope for
this change.

Both land as `minor`: every package is still at `0.0.0` with
`first-prerelease` not yet released, and under 0.x `minor` is the channel a
breaking change travels on.
