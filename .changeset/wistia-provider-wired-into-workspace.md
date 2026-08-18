---
'@playdeck/provider-wistia': minor
'@playdeck/core': minor
'@playdeck/react': minor
---

Add Wistia as a fifth provider. `detectSource` recognises Wistia URLs and
`@playdeck/core` exports `WistiaSource`; `@playdeck/react`'s `loadProvider` lazily
imports `@playdeck/provider-wistia` the same way it does Vimeo, so a consumer who
never plays a Wistia source ships none of its code. `Media` mounts a `<div>`
for the `<wistia-player>` custom element the provider appends into it, the
same treatment YouTube and Vimeo get.
