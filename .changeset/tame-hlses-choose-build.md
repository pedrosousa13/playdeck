---
'@playdeck/provider-hls': minor
'@playdeck/react': minor
---

Select an hls.js build through `Player.Root`

`createHlsProvider` has always taken `loadHls`, for pinning an hls.js version
or swapping in `hls.js/light`, but nothing a `Player.Root` consumer could pass
reached it — the option was reachable only by mounting the HLS adapter
directly (#579).

`HlsProviderOptions` gains `build`, `'full'` (the default) or `'light'`, a name
rather than the loader function itself. `@playdeck/react`'s
`PlayerProviderOptions` gains a matching `hls` bag:

```tsx
<Player.Root
  providerOptions={{ hls: { build: 'light' } }}
  source={{ type: 'hls', src: '/master.m3u8' }}
>
  {/* … */}
</Player.Root>
```

`build` is a primitive by design, not a shorthand that happens to be one:
every value a provider option bag declares is compared with `Object.is`
(`providerBagEqual`), so a function passed inline — a new one on every render —
would tear the hls.js engine down and rebuild it, and lose the playback
position, on every render that passed it. `loadHls` itself stays exactly where
it was, for pinning a version or serving hls.js from somewhere else, and
reaching it still means mounting `createHlsProvider` directly.

`PlayerProviderOptions`'s bags are now guarded at the type level to reject a
function-valued option the same way — a bag typed through the new (internal)
`PrimitiveOptionBag` constraint fails to compile if a future option is a
function, rather than shipping the same hazard `build` was added to avoid.
`youtube`'s existing `loadIframeApi` predates the guard and is not yet covered
by it; see the comment above `PlayerProviderOptions` in
`packages/react/src/provider-loaders.ts`.
