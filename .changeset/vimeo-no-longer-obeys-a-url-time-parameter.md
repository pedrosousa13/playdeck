---
'@playdeck/provider-vimeo': minor
---

The Vimeo provider now switches off the `@vimeo/player` SDK's `vimeo_t_`
url-parameter seek, on every page, before the SDK is imported (#329).

The SDK's module scope calls `checkUrlTimeParam()`, which installs a `window`
`message` listener. On a recognised embed's `ready` it resolves that frame's
video id, greps the **top-level page url** for `vimeo_t_<videoId>`, and calls
`setCurrentTime` with what it finds. The command input is therefore the
consumer's own query string, which any third party can supply by handing a
victim a link to the consumer's own page. Playdeck now sets the SDK's own guard,
`window.VimeoCheckedUrlTimeParam`, before the import — the same mechanism
`suppressSeoMetadata` already uses for `VimeoSeoMetadataAppended`.

**The page-wide cost, plainly: this disables `vimeo_t_` seeking for every Vimeo
embed on the page, including ones Playdeck did not create.** A page that wants
that behaviour back can set `window.VimeoCheckedUrlTimeParam = false` itself
before Playdeck loads; the write is one-way and non-clobbering, so a value the
page already owns is kept in either direction.

**The severity, stated without inflation in either direction.** The listener
does install, and it does issue an attacker-chosen seek on every `ready` — a
`?vimeo_t_76979871=45` becomes `setCurrentTime(45)` on the embed, confirmed
against the shipped SDK in Chromium, Firefox and WebKit. But at first load it
does not reach the viewer: both chains start from the same embed `ready`, the
SDK's needs one round trip and the adapter's own positioning seek needs at least
two, so the adapter's lands last and `startTime` survives. Measured against the
real Vimeo embed, it did — 78 samples over 8s read the configured start in both
a control and a crafted run. So this is defence against the repeat-`ready` path,
where the SDK's permanent listener answers a second `ready` that `adopt` does
not, and against an ordering nothing on either side of the bridge promises. It
is not a fix for a live first-load exploit, because there was not one.

`startTime` itself is unchanged, and so is `@playdeck/core`'s time boundary. It
is still applied once, at ready, and nothing re-applies it — the underlying
property that makes any below-start position stick, whatever put it there. That
is #381, along with the `endTime` overshoot in the same family.

Always on rather than an option, and the difference from `suppressSeoMetadata`
is the reason. Both guards are page-wide, but suppressing SEO metadata withholds
something Vimeo legitimately wants, so it is a trade a consumer should choose.
Here nothing legitimate is withheld: Playdeck owns the playhead through
`startTime`, and the input is attacker-supplied. A default that leaves it live
means the consumer who never learns the option exists is the one who gets hit.

No companion to `isSeoMetadataSuppressed` is added, deliberately. That predicate
exists because suppression is an _option_: the call that imports may not have
asked for it while a later one does, and the later one reaches an evaluated
module where its request can achieve nothing, silently. There is no such
asymmetry here — every load asks, so the importing load always asks, and a
second call has nothing to achieve and therefore nothing to report. `loadVimeoSdk`
keeps its signature and the vendor global stays named in the one module that
already owns the other.

`e2e/vimeo-url-time-param.spec.ts` covers it against the shipped SDK, with only
the far side of the postMessage bridge stubbed and served at the real
`player.vimeo.com` origin — the same posture that settled #333. The mechanism it
closes is proved by the tests that opt out of the guard, which is also what
proves a page's own value is not overwritten.

It lands as `minor` rather than `patch` for the reason #331, #332 and #333 did:
no API changed, but what a released package does to a page-wide global did, and
a behaviour change should not arrive as a patch.
