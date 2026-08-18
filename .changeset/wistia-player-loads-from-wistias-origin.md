---
'@playdeck/provider-wistia': minor
'@playdeck/react': patch
---

The Wistia provider no longer depends on `@wistia/wistia-player`. It fetches
Wistia's player bundle from `https://fast.wistia.com/player.js` at runtime
instead (#225).

`@wistia/wistia-player@0.7.12` declares `dotenv-webpack` among its own
`dependencies` — build tooling the vendor misfiled as runtime — and
`dotenv-webpack@9.0.0` declares a non-optional `webpack` peer. Package managers
that install peers automatically therefore pulled webpack and its whole tree
(postcss, terser, enhanced-resolve, watchpack) into any install that reached
this provider, for code that is never executed. `@playdeck/react` depends on this
package unconditionally, so the exposure was not opt-in. The workspace pins a
postcss floor to keep that chain patched, but an override applies only to
installs rooted at this workspace: a published tarball carries its own
`dependencies` and nothing else, so the floor could not travel to consumers.

Nothing is bundled in its place. Wistia's npm package was always a shell around
the same CDN — the element fetches its playback engine, embed configuration and
media data from `fast.wistia.com` either way — so the bundle now comes from
there too, as the YouTube provider's `iframe_api` script always has. The script
is Aurora's own entry point, not the legacy `E-v1.js` embed shim: there is still
no `window._wq`.

**What a consumer must change.**

- **`PublicApi` is no longer exported.** Use `WistiaPlayerApi`, which is now
  this package's own declaration of the fifteen handle members the adapter
  drives, rather than a `Pick` of Wistia's. Every one of those fifteen keeps
  Wistia's signature verbatim, overloads included — `time` and `volume` answer a
  number when read and the handle when written, `playbackRate` can still answer
  `undefined` — so a value that satisfied the old type satisfies the new one. If
  you referenced one of the other ~75 members of `PublicApi`, there is no
  replacement here: import it from `@wistia/wistia-player` yourself, which is
  now your dependency to declare.
- **`WistiaLoadedMediaDataDetail` is narrower.** Its `mediaData` restates only
  `mediaType`, the one field this adapter reads. Wistia's `MediaData` declares
  about fifty more; if you read any of them off this event, take the type from
  Wistia's package directly.
- **`loadWistiaPlayer`'s parameter changed shape.** It took
  `() => Promise<unknown>`, a dynamic-module importer. It now takes a
  `WistiaScriptInjector` — `(src: string) => HTMLScriptElement` — which puts the
  script in the document and answers the element it used. Callers who passed
  nothing are unaffected. Callers who passed an importer to serve the bundle
  from elsewhere pass an injector instead, and the affordance is otherwise the
  same one.
- `WistiaPlayerState` and `WistiaPlayerAttribute` are restated locally rather
  than derived from Wistia's `PlayerState` and `keyof Attributes`. Both lists
  were taken mechanically from `0.7.12`'s declarations at the time of the
  change, so no member was intended to move — but nothing in this repo can
  check that any more, and keeping them current is now a manual re-check
  against Wistia's declarations, because the vendor package is no longer
  installed to compare against.

`SCRIPT_LOAD_TIMEOUT_MS` is exported alongside, holding 15 seconds. It is a
second deadline rather than a reuse of `API_READY_TIMEOUT_MS`, because it covers
a different wait: the script fetch, where that one covers the element's
`api-ready` handshake. A script `error` event is not enough on its own — a
captive portal, an inspecting proxy, a region block or a truncated body answers
200 and fires `load` without registering the element, so the deadline is what
turns that into a rejection instead of a player that loads for ever. The two
deadlines run in sequence, so a fully black-holed network reports a recoverable
error in up to thirty seconds. A failed load is not remembered, so `retry()`
genuinely re-fetches; concurrent players share one injection; and a page that
already registered `<wistia-player>` by other means resolves off the registry
without fetching or registering anything twice.

**`@playdeck/react` consumers must act on this even though no React API changed.**
`@playdeck/react` depends on this provider, so any page that can render a Wistia
source now needs `fast.wistia.com` in its `script-src` — a page with a strict
CSP that does not add it will see Wistia sources fail to load where they
previously worked, because the bundle used to arrive through the bundler rather
than the network. Note also that `WistiaScriptInjector` is a `loadWistiaPlayer`
parameter and not a `WistiaProviderOptions` key, so it is **not** reachable
through `Player.Root`'s `providerOptions={{ wistia: … }}` bag: a `Player.Root`
consumer cannot currently redirect that script to their own origin the way
`providerOptions={{ youtube: { loadIframeApi } }}` allows for YouTube.

`minor` for the provider, because this is breaking and under 0.x this repo sends
breaking changes on `minor`. Beyond the API, the trade is worth stating plainly:
this provider adds no Wistia bytes to your bundle now, and in exchange your
page's `script-src` must allow `fast.wistia.com` to run a script it cannot pin
with `integrity` — Wistia serves that file unversioned and mutable, as YouTube
does `iframe_api`. `docs/third-party-requests.md` covers that bargain.
