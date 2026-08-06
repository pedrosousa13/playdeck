---
'@reely/provider-wistia': minor
'@reely/core': minor
'@reely/react': minor
---

Add Wistia as a fifth provider. `detectSource` recognises Wistia URLs and
`@reely/core` exports `WistiaSource`; `@reely/react`'s `loadProvider` lazily
imports `@reely/provider-wistia` the same way it does Vimeo, so a consumer who
never plays a Wistia source ships none of its code. `Media` mounts a `<div>`
for the `<wistia-player>` custom element the provider appends into it, the
same treatment YouTube and Vimeo get.
