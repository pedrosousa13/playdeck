# Third-party requests and CSP

What a page talks to when it mounts a Reely player: which origins each
provider reaches, when each request leaves the page relative to `Player.Root`'s
`loading` prop, and what a Content-Security-Policy for that page has to allow.
This is the honest accounting the [Honesty about
providers](../README.md#honesty-about-providers) section in the root README
points to — read against the loaders and attachment builders themselves, not
against provider documentation.

Every origin below was confirmed by reading the source cited next to it, with
two exceptions, each cited as such where it appears. The storybook Backpack
wrapper row's source lives on the `backpack-parity` branch, not this tree. And
the Wistia row's hostnames were read out of `@wistia/wistia-player@0.7.12`,
which #225 removed from this repo's dependencies — that evidence is preserved
because it is what the origins were confirmed from, but it is no longer
re-checkable from a clean install, and Wistia can move those hostnames in a CDN
bundle without anything here noticing. Where the audit could not confirm
something from the shipped code, it says so rather than guessing.

## Per-provider origins

| Provider                                                                                | `script-src`                                                                                                      | `frame-src`                                                                                     | `img-src`                                                                                                   | `connect-src`                                                                                                                                                                                                                                        | `media-src`                                                               |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Native** (`@reely/provider-native`)                                                   | —                                                                                                                 | —                                                                                               | —                                                                                                           | —                                                                                                                                                                                                                                                    | Your own media host — nothing Reely adds.                                 |
| **HLS** (`@reely/provider-hls`)                                                         | —                                                                                                                 | —                                                                                               | —                                                                                                           | Your own manifest/segment host, when the hls.js engine fetches via MSE.                                                                                                                                                                              | Your own manifest/segment host, when the native engine plays it directly. |
| **YouTube** (`@reely/provider-youtube`)                                                 | `www.youtube.com`                                                                                                 | `www.youtube-nocookie.com` (the default) or `www.youtube.com`, and nothing else; see note below | —                                                                                                           | —                                                                                                                                                                                                                                                    | —                                                                         |
| **Vimeo** (`@reely/provider-vimeo`)                                                     | —                                                                                                                 | `player.vimeo.com`                                                                              | —                                                                                                           | `vimeo.com` — opt-in only, and reachable through `Player.Root`; see note below.                                                                                                                                                                      | —                                                                         |
| **Wistia** (`@reely/provider-wistia`)                                                   | `fast.wistia.net`, `fast.wistia.com`, `browser.sentry-cdn.com` (injected by Wistia's own element; see note below) | `fast.wistia.net` (legacy-embed fallback; see note below)                                       | `fast.wistia.net`, `fast.wistia.com`, `embed.wistia.com`, `embed-ssl.wistia.com`, `embed-fastly.wistia.com` | `fast.wistia.net`, `fast.wistia.com`, `embed.wistia.com`, `embed-ssl.wistia.com`, `embed-fastly.wistia.com`, `o4505518331658240.ingest.us.sentry.io`, `pipedream.wistia.com` — the last two are Wistia's error and metrics reporting; see note below | Same five hosts as `img-src`.                                             |
| **Storybook Backpack wrapper** (`backpack-parity` branch) — not shipped, see note below | —                                                                                                                 | —                                                                                               | `img.youtube.com`, `ytimg.com` (+ subdomains), `vimeocdn.com` (+ subdomains)                                | `www.youtube.com`, `vimeo.com`                                                                                                                                                                                                                       | —                                                                         |

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
  at `:161-164`), with no `integrity` and no `crossOrigin` set. This does not
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

- **Wistia**'s player bundle is fetched from
  `https://fast.wistia.com/player.js` (`packages/provider-wistia/src/loader.ts:158`,
  appended to `document.head` at `:181-187`), with no `integrity` and no
  `crossOrigin` set — see the SRI note below, which now covers two vendors. That
  is Aurora's own entry point, not the legacy `E-v1.js` embed shim, so there is
  still no `window._wq`. This provider declares **no** dependency on
  `@wistia/wistia-player`, as of #225: that package is a shell around this same
  CDN, and it declared `dotenv-webpack` among its own runtime dependencies,
  which pulled webpack into consumer installs for a bundle that was fetched over
  the network regardless. A page can serve the script from its own origin
  instead, by passing `WistiaScriptInjector` to `loadWistiaPlayer`
  (`packages/provider-wistia/src/loader.ts:166`) — that is the one way any origin
  here moves, and it is not reachable through `Player.Root`. Loading the script
  registers the `<wistia-player>` custom element, which then fetches its own
  playback engine, embed configuration and media data from Wistia's CDN at
  runtime, confirmed by reading the hardcoded hostnames (`fast.wistia.net`,
  `fast.wistia.com`, `embed.wistia.com`, `embed-ssl.wistia.com`,
  `embed-fastly.wistia.com`) in `@wistia/wistia-player@0.7.12`'s shipped
  bundle — which this repo no longer installs, so that reading stands as
  recorded evidence rather than something re-checkable here; see the preamble.
  Aurora does render an iframe on one path: when the media-data response asks
  for the legacy embed, the element writes
  `<iframe src="https://fast.wistia.net/embed/iframe/{mediaId}">` straight
  into its shadow root and returns without ever initialising a public API
  — confirmed against that same bundle
  (`@wistia/wistia-player@0.7.12`'s `dist/wistia-player.js:18517-18535`,
  building the URL from `eV1HostWithPort()`, read before its removal) and
  against
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
  (`packages/provider-wistia/src/attachment.ts:336-377`), and most of them are
  behavioural rather than presentational — `mediaId`, `doNotTrack`,
  `controlsVisibleOnLoad`, `endVideoBehavior` and `currentTime` — with
  `playerColor`, `swatch`, `poster` and `transparentLetterbox` the four the
  source itself calls presentation-only (`:359`). None of them is a
  `referrerpolicy` or an `allow`, so the legacy embed iframe travels under the
  page's own referrer policy. The element also dynamically loads a Mux Data
  analytics module (`assets/external/wistia-mux.js`, from the same `fast.*`
  host) unless the page sets `window.wistiaDisableMux = true`; that global is
  an Aurora switch, not something `WistiaProviderOptions` exposes, and the
  audit could not confirm from the shipped bundle which origin that module
  reports metrics to, since it is fetched at runtime rather than bundled —
  treat that as an open question if you need to pin it down, rather than an
  origin this table has verified. Wistia's provider options (`controls`, `dnt`,
  `playerColor`, `swatch`, `poster`, `transparentLetterbox`) are reachable from
  `Player.Root` via `providerOptions={{ wistia: {...} }}`, as YouTube's and
  Vimeo's are through their own bags
  (`packages/react/src/provider-loaders.ts:46-59`). Three of Wistia's options
  are omitted from that bag rather than reachable through it — `loop`
  (SIDEPRO-210) and `startTime` and `endTime` (#214) — because `Root`'s own
  props write them (ADR-0004). None of the three changes which origin is
  reached; they are listed here so this paragraph names the bag's real shape.
  Wistia keeps `controls` where YouTube and Vimeo omit it: Wistia has the
  concept but no `Root` fold writes it, so the bag key is still the only way
  there.

  Three origins in the table above carry reporting rather than playback, and
  two of those are not Wistia's at all. They were read out of that same
  `0.7.12` bundle on the same terms — recorded evidence, no longer re-checkable
  here. Besides the Mux module above and the `publicApi.js` load the SRI note
  below covers, the element appends one more `<script>`, and this is the one
  that is not on a Wistia host at all: Sentry's browser bundle from
  `browser.sentry-cdn.com` (`dist/wistia-player.js:2938-2949`). It reports
  errors through that bundle to a fixed DSN host,
  `o4505518331658240.ingest.us.sentry.io`, over `fetch` rather than a script
  tag — so `connect-src`, not `script-src` (`:2893-2894`). Separately it POSTs
  counters to `pipedream.wistia.com/mput?topic=metrics` (`:990-999` and
  `:1976-1990`); that host is a build-time constant, not a value derived from
  the page (`:7483-7486`). All three sit behind one gate,
  `isVisitorTrackingEnabled()` (`:5838-5871`), and **that gate is opt-out**: it
  reads a `Wistia`-namespace global hydrated from `localStorage` and a
  per-account `privacyMode` flag on media data, and with none of them set it
  returns `true`, so a page with clean storage has it enabled. That is read off
  the bundle rather than observed in a browser. An error report also tags itself
  with `window.location.href` (`:2997-3004`), so Sentry receives the embedding
  page's full URL — path, query and fragment — and not just its origin.

  `dnt` (on by default, `packages/provider-wistia/src/attachment.ts:337`) is
  **not** what gates those. The attribute is set, and the element mirrors it
  into its embed options (`dist/wistia-player.js:15473`, read back as
  `doNotTrack` at `:16072-16084`), but nothing in this bundle reads it again,
  and neither gate above consults it. That is **not** a claim that `dnt` is
  ineffective: the playback and stats engine the element fetches at runtime is
  where Wistia would honour it, and that engine is not in this bundle, so the
  audit could not check it either way. Treat what `dnt` suppresses as an open
  question, like the Mux module above, rather than something this table has
  verified. It is a separate switch from the Mux module either way.

  The `fast.*` host is not unconditionally fixed either, on that same recorded
  reading of `0.7.12`. The bundle chooses it once, while the module evaluates,
  by walking the page's `<script>` tags for an existing Wistia `E-v1.js` embed
  (`dist/wistia-player.js:7418-7449`); a tag only counts if its path is Wistia's
  `/assets/external/E-v1.js`, its host is `fast.wistia.com`, `fast.wistia.net`
  or the canary `fast-canary.wistia.net` (`:7346`), its protocol suits the
  page's, and it has finished loading. Every media-data, engine, legacy-iframe
  and asset URL afterwards is built from the result. **Reely never injects
  `E-v1.js`** — the only script it builds is `player.js`, and
  `packages/provider-wistia/src/loader.ts:155-158` says so in as many words — so
  on a Reely page that scan matches nothing and takes its fallback,
  `fast.wistia.net` (`dist/wistia-player.js:7447`) — which is why the
  legacy-embed iframe above resolves to that host. The canary is left out of the
  table for exactly that reason: the scan would accept it, but only on a page
  already carrying a Wistia `E-v1.js` embed served from it, which nothing in
  Reely creates. A page that carries one for its own reasons moves Reely's
  media-data, engine, legacy-iframe and asset fetches to whichever of the three
  that embed came from, so add the canary host if that describes your page.

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
  for a click, and under `eager` they fire at mount. Wistia's set now begins
  with the `fast.wistia.com/player.js` fetch, which the first attaching Wistia
  player starts and every later one on the page shares
  (`packages/provider-wistia/src/loader.ts:179`, the module-level shared load) —
  so a page with four Wistia players makes that request once, at whichever
  player attaches first, and the per-player engine and media-data requests
  follow each attach as before. YouTube's script request behaves the same way
  for the same reason.
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
- **Wistia's Sentry and metrics requests** (`browser.sentry-cdn.com`,
  `o4505518331658240.ingest.us.sentry.io`, `pipedream.wistia.com`) sit
  downstream of that attach rather than inside it: they leave once the bundle
  has loaded and the element has initialised, so `loading` decides when the
  sequence can start but not whether they happen. What decides that is Wistia's
  own visitor-tracking state, which is not a `Player.Root` prop and which no
  `loading` setting suppresses — see the per-provider note above.
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

Two vendor scripts are injected into the page by Reely, and neither carries an
`integrity` attribute:

- YouTube's `iframe_api` (`packages/provider-youtube/src/loader.ts:67`).
- Wistia's `player.js` (`packages/provider-wistia/src/loader.ts:158`), as of
  #225 — before it, Wistia's element came from an npm dependency and this
  section had one entry.

Neither can carry one. Both vendors serve those files unversioned and mutable,
so any hash recorded today would break the next time they deploy. There is no
fix to propose here — pinning a hash trades a working embed for one that
silently stops loading on the vendor's schedule, which is worse. That the
constraint is versioning rather than diligence shows inside Wistia's own bundle:
the one script it injects from a versioned URL, Sentry's
`https://browser.sentry-cdn.com/9.6.1/bundle.min.js`, does carry a `sha384`
`integrity` and `crossOrigin="anonymous"` — and is the only `integrity` in that
bundle at all — while the `publicApi.js` it loads from its own unversioned
`fast.*` host carries neither (`@wistia/wistia-player@0.7.12`'s
`dist/wistia-player.js:2938-2949` and `:15607`, read before its removal).

The consequence is not softened by that explanation: allowing `www.youtube.com`
or `fast.wistia.com` in `script-src` grants that origin the ability to run
arbitrary code with the page's full privileges — the same DOM, the same cookies,
the same access any first-party script on the page has. `crossOrigin` is absent
for the same reason `integrity` is — there is nothing to check the response
against. That is the bargain a YouTube or Wistia source makes on your page's
behalf, not a gap to close.

Both providers do offer a seam for replacing the load, and self-hosting the
script is what either seam is for: the vendor's own engine, configuration and
media-data requests still go to the vendor's CDN, so only `script-src` changes.
But the two are not equally reachable, and the difference matters most to the
consumer this project leads with — the one who installs `@reely/react` and never
calls a provider factory:

- **YouTube's is reachable through `Player.Root`.**
  `YouTubeProviderOptions.loadIframeApi`
  (`packages/provider-youtube/src/index.ts:71`, defaulted to the built-in loader
  at `:194`, called at `packages/provider-youtube/src/attachment.ts:159`) is a
  provider option, and the `youtube` bag omits only `controls`, `endTime`,
  `loop` and `startTime` (`packages/react/src/provider-loaders.ts:51-56`) — so
  `providerOptions={{ youtube: { loadIframeApi } }}` reaches it.
- **Wistia's is not.** `WistiaScriptInjector`
  (`packages/provider-wistia/src/loader.ts:166`) is a parameter of
  `loadWistiaPlayer`, not a key of `WistiaProviderOptions`, so no `wistia` bag
  carries it. Reaching it means calling `createWistiaProvider` yourself and
  driving the load, which is the direct-construction path this document
  describes at the Wistia row above — not something `Player.Root` exposes.

So for a `Player.Root` consumer today, `fast.wistia.com` in `script-src` is not
negotiable, while `www.youtube.com` is. That asymmetry is a gap in this
provider's options surface rather than a property of Wistia's CDN.

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

- **Vimeo ships its SDK as an npm dependency, not a remote script tag.**
  `@vimeo/player` is imported dynamically from the package's own bundle
  (`packages/provider-vimeo/README.md`) — nothing is fetched from a CDN to load
  it. Wistia is **no longer** in this bullet: as of #225 its provider fetches
  `player.js` from `fast.wistia.com` instead of depending on
  `@wistia/wistia-player`, so it is a remote script tag now, on the same terms
  as YouTube's — see the SRI note above. That is a deliberate trade and not an
  oversight, but it is not a thing found "in good order" either.
- **Every runtime dependency of every published package is pinned to an
  exact version**, not a caret range: `@vimeo/player` at `2.30.4`
  (`packages/provider-vimeo/package.json`) and `hls.js` at `1.6.16`
  (`packages/provider-hls/package.json`) — confirmed by reading each
  manifest's `dependencies` field directly rather than copied from a prior
  report. The Wistia provider now has no third-party runtime dependency to pin
  (`packages/provider-wistia/package.json`), which moves that provider's version
  question from a manifest to an unversioned CDN URL — the same exposure the SRI
  note describes.

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
`fast.wistia.net`/`fast.wistia.com`, plus `browser.sentry-cdn.com` for the
Sentry bundle Wistia's own element injects; `frame-src` to carry
`www.youtube-nocookie.com`, `player.vimeo.com` and `fast.wistia.net` (the last
only matters if a media id can hit Wistia's legacy-embed fallback); `img-src`
and `media-src` to carry Wistia's five `fast.*`/`embed*.wistia.com` hosts; and
`connect-src` to carry those same five plus
`o4505518331658240.ingest.us.sentry.io` and `pipedream.wistia.com` — whether or
not any single page load actually renders all three providers. Do not treat the
three reporting origins — the Sentry pair and `pipedream.wistia.com` — as
optional: in the `0.7.12` bundle this document read, the visitor-tracking state
that gates them defaults to enabled, and omitting them buys a silently failed
error or metrics request rather than a video that visibly does not play. Add
`vimeo.com` to `connect-src`
only if some caller in your app sets `customControls: true`, whether directly
or through `providerOptions={{ vimeo: {...} }}`. None
of this needs `'unsafe-inline'` or `'unsafe-eval'` in `script-src` — every
provider here is a script or iframe load, not inline code.
