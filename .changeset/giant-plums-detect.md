---
'@playdeck/react': minor
---

Let a consumer register a provider for a source kind beyond the five built-in ones

`PlayerSource` was a closed union of exactly five source kinds, and the
loader that turns a resolved source into a running provider hard-wired the
import for each of those five inside this package — supporting a sixth
platform required changing `@playdeck/react` itself. `Player.Root` now takes
a `providers` prop closing that gap:

```tsx
<Player.Root
  providers={{
    acme: {
      detect: (url) => /* this kind's own source object, or undefined */,
      load: () => import('./acme-provider').then((m) => m.createAcmeProvider)
    }
  }}
  source="https://acme.example/videos/123"
>
  {/* … */}
</Player.Root>
```

`detect` takes a URL string and either turns it into that kind's own source
object or declines by returning `undefined`. `load` is a lazy factory —
calling it is what performs this kind's own dynamic import, exactly the way
this package's own `await import('@playdeck/provider-hls')` never runs for a
page that plays nothing but MP4 — and it resolves to the function that builds
the running `ProviderAdapter`, given the mount point, the detected source and
this kind's own `providerOptions` bag.

Detection tries the five built-in kinds first and only then walks
`providers`' own entries, in declaration order, using the first whose
`detect` accepts the URL — a supplied kind can never intercept a URL, or an
explicit source object, a built-in host already claims, and `hls`, `video`,
`youtube`, `vimeo` and `wistia` are reserved names a `providers` entry can
never actually reach for the same reason. An explicit source object of a
registered kind resolves too, without calling `detect` — it has already
declared its own kind through its `type` field — once every string value
anywhere inside it, nested included, passes the same allowlist a URL string
does. The shared URL allowlist (`isPermittedSourceUrl`) runs ahead of every
supplied `detect` and every explicit object alike, exactly where it runs
ahead of every built-in host inside `detectSource` — a scheme the allowlist
refuses never reaches provider-authored code. `providerOptions` gains a
further key per supplied kind, compared for equality the same way the four
built-in bags already are, so an inline object literal does not tear the
provider down and rebuild it every render.

There is no registry and no module-level mutable state: a `Player.Root` that
never sets `providers` reaches none of this at runtime, and the play-only row
`scripts/compare-libraries.mjs` measures stays under its committed ceiling
with the seam included in the build.
