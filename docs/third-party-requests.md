# Third-party requests and CSP

What a page talks to when it mounts a Playdeck player: which origins each
provider reaches, when each request leaves the page relative to `Player.Root`'s
`loading` prop, and what a Content-Security-Policy for that page has to allow.
This is the honest accounting the [Honesty about
providers](../README.md#honesty-about-providers) section in the root README
points to — read against the loaders and attachment builders themselves, not
against provider documentation.

Every origin below was confirmed by reading the source cited next to it, with
one exception, cited as such where it appears:
the Wistia row's hostnames were read out of `@wistia/wistia-player@0.7.12`,
which #225 removed from this repo's dependencies — that evidence is preserved
because it is what the origins were confirmed from, but it is no longer
re-checkable from a clean install, and Wistia can move those hostnames in a CDN
bundle without anything here noticing. Where the audit could not confirm
something from the shipped code, it says so rather than guessing.

## Per-provider origins

| Provider                                   | `script-src`                                                                                                      | `frame-src`                                                                                     | `img-src`                                                                                                   | `connect-src`                                                                                                                                                                                                                                        | `media-src`                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Native** (`@playdeck/provider-native`)   | —                                                                                                                 | —                                                                                               | —                                                                                                           | —                                                                                                                                                                                                                                                    | Your own media host — nothing Playdeck adds.                              |
| **HLS** (`@playdeck/provider-hls`)         | —                                                                                                                 | —                                                                                               | —                                                                                                           | Your own manifest/segment host, when the hls.js engine fetches via MSE.                                                                                                                                                                              | Your own manifest/segment host, when the native engine plays it directly. |
| **YouTube** (`@playdeck/provider-youtube`) | `www.youtube.com`                                                                                                 | `www.youtube-nocookie.com` (the default) or `www.youtube.com`, and nothing else; see note below | —                                                                                                           | —                                                                                                                                                                                                                                                    | —                                                                         |
| **Vimeo** (`@playdeck/provider-vimeo`)     | —                                                                                                                 | `player.vimeo.com`                                                                              | —                                                                                                           | `vimeo.com` — two paths: Playdeck's `customControls` probe, opt-in through `Player.Root`; and the SDK's own document scan, which needs no option but only fires if your page carries `data-vimeo-id`/`data-vimeo-url` markup. See note below.        | —                                                                         |
| **Wistia** (`@playdeck/provider-wistia`)   | `fast.wistia.net`, `fast.wistia.com`, `browser.sentry-cdn.com` (injected by Wistia's own element; see note below) | `fast.wistia.net` (legacy-embed fallback; see note below)                                       | `fast.wistia.net`, `fast.wistia.com`, `embed.wistia.com`, `embed-ssl.wistia.com`, `embed-fastly.wistia.com` | `fast.wistia.net`, `fast.wistia.com`, `embed.wistia.com`, `embed-ssl.wistia.com`, `embed-fastly.wistia.com`, `o4505518331658240.ingest.us.sentry.io`, `pipedream.wistia.com` — the last two are Wistia's error and metrics reporting; see note below | Same five hosts as `img-src`.                                             |

Notes, per row:

- **Native** adds no third-party origin at all. The only request is whatever
  URL you pass as the source — that's your own host, not Playdeck's.
- **HLS** ships `hls.js` (pinned `1.6.16`) as a bundled dependency, imported
  dynamically (`packages/provider-hls/README.md`), so no script is fetched
  from a CDN. Which directive covers your own media host depends on which
  engine is selected: the hls.js engine fetches the manifest and segments with
  `fetch`/XHR and feeds them to Media Source Extensions, which browsers gate
  under `connect-src`; the native engine (Safari/iOS) hands the manifest URL
  straight to `<video src>`, which is `media-src`. `auto` (the default) picks
  per browser, so allow your host under both unless you pin one engine.
- **YouTube**'s API script is fetched from `https://www.youtube.com/iframe_api`
  unless a working API is already present on the page — see the SRI note below
  (`packages/provider-youtube/src/loader.ts:70`, appended to `document.head`
  at `:164-167`), with no `integrity` and no `crossOrigin` set. This does not
  change with the `host` option: `host` only decides which origin the _embed
  iframe_ itself points at (it defaults to `https://www.youtube-nocookie.com`,
  `packages/provider-youtube/src/index.ts:81`, and is resolved at `:101-109`; the
  value reaches the iframe as the origin of the embed url the adapter builds,
  `packages/provider-youtube/src/attachment.ts:228`). A
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

  Playdeck builds that embed iframe itself, as of #221
  (`packages/provider-youtube/src/attachment.ts:227-274`), and hands the
  finished element to the iframe API, which adopts a frame that already exists
  instead of building one (`:302`, `new api.Player(…)`). So the `src`, the
  `referrerpolicy` and the `allow` on it are Playdeck's — see the referrer section
  below for what that changes and what it does not. The player vars ride on
  that url rather than through the constructor, `enablejsapi=1` among them,
  because the API reads neither `videoId` nor `playerVars` on this path.

- **Vimeo**'s embed iframe is built from `player.vimeo.com`
  (`packages/provider-vimeo/src/attachment.ts:69`). The SDK
  (`@vimeo/player`, pinned `2.30.4`) is a bundled dependency, imported
  dynamically — nothing is fetched from a Vimeo CDN
  (`packages/provider-vimeo/README.md`). Playdeck's own oEmbed probe at
  `packages/provider-vimeo/src/chromeless-availability.ts` that would reach
  `vimeo.com/api/oembed.json` is opt-in as of SIDEPRO-217: it only fires when
  `VimeoProviderOptions.customControls === true`
  (`chromeless-availability.ts:128`), so Playdeck's own probe never fires
  uninvited — it needs the option, whether the caller builds the adapter
  directly or reaches it through `Player.Root`'s `vimeo` bag. That is a claim
  about Playdeck's probe and not about `vimeo.com/api/oembed.json` traffic in
  general: the SDK reaches the same endpoint by a route of its own, with no
  option set anywhere — see the module-scope document scan below. `dnt` **is on
  unless it is explicitly `false`** — the embed url always carries a `dnt`
  parameter, `1` for every value but `false`, including when the option is left
  unset (`packages/provider-vimeo/src/attachment.ts:72`,
  `options.dnt === false ? '0' : '1'`) — and asks Vimeo not to track the
  session. It is a separate switch and has no effect on whether Playdeck's probe
  runs. `PlayerProviderOptions` carries a `vimeo` key
  (`packages/react/src/provider-loaders.ts:55`), so `dnt`, `customControls` and
  `suppressSeoMetadata` are reachable through `Player.Root` as
  `providerOptions={{ vimeo: {...} }}`; `controls`, `loop`, `startTime` and
  `endTime` are omitted from that bag because `Root` owns them as its own props
  (ADR-0004). So a `Player.Root` consumer can turn Do-Not-Track off —
  `providerOptions={{ vimeo: { dnt: false } }}` sends `dnt=0` — and can fire
  Playdeck's oEmbed probe, `providerOptions={{ vimeo: { customControls: true } }}`.
  Neither needs `createVimeoProvider` to be called directly. One part of that is
  machine-checked: `packages/react/test/provider-loaders.test.ts` asserts, at
  the type level, which providers have a bag and which keys each bag omits, so
  `pnpm typecheck` fails if that shape moves again. It checks nothing else
  here — what `dnt` does to the url, and every line cited in this paragraph,
  were confirmed by reading the source and can still drift.

  The embed iframe is hardened beyond the url. Playdeck sets, at
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
  and will not play. No Playdeck option turns it back on. There is no `sandbox`
  attribute on this iframe at all, and that absence is a weighed decision
  rather than an oversight — see the Vimeo sandbox bargain below. Neither the
  missing `encrypted-media` nor the absent `sandbox` changes which origin is
  reached; they are here because this document is where a reader decides what
  to permit this frame, and a DRM source that silently will not play is what an
  origins-only reading would leave them to find in production.

  Two more things leave the page here that the table above does not explain on
  its face, and both are the SDK's own work at module scope rather than
  anything Playdeck calls — two separate routines, each cited by line below. (Those
  citations are to `dist/player.js`; a consumer's ESM bundler resolves
  `player.es.js` instead, which is the same code six lines up.) The first is not
  a request at all: **the SDK sends the embedding page's full URL — path and
  query included — to the embed frame over `postMessage`.**
  `@vimeo/player` runs `initAppendVideoMetadata()` at module scope
  (`dist/player.js:2827`), which installs a `window` `message` listener
  (`:993-1016`); when a frame whose `src` matches
  `^https://player.vimeo.com/video/\d+` completes the readiness handshake, that
  listener answers it with an `appendVideoMetadata` call carrying
  `window.location.href`. The embed url Playdeck builds matches that pattern, so
  Playdeck's own iframe is the frame it resolves. The
  `referrerpolicy="strict-origin-when-cross-origin"` on that iframe does **not**
  prevent this — the referrer policy narrows the iframe's own request header,
  and this is a message sent afterwards — and neither does `dnt=1`. The message
  is at least targeted at the embed's own origin rather than `*`
  (`dist/player.js:775`), so no unrelated frame can read it. Reproduced in a
  real browser by `e2e/vimeo-seo-metadata.spec.ts`, not read off the bundle
  alone.

  `VimeoProviderOptions.suppressSeoMetadata` (#215) turns it off: Playdeck sets the
  SDK's own guard global before the dynamic import, so the listener is never
  installed. It is **off by default**, for two reasons a consumer switching it
  on has to know. First, **the suppression is page-wide, not per-embed** — the
  SDK's guard is a `window` global, so it silences that handshake for every
  Vimeo embed on the page, including embeds Playdeck did not create. Second, **it
  takes effect on the first Vimeo attach and holds for the life of the page** —
  the SDK module is imported once and cached, and reads the guard while it
  evaluates, so a page whose first Vimeo attach did not ask for suppression
  cannot get it from a later one. A page that has already set that global itself
  keeps its own value, in either direction: Playdeck writes it only when it is not
  already set. Where the result is that the handshake installs anyway — a later
  attach, or a guard the page pinned to `false` — the adapter reports it as a
  non-fatal `configuration` notice on `PlayerState.error` (#333); the ordering
  cannot be repaired, so what is offered is the signal. A guard already set
  truthy is the opposite case: the handshake never installs, so the request was
  honoured and no notice is published.

  The second **is** a request, and it is the one the table's `connect-src` cell
  points at: **importing the Vimeo provider makes the SDK scan the consumer's
  whole document, and for every element carrying `data-vimeo-id` or
  `data-vimeo-url` it issues an oEmbed request and writes the response's `html`
  field into that element.** `initializeEmbeds()` runs at module scope with no
  argument (`@vimeo/player@2.30.4`'s `dist/player.js:2825`), so its parent
  defaults to `document` and the selector runs over the whole page (`:929-931`,
  `parent.querySelectorAll('[data-vimeo-id], [data-vimeo-url]')`). Each match's
  `data-vimeo-*` attributes — the SDK reads 51 of them (`:824`) — are appended
  to the query string of an `XMLHttpRequest` to
  `https://<host>/api/oembed.json?url=…` (`:876-891`), and the JSON response's
  `html` field is assigned to a detached `div`'s `innerHTML`, whose
  `firstChild` is then appended into the scanned element (`:858-865`). Nothing
  Playdeck does causes this and no Playdeck option stops it. The precondition is
  markup, and the markup is the consumer's: **a document carrying no
  `data-vimeo-id` and no `data-vimeo-url` emits no oEmbed request from this
  path at all**. Check whether yours does — markup left behind by Vimeo's own
  embed script, or rendered from a CMS, is where those attributes turn up — and
  read the rest of this note only if it describes your page.

  The opt-out is per element and lives in that markup: the scan skips anything
  carrying `data-vimeo-defer` (`:939-942`), tested with
  `getAttribute(...) !== null`, so the attribute present with **any** value,
  the empty string included, is enough. There is no page-wide opt-out, and that
  is not an oversight to route around. The module-scope block runs six routines
  (`:2823-2830`), and of the ones that touch the page or the network the scan
  is the one with no settable guard: `resizeEmbeds` honours
  `window.VimeoPlayerResizeEmbeds_` (`:963-966`), `initAppendVideoMetadata`
  `window.VimeoSeoMetadataAppended` (`:996-999`), `checkUrlTimeParam`
  `window.VimeoCheckedUrlTimeParam` (`:1028-1031`) and `updateDRMEmbeds`
  `window.VimeoDRMEmbedsUpdated` (`:1069-1072`), while `initializeEmbeds`' only
  condition is a Node/Bun/Deno/Cloudflare runtime sniff (`:17-44`) that is
  false in every browser. The sixth, `initializeScreenfull` (`:2824`, defined
  at `:1119`), has no guard either, but it only builds a fullscreen shim: no
  scan, no request, nothing written into a consumer's elements. So
  `suppressSeoMetadata` has no counterpart here, because the mechanism it uses
  does not exist for this routine. What does bound it is that the scan is not
  re-triggerable: `initializeEmbeds` is not exported and `Player`'s only static
  is `isVimeoUrl` (`:1568`), so it runs when the SDK module evaluates — on a
  Playdeck page, the first Vimeo attach — and not again. `data-vimeo-initialized`
  is a weaker bound than it looks:
  `createEmbed` checks it on entry (`:858`) but only sets it after the response
  returns (`:864`), so it makes the injection once-per-element and does not
  dedupe the request.

  Which host is called is decided by that markup too, and by **either**
  attribute — `data-vimeo-id` is not restricted to bare numeric ids.
  `getVimeoUrl` returns `https://vimeo.com/<id>` only when the value is an
  integer (`:130-132`); any other value, from either attribute, is put through
  the SDK's own URL check instead (`:133-134`), and is rejected with no request
  at all if it fails (`:136-139`). So an integer id always reaches `vimeo.com`
  — the path the table's `connect-src` cell records — and every other value
  reaches whichever host that check admits. It (`:89-91`) accepts exactly
  `vimeo.com`, `www.vimeo.com` and `player.vimeo.com` — subdomains are **not**
  wildcarded, so `m.vimeo.com` is rejected — plus exactly one further label
  under three Vimeo Enterprise white-label suffixes: `<label>.videoji.hk`,
  `<label>.videoji.cn` and `<label>.vimeo.work`, each optionally prefixed by a
  literal `player.` that `getOembedDomain` strips before the request
  (`:103-113`), so `player.acme.videoji.hk` is called as `acme.videoji.hk`. One
  label, not arbitrary depth: bare `videoji.hk` and `a.b.videoji.hk` are both
  rejected. The check is start-anchored and ends on a `(?=$|\/)` lookahead, so
  `https://vimeo.com@evil.com/` and `https://vimeo.com:8080/` are rejected too;
  the scheme is optional, so a protocol-relative `//vimeo.com/…` passes. The
  three white-label suffixes are left out of the table for the same reason the
  Wistia canary host is: nothing in Playdeck reaches them. They are called only
  when the consumer's own document carries a `data-vimeo-id` or
  `data-vimeo-url` naming one, so add them to `connect-src` only if that
  describes your page.

  **Where either attribute can come from untrusted content, that content picks
  which of those hosts is called and its response is `innerHTML`-injected into
  your page** — `data-vimeo-id` as much as `data-vimeo-url`, since a
  non-integer id takes the same URL path. The 51 attribute values ride outbound
  in the query string with it, so attacker-chosen values reach the host too.
  The response is injected even on the rejection path: a body whose
  `domain_status_code` is `403` is handed to `createEmbed` before the promise
  rejects (`:904-906`). And while `innerHTML` on a detached `div` does not
  execute an inline `<script>`, an `<img onerror>`-style loader does run once
  that child is appended — that last is HTML-parsing semantics rather than
  anything read off this bundle or observed in a browser here. A page rendering
  third-party or CMS-authored markup should strip `data-vimeo-*` attributes
  from it, or mark those elements `data-vimeo-defer`.

  **Playdeck itself never takes the SDK's element-upgrade path**, which is the
  same oEmbed-and-inject code reached from the constructor rather than from the
  scan. The loader types the SDK constructor as taking an `HTMLIFrameElement`
  (`packages/provider-vimeo/src/loader.ts:68-70`) and the attachment builds
  that iframe and passes it
  (`packages/provider-vimeo/src/attachment.ts:266-278`); the constructor only
  branches into oEmbed when the element it is given is **not** an iframe
  (`dist/player.js:1519-1531`), so that branch is dead here. That bounds the
  constructor path only: it is a separate call site, and does nothing about the
  module-scope scan at `:2825`.

  One more of those module-scope guards is written by Playdeck, and unlike
  `suppressSeoMetadata` it is not a consumer's choice. **Importing the Vimeo
  provider now sets `window.VimeoCheckedUrlTimeParam` before the SDK is
  imported, which stops `checkUrlTimeParam` installing its listener** (#329).
  That listener answers a recognised embed's `ready` by resolving the frame's
  video id, grepping this page's own url for `vimeo_t_<videoId>`, and calling
  `setCurrentTime` with the value it finds (`:1018-1057`) — so the seek command
  is whatever the query string says, and any third party can supply it by
  handing a victim a link to your page. Nothing legitimate is withheld by
  switching it off: Playdeck positions the playhead itself from `startTime`.
  **The cost is the same page-wide cost the SEO guard has** — this disables
  `vimeo_t_` for every Vimeo embed on the page, including embeds Playdeck did
  not create. A page that wants the behaviour can keep it by setting
  `window.VimeoCheckedUrlTimeParam = false` itself before Playdeck loads;
  Playdeck writes the global only when it is not already set, in either
  direction, exactly as it does for the SEO guard.

  What this is defence against is narrower than it first reads, and the
  measurement is worth carrying: the listener does issue an attacker-chosen seek
  on every `ready`, but at first load the adapter's own positioning seek lands
  after it — the SDK's chain is one round trip from `ready` and the adapter's is
  at least two — so `startTime` survived on a real embed. It closes the case
  where the embed republishes `ready`, which the SDK's permanent listener
  answers and the adapter's once-per-attach positioning does not, and an
  ordering neither side promises. `e2e/vimeo-url-time-param.spec.ts` covers it
  against the real SDK.

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
  (`packages/provider-wistia/README.md`) only decides how long Playdeck waits
  for the `api-ready` handshake before reporting a recoverable error — the
  handshake never arrives on this path, but the timeout does not stop the
  iframe from loading. So a page that can reach a media id serving the
  legacy embed needs `fast.wistia.net` in `frame-src` too, even though
  Playdeck's adapter never treats that path as a successful attach either way.
  Playdeck cannot harden that frame: the element writes it into its own shadow
  root, where nothing this adapter can call reaches it. YouTube's embed was out
  of reach for a comparable reason until #221 moved the frame into this repo;
  no such move exists here, because the element is the vendor's. Playdeck only ever
  sets attributes on the `<wistia-player>` element itself
  (`packages/provider-wistia/src/attachment.ts:336-377`), and most of them are
  behavioural rather than presentational — `mediaId`, `doNotTrack`,
  `controlsVisibleOnLoad`, `endVideoBehavior` and `currentTime` — with
  `playerColor`, `swatch`, `poster` and `transparentLetterbox` the four the
  source itself calls presentation-only (`:359`). None of them is a
  `referrerpolicy` or an `allow`, so the legacy embed iframe travels under the
  page's own referrer policy — see the referrer section below for the only
  remedy there is. The element also dynamically loads a Mux Data
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
  and asset URL afterwards is built from the result. **Playdeck never injects
  `E-v1.js`** — the only script it builds is `player.js`, and
  `packages/provider-wistia/src/loader.ts:155-158` says so in as many words — so
  on a Playdeck page that scan matches nothing and takes its fallback,
  `fast.wistia.net` (`dist/wistia-player.js:7447`) — which is why the
  legacy-embed iframe above resolves to that host. The canary is left out of the
  table for exactly that reason: the scan would accept it, but only on a page
  already carrying a Wistia `E-v1.js` embed served from it, which nothing in
  Playdeck creates. A page that carries one for its own reasons moves Playdeck's
  media-data, engine, legacy-iframe and asset fetches to whichever of the three
  that embed came from, so add the canary host if that describes your page.

## What referrer each embed sends

Three providers load a third-party iframe, and a frame's first request carries
the embedding page's URL in its `Referer` header unless something narrows it.
On a page whose own URL holds a customer id, an order number or a search term,
that identifier is what travels. `referrerpolicy` on the frame is what narrows
it, and it only counts if it is on the element before the element is in the
document: the header leaves with the first request, so an attribute written
after that changes nothing.

- **Vimeo** — `strict-origin-when-cross-origin`, set by Playdeck on the frame it
  builds (`packages/provider-vimeo/src/attachment.ts:272`), before the append at
  `:278`. Vimeo receives this page's origin and not its path or query, which is
  still enough for Vimeo's own domain-restriction check. See the Vimeo note
  above for what the policy does **not** cover: the SDK sends the page's full
  URL to the frame over `postMessage` afterwards, and that is a separate switch.
- **YouTube** — the same policy, on the same terms, as of #221
  (`packages/provider-youtube/src/attachment.ts:220`, before the append at
  `:239`). Playdeck builds this frame precisely so that the attribute can be on it
  in time; the iframe API adopts the frame it is handed rather than building one
  of its own.

  Two things about this are worth stating plainly, because a reader who assumes
  the change closed an open leak would be assuming too much.

  First, the frame the API used to build already carried the same policy. Read
  out of `www-widgetapi.js` — player build `b0d2d49a`, fetched 2026-08-17 — and
  confirmed against a real player in a browser: the API sets `frameBorder`,
  `allowfullscreen`, `allow`, `referrerPolicy` and `title` on the iframe it
  creates, and its referrer policy is `strict-origin-when-cross-origin` too. So
  this change did not narrow the header. What it changed is who guarantees it:
  that script is unversioned and mutable, on the same terms as the SRI note
  below, so the old guarantee was Google's to withdraw on Google's schedule and
  the new one is this repo's.

  Second, the header was never the whole of it, and this is the part that did
  narrow. When the API builds the frame it composes the embed url itself, and
  appends `forigin=<this page's full URL>` to it, plus `aoriginsup`, plus
  `gporigin` and `widget_referrer` where a referrer exists. So the path and the
  query reached YouTube in the query string regardless of what the `Referer`
  header said, and a `referrerpolicy` was never going to stop that. Playdeck's url
  carries none of those parameters. That is a real narrowing and also a
  behavioural change on Google's side of the frame that nothing here can test:
  whatever those parameters are for, this embed no longer reports them.

- **Wistia** — nothing Playdeck can set. The frame only exists on the legacy-embed
  fallback path, where the `<wistia-player>` element writes it into its own
  shadow root, and the element's attribute surface carries no referrer key; see
  the Wistia note above. **The only remedy is a page-level `Referrer-Policy`
  response header on the embedding page**, and that is the consuming
  application's call rather than something this library can make:
  `Referrer-Policy: strict-origin-when-cross-origin` (or narrower) on the
  document that mounts the player covers every frame it loads, Wistia's
  included. No Playdeck option exists for it and none is planned — the exposure is
  the vendor element's shadow root, not a gap in this provider's options.

One thing tempers all three, and it is worth knowing before treating the two
attributes as load-bearing: browsers have defaulted to
`strict-origin-when-cross-origin` for some years (Chrome 85, Firefox 87), so on
a page that declares no policy of its own these attributes match the default
rather than narrow past it. They earn their place on a page that declares
something wider — `unsafe-url` or `no-referrer-when-downgrade`, whether by
header or by `<meta name="referrer">` — because a frame's own attribute
overrides the document's policy, while Wistia's frame follows it. That default
is read off the specification and the browsers' release notes, not verified
here; the two attributes are verified, by `e2e/youtube-real.spec.ts` against a
real player and by each provider's unit suite.

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
  ever built for `viewport` (`packages/react/src/use-activation.ts:524-525`).
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
- **Playdeck's own Vimeo oEmbed probe** does not fire at all unless
  `customControls: true` is set, regardless of `loading` — see the per-provider
  note above. It is set either on `createVimeoProvider` directly or through
  `Player.Root` as `providerOptions={{ vimeo: { customControls: true } }}`; both
  reach the same place, so a `Player.Root`-only page can reach `vimeo.com` this
  way. Once set, the probe starts at that provider's own attach — the same
  gate as everything else above — racing the embed's own load
  (`CHROMELESS_PROBE_TIMEOUT_MS`, 4 seconds).
- **The Vimeo SDK's document scan** is a request, and `loading` decides when it
  starts but not whether it happens. It runs when the SDK module evaluates —
  the first Vimeo attach on the page, so the earliest gate any Vimeo source on
  it passes — and no later attach repeats it. What decides whether it emits
  anything is not a prop or a provider option but the consumer's own markup: a
  document carrying `data-vimeo-id` or `data-vimeo-url` anywhere gets one
  oEmbed request per matching element, and a document carrying neither gets
  none. No `loading` setting suppresses it — see the per-provider note above.
- **The Vimeo SDK's `appendVideoMetadata` message** is not on this timeline
  because it is not a request: it is a `postMessage` to the embed frame Playdeck
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

Two vendor scripts are injected into the page by Playdeck, and neither carries an
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

YouTube's script carries a second substitution path beside that one, and it is
the cheaper of the two to reach. Before fetching anything, the loader checks
whether a working API is already sitting on `window` and adopts it in
preference to a fetch: `apiFromWindow`
(`packages/provider-youtube/src/loader.ts:94-95`) asks only
`typeof target.YT?.Player === 'function'`, and `loadYouTubeIframeApi` returns
a resolved promise over that value when the check passes (`:106-110`) — the
`<script>` element is never built and `iframe_api` is never requested. The
test is structural and nothing more: it cannot tell YouTube's real API from
anything shaped to answer `typeof … === 'function'` with a function, because
no structural test can. Once adopted, the object is memoised into the
module-global `sharedLoad` (`:92`) and handed back unchanged to every later
call on the page. That memo has exactly one clearer: the exported
`resetYouTubeIframeApiLoader` (`:185-187`). `fail()`'s clearing (`:145-146`,
and even there conditional on `sharedLoad === load`) belongs to the fetch
path's own promise executor, which a bare `Promise.resolve` adoption never
enters, so nothing on that path ever runs against an adopted memo. And
`resetYouTubeIframeApiLoader` is a test seam, not a runtime one: every call
site is a test (`packages/provider-youtube/test/loader.test.ts:263`, `:281`)
or this package's own example harness (`examples/provider-youtube.ts:23`),
the README tables it as such ("for tests that need a clean load",
`packages/provider-youtube/README.md:70`), and the changeset that introduced
it says the same in as many words ("for tests that need a clean load, not for
app code", `.changeset/youtube-api-load-has-a-deadline.md:39-41`). No runtime
path in Playdeck calls it, and no `Player.Root` option reaches it either — so a
successful adoption holds for the document's lifetime unless the page's own
code calls that reset itself.

This is accepted, not overlooked, and on the same terms as the grant above:
reaching the substitution requires a script that already runs on the page
before Playdeck's first attach, and a script that already runs on the page
already has the DOM, the cookies and everything else `www.youtube.com` would
gain if it ran arbitrary code there — adopting its global costs the page
nothing beyond the privilege the bargain above already discloses. It is
**not a privilege escalation** over what this document already grants. A
stricter shape test would not change that calculus; it would only dress an
unverified adoption up as a verified one, which is worse than the current
honest gap. The short-circuit itself earns its place independently: a page
that has already loaded the iframe API for its own reasons — a co-tenant
player, a tag manager, an embed Playdeck did not create — has already had
`onYouTubeIframeAPIReady` fire once. That callback fires exactly once per
script evaluation, at the vendor script's own module scope, with no loop,
listener or re-invocation that could trigger it again — read out of
`www-widgetapi.js` (build `3891b194`, fetched 2026-08-17, the same file the
referrer section above cites for an unrelated claim); not confirmed against a
real player in a browser the way that one was. A loader that ignored the
global and waited on the callback regardless would not merely miss it: it
would adopt the co-tenant's own `<script>` element too (`:114-117`, the same
lookup the fetch path itself uses to avoid double-injecting), so no fresh
`load` or `error` event would fire on it either — a script element this
loader adopts rather than creates can be past both already, which is exactly
what the comment at `:83-84` says. With no event left to wait on, such a
loader would sit out the full `API_READY_TIMEOUT_MS` (`:90`, 15 seconds; the
deadline itself set at `:123-129`) before reporting failure on exactly the
pages where a working API is sitting right there. Adopting it is what lets
those pages and Playdeck's own attach coexist.

Both providers do offer a seam for replacing the load, and self-hosting the
script is what either seam is for: the vendor's own engine, configuration and
media-data requests still go to the vendor's CDN, so only `script-src` changes.
But the two are not equally reachable, and the difference matters most to the
consumer this project leads with — the one who installs `@playdeck/react` and never
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

## The Vimeo sandbox bargain

Playdeck builds two of the three embed frames itself. The Vimeo one is
`packages/provider-vimeo/src/attachment.ts:393-404`, with the comment recording
this decision at `:388-392`. The YouTube one is
`packages/provider-youtube/src/attachment.ts:227-274`, handed to the iframe API
at `:302` — see the YouTube row above. Only Wistia's frame is genuinely not
Playdeck's to configure: that provider creates the vendor's custom element
(`packages/provider-wistia/src/attachment.ts:339-341`), and whatever frame the
element then makes is the vendor's.

This section records the decision taken for the **Vimeo** frame. The YouTube
frame's is recorded in the section after it, reached from that frame's own
bridge rather than carried across from this one.

On the Vimeo frame, Playdeck sets no `sandbox` attribute. No tracked file sets one
on any element: `git grep sandbox` returns this document, the two comments that
point back at it — `packages/provider-vimeo/src/attachment.ts:388-392` for this
section and `packages/provider-youtube/src/attachment.ts:222-226` for the next
one — and one unrelated hit, the `sandbox;` CSP directive `next/image` needs
for SVG (`tests/integrations/next-image/next.config.ts:7`), a different
mechanism on a different surface. The absence is deliberate (#237), and it is
recorded here rather than left to a commit message because this document is
where a reader decides what to permit this frame.

What the embed can do today is everything a frame is allowed by default: run
scripts, hold its own origin — `player.vimeo.com`, with that origin's cookies
and storage — navigate the top-level page away, open popups, and submit forms.
That is the standard privilege of any third-party embed rather than something
Playdeck grants beyond the norm, and this audit found no evidence Vimeo does any
of it. Both halves are load-bearing. The origin isolation on this frame is the
cross-origin boundary itself, not a sandbox policy; finding no evidence of
misuse is not a restriction, and if the embed's behaviour changed tomorrow
nothing Playdeck ships would stop it.

The two restrictions that would matter cannot be applied. `allow-scripts` and
`allow-same-origin` are both required for the `@vimeo/player` postMessage
bridge to work at all, and that bridge is how every command this provider
issues reaches the player. Drop `allow-same-origin` and the frame gets an
opaque origin, so the messages it posts out arrive with an `event.origin` of
`"null"` — and the SDK discards every inbound message whose origin is not a
Vimeo host (`isVimeoUrl(event.origin)`, `@vimeo/player@2.30.4`'s
`dist/player.js:1494`, against the host pattern at `:89-90`). The ready
handshake never completes, `player.origin` is never narrowed off the `'*'` it
starts at (`:1491`, `:1497-1498`), and every command posted through
`postMessage` (`:775`) is addressed to a player that never answered. Drop
`allow-scripts` and there is no player in the frame to answer in the first
place. That chain was confirmed by reading and not by running: the SDK lines
are cited so they can be checked and can still drift, and the opaque-origin
step is taken on the platform's terms rather than watched in a browser, because
no sandboxed frame was ever loaded here — which is this section's own thesis
rather than an exception to it, as the paragraphs below set out. So the only
sandbox this provider can carry is one that includes both, and a frame holding
both can run arbitrary script and reach its own origin's storage, which is most
of what the attribute exists to prevent. A sandbox including `allow-scripts
allow-same-origin` is close to no sandbox.

What such a sandbox could still withdraw is top-level navigation and form
submission, and the embed appears to need neither. The gain is real and should
not be waved away — navigating the host page out from under the user is the
highest-impact thing a hostile embed could do, and the highest-impact thing on
the list above that a sandbox could take back at all. It is also the whole of
the gain, those two and nothing else, and it is bought with a regression risk
**no test in continuous integration covers**. The specs that drive the real
Vimeo embed live in `e2e/vimeo-smoke.spec.ts`, every one of them tagged `@real`
(`:21`, `:90`, `:105`, `:124`, `:189`), and `grepInvert` filters that tag out
of every run that does not set `PLAYDECK_REAL_PROVIDERS`
(`playwright.config.ts:15`). They are run by hand:
`PLAYDECK_REAL_PROVIDERS=1 pnpm test:e2e -- --grep @real`
(`e2e/vimeo-smoke.spec.ts:4-6`). A candidate sandbox value could not be proven
by CI here — only by somebody remembering to run those five specs.

A green manual run would not settle it either. Those five cover chromeless
playback and caption cue text, the chromeless-controls probe on a free-plan and
on a paid-plan video, the quality rungs, and cue suppression; they run under
the `chromium`, `firefox` and `webkit` projects, all three configured from
Playwright's Desktop device descriptors (`playwright.config.ts:49-63`). No spec
exercises advertising, and no project is a mobile browser, so fullscreen on a
phone is untested by construction. A sandbox value that silently broke the
postMessage bridge, an ad slot, or mobile fullscreen would not surface as a red
test. It would surface as a flaky embed in a consumer's production page, which
is an expensive failure mode to buy a narrow gain with.

DRM is the one item on the usual list of untested sandbox casualties that does
not apply here, and folding it in would overstate the risk. DRM-protected
playback is already withheld from this frame by the deliberately absent
`encrypted-media` grant on the `allow` list — see the Vimeo row above — so it
is not a capability a sandbox could regress. It is off already, by a different
mechanism and for a different reason. Advertising and mobile fullscreen are the
paths that are both live and uncovered.

This was measured rather than defaulted into. The alternative had a concrete
shape: the value #237 proposed, `allow-scripts allow-same-origin
allow-presentation allow-popups allow-popups-to-escape-sandbox`, which would
have withdrawn top-level navigation and forms and nothing else. It was weighed
against the cost of shipping it unverified and rejected on that comparison, not
skipped. The consequence is not softened by that reasoning: a Vimeo source puts
a frame on your page that can navigate the page away, and Playdeck does not
prevent it. That is the bargain a Vimeo source makes on your page's behalf, and
it is accepted, not overlooked — not a gap to close. It bounds to real
consumers rather than to this repository: `@playdeck/provider-vimeo` is
published on npm, so it reaches anyone who mounts a Vimeo source through
`Player.Root` or calls `createVimeoProvider` directly.

Three things would reopen it, each checkable rather than a matter of taste:

- **Vimeo documents a supported `sandbox` value for the embed.** The value
  would then be the vendor's contract rather than this repository's guess, and
  the verification objection above stops applying.
- **The real embed gains in-CI coverage.** A candidate value could then be
  verified rather than reasoned about, which is the whole of the objection.
- **Evidence appears of an embed exercising top-level navigation.** The gain
  stops being narrow, and the comparison above inverts.

## The YouTube sandbox bargain

Playdeck sets no `sandbox` attribute on the YouTube frame either. The conclusion
matches the Vimeo one, but it is not inherited from it: the reason a sandbox is
close to worthless there is that `@vimeo/player`'s bridge needs `allow-scripts
allow-same-origin`, and whether YouTube's bridge needs the same had never been
read (#321). It does, on its own evidence, and this section is that reading.

**How to re-derive the citations below**, because they rot by design. YouTube's
iframe API is not a bundled dependency, so there is no `node_modules` copy to
cite and no version to pin the way the Vimeo section pins `@vimeo/player@2.30.4`.
`packages/provider-youtube/src/loader.ts:77` names
`https://www.youtube.com/iframe_api`, injected as a script at `:171-174`; fetch
that url and it answers with a 993-byte loader whose `scriptUrl` holds a
**versioned** path to the real bundle. Read the revision out of it, then fetch
`https://www.youtube.com/s/player/<revision>/www-widgetapi.vflset/www-widgetapi.js`.
Everything below was read at revision **`e937390a`**, where that bundle is
26,769 bytes on 185 minified lines. Citations into it are `line:column`, both
1-indexed, the column counted in characters from the line's start (the file is
plain ASCII, so a byte offset gives the same number); on lines this long a line
number alone would not locate anything.

**Host to frame is targeted, never `"*"`.** `n.sendMessage` (`:163:1`)
serialises the command and posts it with
`this.h.contentWindow.postMessage(a, b)` (`:163:158`), where `b` is
`Na(this.h.src || "").replace("http:", "https:")` — the origin parsed straight
out of the frame's own `src` (`Na` at `:138:210`). Everything the provider
issues goes through that one function: `ab()` at `:157:1` wraps each call as
`{event: "command", func, args}`, and the readiness probe `bb()` at `:159:1`
posts `{event: "listening"}` on a 250 ms interval until the frame answers.

**Frame to host is gated on `event.origin` twice.** `cb()` (`:178:1`) installs
the single `window` `"message"` listener. An inbound message is dropped unless
`gb.has(d.origin)` (`:178:87`), `gb` being the set of registered frame origins,
and dropped again unless `d.origin === k.P` (`:178:171`), the origin registered
for that specific widget id. Both are filled at `:180:1`
(`Z[b] = {T: a, P: c}; gb.add(c)`), from `cb(a, a.id, String(Y(a, "host")))` in
`Ya()` at `:160:1`.

**And that `host` is not a value Playdeck passes.** The constructor derives it
from the element it was handed: `b.host || (b.host = c ? Na(a.src) :
"https://www.youtube.com")` at `:146:430`, where `c` is
`tagName === "iframe"`. So the origin both gates run against is the origin of
the `src` Playdeck wrote at `packages/provider-youtube/src/attachment.ts:228` —
`https://www.youtube-nocookie.com` by default. That is the same fact the
comment at `attachment.ts:276-280` already asserts, now confirmed in the
vendor's own code rather than inferred from the API behaving.

Drop `allow-same-origin` and both directions fail, each on its own gate,
because the frame gets an opaque origin. Host to frame: a `postMessage`
carrying a concrete `targetOrigin` is delivered only if the target document's
origin is same origin with it, and an opaque origin is same origin with no tuple
origin — so every command and every `listening` probe is discarded by the
platform before the frame sees it. Frame to host: an opaque origin serialises to
`"null"`, so `gb.has("null")` is false and the listener at `:178:87` breaks out
before it even parses the payload. Both of those steps are the platform's, taken
from the HTML specification's `postMessage` and origin-serialisation rules
rather than watched in a browser: no sandboxed frame was ever loaded here, which
is this section's own conclusion rather than an exception to it. The code either
side of them was read, and is cited so it can be checked.

The result would not be subtle. `a.u` never becomes true, so nothing queued in
`a.m` is ever flushed (`:157:1`), `onReady` never fires, and Playdeck's own
15-second deadline (`attachment.ts:38`, armed at `:284-300`) emits its
non-fatal `provider` error — "The YouTube player did not become ready. Its embed
may be blocked by the page CSP, an extension or the network." — for every
YouTube source on the page. Drop `allow-scripts` instead and there is no player
in the frame to answer in the first place. So the only sandbox this provider can
carry includes both tokens, which is where Vimeo's reasoning ends up and for the
same structural reason: an origin-checked postMessage bridge cannot survive an
opaque origin.

That pair's reputation comes from a case this is not. On a **same-origin** frame
`allow-scripts allow-same-origin` is an escape hatch: the frame's script can
reach into the parent document and strip the `sandbox` attribute off its own
element. This frame is cross-origin — `www.youtube-nocookie.com` against the
consumer's page — so the same-origin policy blocks that reach with or without a
sandbox. What `allow-same-origin` restores here is narrower: the frame keeps
_its own_ origin, and with it that origin's cookies, storage and EME, and the
ability to be addressed by and identified in the origin-checked messages above.
It never reaches the consumer's page. Less alarming than the folklore, and by
the same token less useful — a sandbox obliged to grant script and the frame's
own origin has withdrawn nothing an embed of this kind was going to use.

Measured against the real baseline — today's frame, which carries no sandbox at
all — what a two-token sandbox could still withdraw here is top-level navigation
and form submission. That is the same residual gain the Vimeo section weighs,
neither larger nor smaller. (Reasoned from the token set rather than tested: the
rest of what it would withhold is modals, pointer lock, orientation lock and
downloads.)

An observation, and not what the decision rests on: YouTube's own code names
both of those tokens as things its embed needs. On the `<div>` path, which
Playdeck does not take, the API builds the frame itself, and inside
`if (Va.yt_embedsEnableIframeSrcWithIntent)` (`:148:347`, `Va` being `window` at
`:145:2`) it sandboxes that frame with `allow-same-origin allow-scripts
allow-forms allow-popups allow-popups-to-escape-sandbox
allow-storage-access-by-user-activation` (`:149:79`), then adds
`allow-presentation` and `allow-top-navigation` (`:149:450`). Eight tokens,
`allow-forms` and `allow-top-navigation` among them. It is not a contract and it
is not this frame: the branch is behind a global flag whose default this
document did not establish, it builds a `youtube.com/embed` url rather than the
`youtube-nocookie.com` one Playdeck writes, and it is unreachable on the iframe
path Playdeck takes. So it is not a measurement of the gain and nothing above
depends on it. The bridge reading is what decides this.

Two parts of the Vimeo section do not transfer, so they are restated rather than
assumed:

- **DRM is live on this frame, not already off.** The Vimeo frame's `allow`
  list deliberately omits `encrypted-media`, which is why that section can set
  DRM aside as a capability no sandbox could regress. This frame's list carries
  it. The whole of it, at `attachment.ts:260-263`, is `accelerometer`,
  `autoplay`, `clipboard-write`, `encrypted-media`, `gyroscope`,
  `picture-in-picture` and `web-share` — restated verbatim from what the API
  writes onto the frame it builds on the `<div>` path (`:147:373`), which is
  what the comment at `attachment.ts:256-259` claims and this reading confirms.
  So a DRM-protected source does play here. Because `allow-same-origin` is
  required for the bridge regardless, DRM imposes no constraint the bridge has
  not already imposed — but it is one more live capability riding on that token
  rather than one already withheld.
- **The `allow` attribute and `allowfullscreen` are a separate mechanism.**
  Permissions policy and sandbox are independent, so a sandbox does not revoke
  `allow` grants. Fullscreen on this frame is governed by the `allowfullscreen`
  attribute Playdeck sets at `attachment.ts:264`, not by a sandbox token in the
  current specification. That last point is reasoned from the specification and
  not tested here, and older engines coupled the two more tightly than the
  specification now does.

The `origin` player var is not what any of this turns on. Playdeck sets
`origin=<the page's origin>` on the embed url (`attachment.ts:219-221`, `:249`)
because the API sets exactly that var on its own path —
`c.origin = window.location.protocol + "//" + window.location.host` at
`:165:346`, alongside `c.enablejsapi` at `:165:286` — and on the adoption path
that builder never runs, so Playdeck restates it. Note what the var is: the
**host page's** origin, told to the frame. It is not what the gates above check;
those check the frame's origin, taken from `src`. What the player inside the
frame does with the var could not be read — that code ships inside the embed,
not in this bundle — so the rationale in the comment at `attachment.ts:219-220`
is Google's and not something this audit confirmed. What can be said is narrower
and enough for the question here: a sandbox would not change the value Playdeck
sends, so this var is not the thing a sandbox breaks. The frame's own origin is.

Verification is one degree worse than Vimeo's, but not for the reason a count of
specs would suggest. Four `@real` tests drive the real YouTube embed, not one,
and `grepInvert` filters every one of them out of any run that does not set
`PLAYDECK_REAL_PROVIDERS` (`playwright.config.ts:15`). What each would do to a
sandbox that broke the bridge is the thing that matters, and it does not split
the way their shapes suggest:

- `e2e/youtube-real.spec.ts:11-50`, tagged `@real` (`:12-13`), **would** catch
  it — at `:48`, because `ActivationButton` renders for every activation state
  except `ready` (`packages/react/src/loading-error.tsx:40`), so an overlay that
  should have gone is still there. Not at `:45`: `paused` is the initial
  playback state (`packages/core/src/player-controller.ts:147`), so
  `/playing|paused/` is satisfied by a player that never started.
- `e2e/buffered-real.spec.ts:56-105`, tagged `@real` (`:57-58`), **would** catch
  it — its awaited `whenReady()` (`:36`) never settles, and no real buffered
  range ever arrives behind it.
- the `youtube` leg of the two-provider loop at `e2e/reference.spec.ts:374-385`
  (titled at `:375`) and `e2e/reference.spec.ts:391-398` **would not**, even
  though they assert `data-provider` immediately after activation with no
  confirmed playback — which looks like exactly the shape that would catch it.
  `data-provider` is written when the adapter is constructed, not when the frame
  answers (`packages/core/src/player-controller.ts:442` sets `provider`
  alongside `activation: 'loading-provider'`), `PlayButton` renders it
  unconditionally (`packages/react/src/transport-controls.tsx:115`), and the
  control row it sits in is `hidden` rather than unmounted
  (`apps/storybook/stories/reference/reference-player.tsx:381`, `:421`), which
  `toHaveAttribute` does not care about. AirPlay and PiP are hard-coded
  unavailable on this provider either way, so all four assertions hold on a
  frame that never posted back. These two carry `@real` in the title rather than
  in a `tag`, which `grepInvert` matches the same way
  (`e2e/reference.spec.ts:17`).

Two nearby files are not coverage of this at all. `e2e/a11y-media.spec.ts:27-28`
names the story's YouTube leg but drives the local MP4 leg only, the
`RealSources` story having started on `local` and switching only on a click
(`apps/storybook/stories/reference/reference-player.tsx:557`). And the one
YouTube spec that **does** run in CI is stubbed past the bridge by construction:
`e2e/youtube.spec.ts` intercepts every YouTube request and serves a stand-in for
the iframe API (`:61-84`), so there is no real frame and no real postMessage in
it.

So the bound is narrower than "could not be verified". Nothing in CI can verify
a candidate `sandbox` value — what would catch a broken bridge never runs there,
and what runs there is stubbed past the thing under test. A hand run **can**
verify one, through the two playback-dependent specs, but only on a network
YouTube will serve: `youtube-real.spec.ts`'s own header records that YouTube
serves no stream to a datacenter IP, so confirmed playback never arrives there
(`:8-10`), which is why the schedule was removed (#118). What stays genuinely
unverifiable is that playback-dependent half on any runner — and a green hand
run carries information where a red one does not, because the network can refuse
the embed for reasons that have nothing to do with the attribute.

So: no `sandbox` attribute on the YouTube frame, deliberately, on the same terms
as Vimeo's and for the same underlying reason — an origin-checked postMessage
bridge that cannot survive an opaque origin — giving up the same residual gain,
top-level navigation and forms. The consequence is the one the Vimeo section
states in full, with `www.youtube-nocookie.com` in place of `player.vimeo.com`,
and so is the npm bound, with `@playdeck/provider-youtube` in place of
`@playdeck/provider-vimeo`.

Severity, and not only reach, since that is what #321 asked for. What the
decision costs a consumer is exactly those two capabilities, exercised from a
frame on a page that has already chosen to embed YouTube. It is not an
escalation into the consumer's own origin — the cross-origin boundary holds with
or without the attribute — and it is not something the consumer could withdraw
and keep playback, because the bridge needs the two tokens that make the sandbox
inert. So the severity is the severity of trusting YouTube's embed at all, which
mounting the provider already is, rather than an additional risk this decision
adds on top.

Three things would reopen it:

- **YouTube documents a supported `sandbox` value for the embed.** The eight
  tokens above are read out of a minified bundle at one player revision, behind
  a flag, on a code path Playdeck does not take. Published as a contract they
  would be the vendor's word rather than this document's reading, and the
  verification objection would stop applying.
- **The real embed becomes runnable in continuous integration.** Today it is
  not, for a reason no amount of test-writing fixes (#118).
- **Evidence appears of the embed exercising top-level navigation against the
  user's interest.** The gain stops being narrow and the comparison inverts, as
  it does on the Vimeo frame.

## A note on `style-src`

Everything above is about `script-src`, `frame-src`, `img-src`,
`connect-src` and `media-src`. Playdeck's primitives also carry a `style-src`
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
(or per-request nonces or hashes covering that markup) for Playdeck's
pre-hydration output to render with its structural geometry intact. This
audit did not verify whether Playdeck's build offers a nonce- or hash-friendly
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
  oversight, but it is not a thing found "in good order" either. Nor is this
  bullet unqualified for Vimeo: bundling the SDK is what makes importing it
  evaluate the vendor's module scope on your page, which is what runs the
  document scan — a remote script tag would too, but this one arrives without a
  network request to notice. See the Vimeo row above.
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
error or metrics request rather than a video that visibly does not play.
`vimeo.com` belongs in `connect-src` on two counts, and the second needs no
caller to opt into anything: some caller in your app setting
`customControls: true`, whether directly or through
`providerOptions={{ vimeo: {...} }}`; and the Vimeo SDK's module-scope document
scan, which fires for any element anywhere in your page carrying
`data-vimeo-id` or `data-vimeo-url`. Leave it out only if neither describes
your page. Vimeo's three white-label suffixes stay out of this union for the
same reason the Wistia canary does — nothing in Playdeck reaches them; see the
per-provider note. None of this needs `'unsafe-inline'` or `'unsafe-eval'` in
`script-src` — every provider here is a script or iframe load, not inline code.
