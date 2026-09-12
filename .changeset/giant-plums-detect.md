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
`detect` accepts the URL and returns a value that itself clears the same
allowlist below — a supplied kind can never intercept a URL, or an explicit
source object, a built-in host already claims, and `hls`, `video`, `youtube`,
`vimeo` and `wistia` are reserved names: a `providers` entry keyed by one of
them is skipped outright, before its `detect` is ever called or its entry is
ever looked up against an explicit object, rather than merely turning out to
be unreachable once a resolved source of that `type` reaches this package's
own built-in loader. An explicit source object of a registered, non-reserved
kind resolves too, without calling `detect` — it has already declared its own
kind through its `type` field — once every string value anywhere inside it,
nested included, passes the same allowlist a URL string does; a `detect`
return is held to that same allowlist before it is accepted, and one that
fails it is treated as a decline rather than a failure of detection outright,
so a later registration that would have matched honestly still gets its turn.
The shared URL allowlist (`isPermittedSourceUrl`) runs ahead of every supplied
`detect` and every explicit object alike, exactly where it runs ahead of every
built-in host inside `detectSource` — a scheme the allowlist refuses never
reaches provider-authored code. `providerOptions` gains a further key per
supplied kind, compared for equality the same way the four built-in bags
already are, so an inline object literal does not tear the provider down and
rebuild it every render.

This is not free. `Root` calls the layered detection this prop adds
unconditionally, on every `Player.Root`, whether or not a consumer ever sets
`providers` — so it adds bytes to every composition
`scripts/compare-libraries.mjs` measures, including the no-parts and play-only
rows, neither of which ever passes `providers` at all. Landing it raised three
of that script's committed ceilings to admit the added bytes: the no-parts
row's from 20.00 KB to 20.25 KB, the full row's from 20.75 KB to 21.00 KB, and
the play-only row's from 21.75 KB to 22.00 KB.
