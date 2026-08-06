---
'@reely/provider-vimeo': patch
---

The Vimeo embed iframe now declares `referrerpolicy="strict-origin-when-cross-origin"`,
so the embedding page's path and query no longer reach Vimeo with the iframe
request — only its origin does, which is what Vimeo's domain-restriction check
needs, so a private or domain-locked source still loads. This is a narrowing of
what the existing embed sends, not a new capability, hence `patch`.

The `allow` list also drops `encrypted-media`, which backed no feature Reely
exposes. `autoplay`, `fullscreen` and `picture-in-picture` are unchanged and
keep working exactly as before.
