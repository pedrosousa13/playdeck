# Third-party requests and CSP

What a page talks to when it mounts a Reely player: which origins each
provider reaches, when each request leaves the page relative to `Player.Root`'s
`loading` prop, and what a Content-Security-Policy for that page has to allow.
This is the honest accounting the [Honesty about
providers](../README.md#honesty-about-providers) section in the root README
points to — read against the loaders and attachment builders themselves, not
against provider documentation.

Every origin below was confirmed by reading the source cited next to it, except
the storybook Backpack wrapper row: that source lives on the `backpack-parity`
branch, not this tree, and is cited as such. Where the audit could not confirm
something from the shipped code, it says so rather than guessing.

## Per-provider origins

| Provider                                                                                | `script-src`                         | `frame-src`                                                                                     | `img-src`                                                                                                   | `connect-src`                                                                                               | `media-src`                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Native** (`@reely/provider-native`)                                                   | —                                    | —                                                                                               | —                                                                                                           | —                                                                                                           | Your own media host — nothing Reely adds.                                 |
| **HLS** (`@reely/provider-hls`)                                                         | —                                    | —                                                                                               | —                                                                                                           | Your own manifest/segment host, when the hls.js engine fetches via MSE.                                     | Your own manifest/segment host, when the native engine plays it directly. |
| **YouTube** (`@reely/provider-youtube`)                                                 | `www.youtube.com`                    | `www.youtube-nocookie.com` (the default) or `www.youtube.com`, and nothing else; see note below | —                                                                                                           | —                                                                                                           | —                                                                         |
| **Vimeo** (`@reely/provider-vimeo`)                                                     | —                                    | `player.vimeo.com`                                                                              | —                                                                                                           | `vimeo.com` — opt-in only, and reachable through `Player.Root`; see note below.                             | —                                                                         |
| **Wistia** (`@reely/provider-wistia`)                                                   | `fast.wistia.net`, `fast.wistia.com` | `fast.wistia.net` (legacy-embed fallback; see note below)                                       | `fast.wistia.net`, `fast.wistia.com`, `embed.wistia.com`, `embed-ssl.wistia.com`, `embed-fastly.wistia.com` | `fast.wistia.net`, `fast.wistia.com`, `embed.wistia.com`, `embed-ssl.wistia.com`, `embed-fastly.wistia.com` | Same five hosts as `img-src`.                                             |
| **Storybook Backpack wrapper** (`backpack-parity` branch) — not shipped, see note below | —                                    | —                                                                                               | `img.youtube.com`, `ytimg.com` (+ subdomains), `vimeocdn.com` (+ subdomains)                                | `www.youtube.com`, `vimeo.com`                                                                              | —                                                                         |

Notes, per row:

- **Native** adds no third-party origin at all. The only request is whatever
  URL you pass as the source — that's your own host, not Reely's.
- **HLS** ships `hls.js` (pinned `1.6.16`) as a bundled dependency, imported
  dynamically (`packages/provider-hls/README.md`), so no script is fetched
  from a CDN. Which directive covers your own media host depends on which
  engine is selected: the hls.js engine fetches the manifest and segments with
  `fetch`/XHR and feeds them to Media Source Extensions, which browsers gate
  under `connect-src`; the native engine (Safari/iOS) hands the manifest URL
  straight to `<video src>`, which is `media-src`. `auto` (the default) picks
  per browser, so allow your host under both unless you pin one engine.
- **YouTube**'s API script is fetched from `https://www.youtube.com/iframe_api`
  unconditionally
  (`packages/provider-youtube/src/loader.ts:67`, appended to `document.head`
  at `:127-130`), with no `integrity` and no `crossOrigin` set. This does not
  change with the `host` option: `host` only decides which origin the _embed
  iframe_ itself points at (it defaults to `https://www.youtube-nocookie.com`,
  `packages/provider-youtube/src/index.ts:76`, and is resolved at `:96-104`; the
  value reaches the iframe via
  `packages/provider-youtube/src/attachment.ts:168`). A
  `Player.Root` consumer **can** change `host`: `provider-loaders.ts` passes
  `providerOptions?.youtube` straight to `createYouTubeProvider`, so every key
  `YouTubeProviderOptions` declares — `host` and the `loadIframeApi` injection
  hook among them — is reachable as
  `providerOptions={{ youtube: { host: '…' } }}`. What that consumer can reach
  is bounded, as of SIDEPRO-216: `host` is matched on its parsed origin against
  `https://www.youtube.com` and `https://www.youtube-nocookie.com`, and any
  other origin — malformed and empty values with it — falls back to the
  privacy-enhanced default rather than throwing. So the `frame-src` this table
  gives is the whole set: the embed is either origin, never a third one. The
  API script itself always comes from `www.youtube.com` — that one `host` does
  not move.

  That embed iframe carries no `referrerpolicy` and no `allow` from Reely,
  because Reely never creates it: the attachment appends a `<div>` and hands
  that to the IFrame API, which replaces it with an iframe of its own
  (`packages/provider-youtube/src/attachment.ts:164-167`, `new api.Player(…)`).
  Reely does reach the frame afterwards — `getIframe()`
  (`packages/provider-youtube/src/attachment.ts:93-99`) hands it to the
  presentation seam, which uses it for fullscreen
  (`packages/provider-youtube/src/presentation.ts:63`) — but only after it has
  loaded, and an attribute written then changes nothing about a request already
  sent. So this frame travels under whatever referrer policy the page itself
  declares, rather than the narrower one Reely pins on the Vimeo frame (see the
  Vimeo note below).

- **Vimeo**'s embed iframe is built from `player.vimeo.com`
  (`packages/provider-vimeo/src/attachment.ts:69`). The SDK
  (`@vimeo/player`, pinned `2.30.4`) is a bundled dependency, imported
  dynamically — nothing is fetched from a Vimeo CDN
  (`packages/provider-vimeo/README.md`). The oEmbed probe at
  `packages/provider-vimeo/src/chromeless-availability.ts` that would reach
  `vimeo.com/api/oembed.json` is opt-in as of SIDEPRO-217: it only fires when
  `VimeoProviderOptions.customControls === true`
  (`chromeless-availability.ts:128`), so the probe never fires uninvited — it
  needs the option, whether the caller builds the adapter directly or reaches
  it through `Player.Root`'s `vimeo` bag. `dnt` **is on unless it is explicitly
  `false`** — the embed url always carries a `dnt` parameter, `1` for every
  value but `false`, including when the option is left unset
  (`packages/provider-vimeo/src/attachment.ts:72`,
  `options.dnt === false ? '0' : '1'`) — and asks Vimeo not to track the
  session. It is a separate switch and has no effect on whether the oEmbed
  probe runs. `PlayerProviderOptions` carries a `vimeo` key
  (`packages/react/src/provider-loaders.ts:55`), so `dnt`, `customControls` and
  `suppressSeoMetadata` are reachable through `Player.Root` as
  `providerOptions={{ vimeo: {...} }}`; `controls`, `loop`, `startTime` and
  `endTime` are omitted from that bag because `Root` owns them as its own props
  (ADR-0004). So a `Player.Root` consumer can turn Do-Not-Track off —
  `providerOptions={{ vimeo: { dnt: false } }}` sends `dnt=0` — and can fire the
  oEmbed probe, `providerOptions={{ vimeo: { customControls: true } }}`. Neither
  needs `createVimeoProvider` to be called directly. One part of that is
  machine-checked: `packages/react/test/provider-loaders.test.ts` asserts, at
  the type level, which providers have a bag and which keys each bag omits, so
  `pnpm typecheck` fails if that shape moves again. It checks nothing else
  here — what `dnt` does to the url, and every line cited in this paragraph,
  were confirmed by reading the source and can still drift.

  The embed iframe is hardened beyond the url. Reely sets, at
  `packages/provider-vimeo/src/attachment.ts:268-271`:
  `allow="autoplay; fullscreen; picture-in-picture"`, `allowfullscreen`,
  `title="Vimeo video player"` and
  `referrerpolicy="strict-origin-when-cross-origin"`. The referrer policy means
  Vimeo receives this page's **origin** and not its path or query on the iframe
  request — enough for Vimeo's own domain-restriction check, so a private or
  domain-locked source still loads. `encrypted-media` is **deliberately absent**
  from the `allow` list, and that absence is a capability withdrawal rather than
  a tidy-up: a DRM-protected source (Widevine/FairPlay, an Enterprise/OTT video)
  needs that grant to reach `requestMediaKeySystemAccess` from inside the frame,
  and will not play. No Reely option turns it back on. There is no `sandbox`
  attribute on this iframe at all — the origin isolation here is the
  cross-origin frame itself, not a sandbox policy. Neither the missing
  `encrypted-media` nor the absent `sandbox` changes which origin is reached;
  they are here because this document is where a reader decides what to permit
  this frame, and a DRM source that silently will not play is what an
  origins-only reading would leave them to find in production.

  One more thing leaves the page here that no origin in the table above shows,
  because it is not a request: **the SDK sends the embedding page's full URL —
  path and query included — to the embed frame over `postMessage`.**
  `@vimeo/player` runs `initAppendVideoMetadata()` at module scope
  (`dist/player.js:2827`), which installs a `window` `message` listener
  (`:993-1016`); when a frame whose `src` matches
  `^https://player.vimeo.com/video/\d+` completes the readiness handshake, that
  listener answers it with an `appendVideoMetadata` call carrying
  `window.location.href`. The embed url Reely builds matches that pattern, so
  Reely's own iframe is the frame it resolves. The
  `referrerpolicy="strict-origin-when-cross-origin"` on that iframe does **not**
  prevent this — the referrer policy narrows the iframe's own request header,
  and this is a message sent afterwards — and neither does `dnt=1`. The message
  is at least targeted at the embed's own origin rather than `*`
  (`dist/player.js:775`), so no unrelated frame can read it. Reproduced in a
  real browser by `e2e/vimeo-seo-metadata.spec.ts`, not read off the bundle
  alone.

  `VimeoProviderOptions.suppressSeoMetadata` (#215) turns it off: Reely sets the
  SDK's own guard global before the dynamic import, so the listener is never
  installed. It is **off by default**, for two reasons a consumer switching it
  on has to know. First, **the suppression is page-wide, not per-embed** — the
  SDK's guard is a `window` global, so it silences that handshake for every
  Vimeo embed on the page, including embeds Reely did not create. Second, **it
  takes effect on the first Vimeo attach and holds for the life of the page** —
  the SDK module is imported once and cached, and reads the guard while it
  evaluates, so a page whose first Vimeo attach did not ask for suppression
  cannot get it from a later one. A page that has already set that global itself
  keeps its own value, in either direction: Reely writes it only when it is not
  already set.

- **Wistia** ships `@wistia/wistia-player` (pinned `0.7.12`) as a bundled
  dependency that registers the `<wistia-player>` custom element — "no
  `E-v1.js` script tag, no `window._wq`"
  (`packages/provider-wistia/README.md`). That element then fetches its own
  playback engine, embed configuration and media data from Wistia's CDN at
  runtime, confirmed by reading the shipped bundle's hardcoded hostnames
  (`fast.wistia.net`, `fast.wistia.com`, `embed.wistia.com`,
  `embed-ssl.wistia.com`, `embed-fastly.wistia.com`) rather than assumed from
  the npm dependency alone. Aurora does render an iframe on one path: when
  the media-data response asks for the legacy embed, the element writes
  `<iframe src="https://fast.wistia.net/embed/iframe/{mediaId}">` straight
  into its shadow root and returns without ever initialising a public API
  — confirmed against the shipped bundle
  (`dist/wistia-player.js:18517-18535`, building the URL from
  `eV1HostWithPort()`) and against
  `packages/provider-wistia/src/attachment.ts:42-49`, which already
  describes exactly this path. That render happens in the browser regardless
  of what this adapter does next: `API_READY_TIMEOUT_MS`
  (`packages/provider-wistia/README.md`) only decides how long Reely waits
  for the `api-ready` handshake before reporting a recoverable error — the
  handshake never arrives on this path, but the timeout does not stop the
  iframe from loading. So a page that can reach a media id serving the
  legacy embed needs `fast.wistia.net` in `frame-src` too, even though
  Reely's adapter never treats that path as a successful attach either way.
  Reely cannot harden that frame, for the same reason it cannot harden
  YouTube's: the element writes it into its own shadow root. Reely only ever
  sets attributes on the `<wistia-player>` element itself
  (`packages/provider-wistia/src/attachment.ts:334-375`), and most of them are
  behavioural rather than presentational — `mediaId`, `doNotTrack`,
  `controlsVisibleOnLoad`, `endVideoBehavior` and `currentTime` — with
  `playerColor`, `swatch`, `poster` and `transparentLetterbox` the four the
  source itself calls presentation-only (`:357`). None of them is a
  `referrerpolicy` or an `allow`, so the legacy embed iframe travels under the
  page's own referrer policy. The element also dynamically loads a Mux Data
  analytics module (`assets/external/wistia-mux.js`, from the same `fast.*`
  host) unless the page sets `window.wistiaDisableMux = true`; that global is
  an Aurora switch, not something `WistiaProviderOptions` exposes, and the
  audit could not confirm from the shipped bundle which origin that module
  reports metrics to, since it is fetched at runtime rather than bundled —
  treat that as an open question if you need to pin it down, rather than an
  origin this table has verified. `dnt` (on by default,
  `packages/provider-wistia/src/attachment.ts:335`) asks Wistia not to track
  the session; it is a separate switch from the Mux module. Wistia's
  provider options (`controls`, `dnt`, `playerColor`, `swatch`, `poster`,
  `transparentLetterbox`) are reachable from `Player.Root` via
  `providerOptions={{ wistia: {...} }}`, as YouTube's and Vimeo's are through
  their own bags (`packages/react/src/provider-loaders.ts:46-59`). Three of
  Wistia's options are omitted from that bag rather than reachable through it —
  `loop` (SIDEPRO-210) and `startTime` and `endTime` (#214) — because `Root`'s
  own props write them (ADR-0004). None of the three changes which origin is
  reached; they are listed here so this paragraph names the bag's real shape.
  Wistia keeps `controls` where YouTube and Vimeo omit it: Wistia has the
  concept but no `Root` fold writes it, so the bag key is still the only way
  there.
- **The `backpack-parity` branch's storybook Backpack wrapper** is not in any
  published package there — `apps/storybook`'s `package.json` marks it
  `"private": true` on that branch. It fetches YouTube's oEmbed endpoint
  (`https://www.youtube.com/oembed?url=...&format=json`) and Vimeo's
  (`https://vimeo.com/api/oembed.json?url=...`), then only renders the
  `thumbnail_url` field back if it is `https:` and its hostname is
  `img.youtube.com`, `ytimg.com` or a subdomain of it, or `vimeocdn.com` or a
  subdomain of it. Do not add these origins to a CSP for code you do not ship
  — this wrapper exists there to prove a migration path, not to publish.

## When each request happens

`Player.Root`'s `loading` prop decides when a provider attaches, and every
third-party request above happens at attach time — nothing fires earlier than
this table says, for any provider. Three props gate activation, and activation
is what emits the requests: `loading` chooses the gate, and `loadMargin` and
`loadThreshold` tune it when that gate is the viewport.

- **`viewport`** (the default, `packages/react/src/root.tsx:124`): the provider
  attaches once `Player.Viewport`'s box crosses into the viewport, watched
  with an `IntersectionObserver` and a `loadMargin` of `'200px 0px'` by
  default (`:122`) — so the request can leave up to 200px of scroll before the
  box is actually on screen, but not before. `loadThreshold` (declared at
  `packages/react/src/root.tsx:64`, defaulted to `0` at `:123`) is the other
  half of this gate: the `IntersectionObserver` ratio — `0` to `1` — of the box
  that must be on screen before the provider attaches. At its `0` default any
  visible pixel attaches, which is why the `loadMargin` rule reads as it does;
  raise it and every request in this document waits until that fraction of the
  box is showing. It does not defer them indefinitely, though — a box taller or
  wider than the scroll container it moves through can never reach a threshold
  near `1`, and rather than never attaching, such a box attaches at the first
  visible pixel instead (`packages/react/src/use-activation.ts:183-220`).
  Neither prop applies under `interaction` or `eager`: the observer is only
  ever built for `viewport` (`packages/react/src/use-activation.ts:466-467`).
- **`interaction`**: nothing attaches until the viewer activates the
  play/retry affordance `Player.ActivationButton` renders
  (`packages/react/src/loading-error.tsx:56`, `activateFromInteraction()`).
  No request in this document leaves the page before that click. Cannot be
  combined with autoplay — `Root` reports a configuration error if it is
  (`packages/react/src/use-activation.ts:376-385`).
- **`eager`**: the provider attaches as soon as the component mounts
  (`packages/react/src/use-activation.ts:358-367`) — the request leaves before
  any scroll or interaction at all.

Mapped onto the origins above:

- **YouTube**'s `www.youtube.com` script request and **Vimeo**'s
  `player.vimeo.com` iframe and **Wistia**'s `fast.*`/`embed*.wistia.com`
  requests all fire at the moment their provider attaches — so under
  `viewport` (the default) they wait for scroll, under `interaction` they wait
  for a click, and under `eager` they fire at mount.
- **Native** and **HLS** follow the same attach timing for the request that
  loads their provider module; the actual media bytes additionally wait on
  `preload` (`'none'` / `'metadata'` / `'auto'`, default `'metadata'`) once
  attached.
- **Vimeo's oEmbed probe** does not fire at all unless `customControls: true`
  is set, regardless of `loading` — see the per-provider note above. It is set
  either on `createVimeoProvider` directly or through `Player.Root` as
  `providerOptions={{ vimeo: { customControls: true } }}`; both reach the same
  place, so a `Player.Root`-only page can reach `vimeo.com` and this timeline
  covers it. Once set, the probe starts at that provider's own attach — the same
  gate as everything else above — racing the embed's own load
  (`CHROMELESS_PROBE_TIMEOUT_MS`, 4 seconds).
- **The Vimeo SDK's `appendVideoMetadata` message** is not on this timeline
  because it is not a request: it is a `postMessage` to the embed frame Reely
  already created, sent once that frame reports ready. It therefore happens
  whenever the embed attaches, at every `loading` setting, and
  `suppressSeoMetadata: true` is what stops it — see the per-provider note.
- **The storybook wrapper's** oEmbed lookup is independent of `loading`
  entirely: `useVideoThumbnail` fires its `fetch` once at mount, whenever it is
  given a URL and no `placeholderImageSrc` — the cover has to be ready before
  any player attaches, so it cannot wait on the same gate the player does.
  But the call site only ever passes a URL when the wrapper's own `light` prop
  is true and playback has not started (`light && !startsPlaying ? url :
undefined`), and `light` defaults to `false` — so by default this wrapper
  makes no oEmbed request at all, and the request only exists for a caller who
  opts into `light`.

## The SRI bargain

YouTube's `iframe_api` script carries no `integrity` attribute, and cannot: the
YouTube team serves that file unversioned and mutable, so any hash recorded
today would break the next time they deploy it. There is no fix to propose
here — pinning a hash trades a working embed for one that silently stops
loading on YouTube's schedule, which is worse.

The consequence is not softened by that explanation: allowing `www.youtube.com`
in `script-src` grants that origin the ability to run arbitrary code with the
page's full privileges — the same DOM, the same cookies, the same access any
first-party script on the page has. `crossOrigin` is absent for the same
reason `integrity` is — there is nothing to check the response against. That is
the bargain a YouTube source makes on your page's behalf, not a gap to close.

## A note on `style-src`

Everything above is about `script-src`, `frame-src`, `img-src`,
`connect-src` and `media-src`. Reely's primitives also carry a `style-src`
consideration, for a different reason: they set structural geometry —
positioning, stacking, the media element filling its box — with inline
`style={{...}}` rather than a stylesheet, by design
([ADR-0001](adr/0001-structural-css-ships-inline.md)), so that a consumer who
imports no stylesheet still gets a correctly stacked player. Client-side, React
applies that geometry through the CSSOM, which `style-src`/`style-src-attr` do
not govern. Server-rendered markup is the case that does need a
`style-src` entry: `tests/integrations/next-image/test.mjs:110` asserts
`position: 'absolute'` on the poster _before hydration_, which is only
observable if the server emitted it as a literal `style="..."` attribute in
the HTML — and a `style-src`/`style-src-attr` policy governs an attribute like
that. An SSR consumer under a strict policy needs `style-src 'unsafe-inline'`
(or per-request nonces or hashes covering that markup) for Reely's
pre-hydration output to render with its structural geometry intact. This
audit did not verify whether Reely's build offers a nonce- or hash-friendly
path as an alternative to `'unsafe-inline'` — treat that as open. Nothing
here generalises beyond what `script-src` and `style-src` specifically cover;
the other directives in this document behave as documented above.

## What the audit found in good order

Two things this sweep found are not integrity gaps and should not be read as
omissions:

- **Vimeo ships its SDK, and Wistia ships Aurora, as npm dependencies, not
  remote script tags.** `@vimeo/player` and `@wistia/wistia-player` are both
  imported dynamically from the package's own bundle
  (`packages/provider-vimeo/README.md`, `packages/provider-wistia/README.md`)
  — nothing is fetched from a CDN to load either one. (Aurora does then reach
  Wistia's own CDN for its engine and media data at runtime, which the
  origins table above covers separately.)
- **Every runtime dependency of every published package is pinned to an
  exact version**, not a caret range: `@wistia/wistia-player` at `0.7.12`
  (`packages/provider-wistia/package.json`), `@vimeo/player` at `2.30.4`
  (`packages/provider-vimeo/package.json`), and `hls.js` at `1.6.16`
  (`packages/provider-hls/package.json`) — confirmed by reading each
  manifest's `dependencies` field directly rather than copied from a prior
  report.

## A worked example CSP

A page mounting only a YouTube source through `Player.Root`, with `loading`
left at its `viewport` default:

```http
Content-Security-Policy:
  script-src 'self' https://www.youtube.com;
  frame-src https://www.youtube-nocookie.com;
  img-src 'self';
  connect-src 'self';
  media-src 'self';
  style-src 'self'
```

`style-src 'self'` is enough for a client-only mount. Add `'unsafe-inline'` (or
nonces/hashes covering the pre-hydration markup) only if this page's HTML is
server-rendered — see the `style-src` note above.

Adding another provider is additive, not multiplicative: union the origins
from the table above for every provider a page can render, rather than
building a separate policy per source. A page that can show YouTube, Vimeo and
Wistia sources needs `script-src` to carry `www.youtube.com` and
`fast.wistia.net`/`fast.wistia.com`; `frame-src` to carry
`www.youtube-nocookie.com`, `player.vimeo.com` and `fast.wistia.net` (the last
only matters if a media id can hit Wistia's legacy-embed fallback); and
`connect-src`/`img-src` to carry Wistia's five hosts — whether or not any
single page load actually renders all three. Add `vimeo.com` to `connect-src`
only if some caller in your app sets `customControls: true`, whether directly
or through `providerOptions={{ vimeo: {...} }}`. None
of this needs `'unsafe-inline'` or `'unsafe-eval'` in `script-src` — every
provider here is a script or iframe load, not inline code.
