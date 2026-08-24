# @playdeck/provider-vimeo

## 0.2.0

### Minor Changes

- ea664ad: `PlayerState.error` now keeps the most important **Notice** of an attach rather
  than the first one reported (#368).

  A notice is a non-fatal `configuration` error reporting a value that was
  rejected while the fall-back it degraded to stands unchanged. The state has one
  error slot and no event carries the loser, so an adapter that rejects two
  options in one attach has one of them silenced for good — and until now that was
  whichever it happened to check first. A cosmetic refusal reported early
  therefore hid a security- or privacy-relevant one reported after it: exactly
  what #332 fixed for Wistia by reordering two checks, a fix that held the
  instance and left the mechanism.

  Notices are now ranked. `PlayerError` carries an optional
  `severity: PlayerErrorSeverity` — `'protective'` where a control that protects
  the viewer fired (an untrusted URL blocked, a privacy opt-out that did not
  take), `'presentational'` where a cosmetic option was ignored — and the slot
  keeps the highest severity whatever order the notices arrived in. Ties are
  settled by a fixed precedence rather than by arrival — the notice already
  standing in the slot, then the provider's own notice, then a refused consumer
  URL, the order #330 recorded — so a single attach still cannot flap the slot.
  The rule governs a provider's notice against a refused consumer URL as well,
  which was the one masking path #332 never covered: a refused URL is protective,
  so a cosmetic provider notice no longer takes the slot from one, and where the
  two tie and are resolved in the same pass the provider's own notice wins.

  The field is optional and an absent severity ranks as `'presentational'`, so a
  provider adapter outside this repo emitting a notice without one keeps working
  and displaces nothing. Every notice this repo emits declares one: the five
  refused-URL surfaces, Wistia's `poster` and YouTube's `host` and Vimeo's
  ineffective `suppressSeoMetadata` are protective; Wistia's `playerColor` and
  Vimeo's incomplete chromeless probe are presentational.

  **No message changed and no notice stopped being emitted.** What changed is
  which of two an operator observes where an attach reports both. The
  hand-placed orders that used to carry this — Wistia's poster-before-colour,
  Vimeo's suppression-before-probe — are correct and stay as they are; they are
  simply no longer what the outcome rests on.

  `@playdeck/core` also exports `isNotice(error, lifecycle)`, the one rule that
  tells a notice from a failure. The controller and `ErrorDisplay` both apply it,
  and a consumer rendering `PlayerState.error` itself can now classify an error
  exactly as the bundled surface does instead of restating the rule.

  `@playdeck/core` and the three provider packages land as `minor` rather than
  `patch` for the reason #319 and #332 did: no API was removed or narrowed, but
  what a released package reports did — an attach that rejects two options now
  surfaces the other one of them — and a behaviour change should not arrive as a
  patch. Core carries public additions besides, which `minor` answers to on their
  own: `PlayerErrorSeverity`, the optional `severity` field on `PlayerError`, and
  the `isNotice` export.

  `@playdeck/react` takes `patch` because nothing it renders moved.
  `ErrorDisplay` gave up its own copy of the notice rule for core's `isNotice`,
  which is the same three clauses in the same order, so every error classifies
  exactly as it did and every overlay falls exactly where it fell; the
  `use-activation.ts` change is comments only, and `setActivation` still ranks
  nothing. What a React consumer observes differently is state core publishes, and
  it arrives through the dependency rather than from this package.

- 07180ca: The Vimeo provider now switches off the `@vimeo/player` SDK's `vimeo_t_`
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

- 8157f0a: The Vimeo provider now reports a `suppressSeoMetadata` request that did not
  take, as a non-fatal `configuration` Notice on `PlayerState.error` (#333).

  `suppressSeoMetadata` is a privacy control: it stops the `@vimeo/player` SDK
  answering a recognised embed's readiness handshake with `window.location.href`,
  path and query included. It works by setting a `window` guard the SDK reads
  while its module evaluates, and the module is imported once per page — so only
  the attach that performs the import decides it. A second player asking for
  suppression after a first one loaded without it got nothing, and was told
  nothing, while every other consumer option that degrades publishes a Notice
  (#235, #318). This one degraded to the **unsafe** default in silence.

  **The ordering is not fixed, because it cannot be.** The SDK reads the guard as
  it evaluates; a request arriving later is too late by construction. What lands
  is the missing signal, and nothing about when suppression applies has changed.

  The check is by outcome, not by mechanism: suppression was asked for, and the
  SDK's module evaluation did not suppress. That covers both ways a request goes
  nowhere — a module already imported, and a page that set the guard itself,
  `false` included — with one condition, and it stays quiet when somebody else
  suppressed first, because then the request was honoured.

  The outcome cannot be read off `window` afterwards, which is the subtlety the
  whole change turns on. On the branch that installs the listener the SDK also
  writes the guard `true` (`dist/player.js:999`), so once the module has
  evaluated every case is truthy — suppressed and sending alike. The answer is
  therefore recorded in the importing call, from what the guard held in the
  instant before the import, and a new `isSeoMetadataSuppressed` predicate in the
  loader reports that record. It answers `undefined` until a load has resolved, so
  "no evaluation has decided" is never reported as a failure. The vendor global's
  name stays in the one module that already owns it, and `loadVimeoSdk` keeps its
  signature.

  Vimeo now has two Notices, and the controller keeps one per attach — the first
  emitted wins and the rest are dropped with the provider (#332, #368). This one
  is emitted at the SDK load, which every path to the chromeless probe's Notice
  runs through, so the privacy report beats the presentational one by
  construction rather than by convention. The placement is commented as
  load-bearing and pinned by a test that fails if the emit moves past the probe.

  `e2e/vimeo-seo-metadata.spec.ts` covers it against the real SDK, which is the
  only place the vendor's own write to the guard is in play, and the loader's
  test doubles now perform that write the way module evaluation does.

  It lands as `minor` rather than `patch` for the reason #319 and #332 did: no
  API changed, but what a released package reports did, and a behaviour change
  should not arrive as a patch.

- a30e040: YouTube and Vimeo now bound the wait for their embed to become ready. Neither
  did: YouTube reached `ready` only from the iframe API's `onReady` callback and
  Vimeo only after `player.ready()` resolved, and neither armed a timer for the
  case where that callback or promise never arrives. A blocked embed therefore
  parked the player in `loading` for ever with `error: null` — so neither
  `ErrorDisplay` nor `ActivationButton` engaged, because both gate on
  `activation === 'error'` — and on YouTube every `whenReady()` call added a
  resolve function that never settled, while its own comment claimed it "never
  hangs on an outcome".

  The triggering condition is ordinary rather than exotic: a page CSP without
  `frame-src www.youtube-nocookie.com` or `player.vimeo.com`, an extension or DNS
  blocking the frame, a captive portal, or a vendor frame that loads but never
  posts back.

  Both now fail the attach after fifteen seconds with a `provider` error that is
  `recoverable`, naming the embed rather than the API — the actionable cause is
  almost always the consumer's own CSP. Fifteen seconds matches the Wistia
  adapter, which already shipped exactly this backstop and states the reasoning:
  it is a "that is never coming" bound rather than a performance budget, so a slow
  connection is never reported as a failure.

  The new deadlines are distinct from every timer that already existed and did not
  cover this. YouTube's `API_READY_TIMEOUT_MS` bounds the iframe API _script_
  initialising and its `PLAYBACK_CONFIRMATION_TIMEOUT_MS` bounds a play command;
  Vimeo's `CHROMELESS_PROBE_TIMEOUT_MS` bounds the oEmbed probe alone. Both
  packages export the new `PLAYER_READY_TIMEOUT_MS`.

  Vimeo keeps declaring `commandsReady` at player construction rather than at
  `player.ready()`. That was deliberate — the SDK queues calls it receives
  beforehand, and waiting for `ready()` was one of the two hangs that closed an
  earlier attempt — and it is not a substitute for bounding the wait.

### Patch Changes

- The Vimeo oEmbed probe now declares `referrerPolicy:
'strict-origin-when-cross-origin'` on its `fetch` (#394, part of #334).

  The library's only `fetch` carried `{ signal }` and nothing else, so the request
  travelled under whatever policy the consumer's page declared. On a page declaring
  something wider than the modern browser default, that hands `vimeo.com` the
  page's path and query in the `Referer` header — an order number, a customer id, a
  search term.

  This repo had already decided that exposure is worth an explicit override: it
  builds both embed iframes itself so a `referrerpolicy` attribute can be on the
  element before it enters the document. An init-level policy overrides the
  document's the same way, and the referrer section of
  `docs/third-party-requests.md` enumerated only the three iframes — so the probe's
  silence read as an oversight rather than a weighed acceptance.

  Not `no-referrer` and not `origin`: the origin is what Vimeo's domain-restriction
  check reads, as that section already records for the frames. This policy keeps
  the origin while dropping the path and query, which are the actual disclosure,
  and it is what both iframes already declare.

  **What this does not claim.** The tests check that the declaration is made, at the
  element and in the init. No test observes the `Referer` that results — the
  narrowing is the platform's behaviour, relied on rather than measured. The test
  reads the init `fetch` was handed rather than any reconstruction of it, and pins
  the key on its own: a sibling issue's fix was a no-op in production because its
  measurement came from a test double that had diverged from the real path, and the
  fakes shared the divergence, so the whole gate passed. The Vimeo SDK's own oEmbed
  call is unaffected and uncovered — it goes out over `XDomainRequest` or
  `XMLHttpRequest`, neither of which has a referrer-policy knob.

  `patch`: no public surface moved.

- Updated dependencies [ecfef8b]
- Updated dependencies [b5fa01a]
- Updated dependencies [5ae1450]
- Updated dependencies [727a376]
- Updated dependencies [6910f1c]
- Updated dependencies [ea664ad]
- Updated dependencies [8624a2e]
  - @playdeck/core@0.2.0

## 0.1.0

### Minor Changes

- 42ee0c5: Add `PlayerState.commandsReady` and `PlayerController.whenReady()`. Each
  provider declares for itself when a command will be accepted and will not be
  undone by a pending load, which core cannot derive — the four adapters open
  their command guards at four different moments. Commands issued before that are
  still refused with `{ ok: false, reason: 'not-ready' }`; this adds a signal to
  await rather than changing any behaviour. `whenReady()` is also on the React
  player actions and the `Player.Root` ref handle.
- 6fc0477: First Playdeck prerelease: composable React 19 media-player primitives with one
  consistent API across native MP4/WebM, HLS (VOD and ordinary live), YouTube and
  Vimeo.

  - **Core** — framework-neutral normalized state, commands, events, source
    detection, capabilities and the provider contract. Every capability reports
    `available`, `unknown`, or `unavailable` with a reason, so unsupported
    controls are absent rather than disabled-but-visible.
  - **Providers** — native `HTMLMediaElement` (including native HLS), hls.js via
    dynamic import, YouTube iframe API, and Vimeo SDK. Each translates honestly
    instead of faking parity. Provider code loads only once source detection says
    the active source needs it, so a native-only consumer ships no provider bytes
    in its initial graph and makes no provider network requests.
  - **React primitives** — `Player.Root`, `Viewport`, `Media`, `Poster`,
    activation, transport controls, settings and captions menus, gestures, and
    the `usePlayerState` / `usePlayerActions` / `useActiveCues` hooks. No CSS is
    imported by the primitives.
  - **Captions** — hybrid rendering: Playdeck draws WebVTT cues itself for
    native/HLS and Vimeo, the browser draws them on request, and YouTube's embed
    draws its own. The effective mode is always inspectable. Vimeo reports
    `captionRendering: 'custom'`: the track is enabled with `showing: false` and
    its `cuechange` payload flows through `Player.Captions` like any other source
    (#16). `setCaptionRenderer('native')` hands drawing back to Vimeo and reports
    `provider`, which is also the fallback for anything the overlay cannot
    render. Vimeo's payload carries no cue timings, so a cue reports the position
    it became active at for both bounds. YouTube reports `provider`, or
    `unavailable` when it exposes no tracks.
  - **Quality selection** — `PlayerState` enumerates the selectable rungs in
    `qualities`, each a `PlayerQuality` carrying a content-derived `id`, next to
    `selectedQualityId` for what the consumer chose (`null` meaning auto), so a
    quality menu can be built from public exports alone (#81). `quality` still
    means the level playing right now and keeps moving under adaptive selection,
    which is what lets an auto row be labelled honestly. `selectQuality` takes
    that id — `selectQuality(id: string | null)` — not a height. Two engines have
    a ladder: hls.js from the manifest, and Vimeo from the SDK's `getQualities()`
    (#82), whose rungs carry the height Vimeo names them by and nothing it does
    not report. `auto` is not published as a rung on either — it is
    `selectedQualityId: null`. Native playback (including native HLS) reports
    `unavailable` / `source` rather than an `unknown` that could never resolve.
    YouTube reports `unavailable` / `provider` because it can enumerate levels but
    cannot honour a choice: measured against the live IFrame API,
    `setPlaybackQuality` is accepted and discarded for every level the player
    itself offered, as it is when followed by a seek and when passed as
    `loadVideoById({ suggestedQuality })`. A menu there would silently do nothing,
    so none is offered. A custom `loadHls` module must expose
    `Hls.Events.LEVELS_UPDATED` —
    `HlsConstructorLike` now requires it — because hls.js prunes levels during
    its own error recovery and the published ladder has to follow.
    `HlsInstanceLike.on` is declared as a method rather than a property-typed
    function, so a real hls.js module satisfies `HlsModuleLoader`: the documented
    `loadHls: () => import('hls.js')` previously needed `as unknown as` to
    compile, including inside this package.
  - **Presentation** — fullscreen, Picture-in-Picture, AirPlay where available,
    and Media Session integration with ownership arbitration. `airPlay` means
    "there is somewhere to cast to", not "this engine has the picker API": it
    follows WebKit's `webkitplaybacktargetavailabilitychanged` and stays
    `unavailable` / `provider` until a route is announced, so
    `Player.AirPlayButton` no longer renders in Safari with no receiver on the
    network and no longer opens an empty picker (#71). The transition is live in
    both directions, and `@playdeck/provider-hls` inherits it.
  - **Activation** — a queued user play is now always issued after the
    provider's `load()` has run (fixes #86); no API change.
  - **Layout escape hatch** — geometry a primitive sets on itself is a default
    your `style` prop overrides, on `Viewport`, `Poster`, `ActivationButton`,
    `LoadingIndicator`, `ErrorDisplay` and `PosterImage` (#89). These six
    previously discarded a colliding `style` property, so a value you passed and
    saw ignored now takes effect. Properties derived from player state
    (`Poster`'s `visibility`) stay the primitive's own, and `PosterImage`'s
    explicit `objectFit` / `objectPosition` props still beat `style`.
    `LoadingIndicator` keeps its live region mounted while idle so the transition
    into buffering is announced, but that idle region is now visually hidden
    instead of a full-bleed `position: absolute; inset: 0` box at z-index 30
    (#32). The old geometry outranked every layer a consumer composed underneath
    it and left automated color-contrast checking unable to resolve a background
    for any text in the player. It becomes the top-most overlay only once there
    is a loading or buffering state to show.

  - **Declared browser support** — every package carries a `browserslist` of
    Chrome/Edge 99, Firefox 97 and Safari/iOS 15.4. That floor is set by
    `theme.css`'s `@layer`, not by the JavaScript, which needs nothing above
    Safari 14.1 — so a consumer who never imports the optional stylesheet is bound
    only by the latter. `@playdeck/react`'s `test/theme.test.ts` freezes the
    stylesheet's CSS feature inventory, so a newer feature fails the build instead
    of silently moving the number.

  - **Caption renderer, imperatively** — `setCaptionRenderer('custom' | 'native')`
    is on `usePlayerActions()` and on the `Player.Root` ref handle, next to the
    `captionRenderer` prop. It was reachable but undeclared: the ref hands back
    the controller, so the method was there whether or not the type admitted it.
    Flipping the renderer without re-rendering `Root` is what it is for.

  - **Media Session** — `getMediaSessionCoordinator(session)` is the way to get a
    coordinator. `createMediaSessionCoordinator` is no longer exported: a second
    coordinator over the same `MediaSession` hands out roots that cannot see each
    other's ownership, which is what the one-per-document rule exists to prevent.
    `MediaSessionLike` names the five actions the coordinator registers rather
    than taking `action: string`, so a real `navigator.mediaSession` satisfies it
    and `getMediaSessionCoordinator(navigator.mediaSession)` typechecks without a
    cast. A fake still only has to implement those five.

  - **Subscriber isolation** — one listener throwing no longer abandons the
    notification it was part of. `subscribe`, `subscribeCues` and `on` each
    iterated their listeners with a bare loop, so a throwing listener starved
    every listener registered after it for that emit; a control that subscribed
    late then rendered exactly one transition stale until the next unrelated
    emit (#95). Listener errors are now isolated and rethrown on a fresh task, so
    they still reach uncaught-error handling instead of being swallowed. The
    throw that surfaced this was Playdeck's own: Media Session position reporting
    passed `currentTime` straight through, and WebKit settles it a fraction past
    `duration` at the end of a clip, which the Media Session spec makes a
    `TypeError`. Position is now clamped to the media's own bounds.

  The `DefaultPlayer` preset is not in this release; it is deferred (see issue
  \#1). This prerelease ships the headless primitives only.

- e5a77a3: `Player.Viewport` now reports the media's own aspect ratio as
  `--playdeck-media-aspect-ratio` on the `viewport` part, so you can size a player to
  its content — vertical video, a Short, anything not 16:9 — without knowing the
  shape in advance (#174). Opt in with one rule:

  ```css
  [data-playdeck-part='viewport'] {
    aspect-ratio: var(--playdeck-media-aspect-ratio, 16 / 9);
  }
  ```

  Nothing renders differently until you write it. The library reports the ratio
  and never applies it, and no primitive reads it back: this is an output like
  `data-state` rather than a theme token, so `theme.css` neither declares it nor
  consumes it and the documented token table is unchanged.

  Native and HLS — both engines, since the picture is drawn into the same
  `<video>` — measure `videoWidth`/`videoHeight` at `loadedmetadata` and again on
  `resize`, so an adaptive switch to a differently shaped rendition republishes.
  Vimeo reports what the SDK gives it, once the embed is ready and again on the
  SDK's `resize`. YouTube never reports it: the IFrame API exposes no intrinsic
  size, so the property stays absent there and your `var()` fallback is what
  shapes those players. Wherever a ratio is unknown the property is removed rather
  than zeroed — before metadata arrives, on audio-only or errored media, on every
  source change, and while a Vimeo `retry()` rebuilds its embed — so a stale ratio
  never outlives the source it described, which would keep your fallback from
  applying.

  The value is written straight to the DOM and is deliberately not in
  `PlayerState`, so a ratio arriving mid-load re-renders nothing.

  If you have written your own provider adapter, `ProviderAdapter` gains an
  optional `subscribeDimensions`; omitting it means that adapter reports no ratio,
  which is what YouTube's does. `@playdeck/core` also exports a `MediaDimensions`
  type and adds `PlayerController.subscribeDimensions`. If you supply your own
  Vimeo SDK module, note that `VimeoSdkPlayer` now requires `getVideoWidth()` and
  `getVideoHeight()` — the real SDK has both, but a hand-written stub will need
  them.

- b4e25c7: Player state now carries chapters (#182). `@playdeck/core` exports a new `Chapter`
  type — `id`, `title`, `startTime` and a nullable `endTime` — and `PlayerState`
  gains a `chapters` collection, ordered by ascending `startTime` and frozen on
  publish the way the text-track collection already is. `PlayerCapabilities` gains
  a matching `chapters` facet, so a provider that cannot report chapters says so
  rather than going quiet: an empty collection means "no chapters here", and the
  capability is what says whether that is the provider's limit or the source's
  content.

  Playdeck publishes the vocabulary and does not draw it. There are no chapter
  markers, no chapter labels, no new primitive and no new part name, and the seek
  slider is untouched. It already takes children and exposes its range through the
  underlying input's `min` and `max`, so a consumer maps a pointer position to a
  time and renders whatever they want at that offset.

  **`endTime` is the library's own derivation, not a provider's report.** No
  provider reports chapter end times: Vimeo publishes a start and a title, and a
  WebVTT chapter cue's own end is not guaranteed to abut the next cue. Each
  chapter therefore ends where the next one begins, and the last chapter takes the
  media duration — or `null` when the duration is unknown or not finite, which is
  why the field is nullable. `Infinity` is never substituted, and the last chapter
  is never dropped.

  Which providers populate the collection was established per adapter:

  - **Native** reads a `kind="chapters"` text track off the media element. The
    track's mode is moved to `hidden`, because a text track's cues are not
    obtained at all while its mode is `disabled` — the default for any track
    without the `default` attribute — and `hidden` populates them without asking
    the browser to draw anything. The cues are read on the track's `cuechange` and
    on the `<track>` element's `load`, not synchronously after the mode is
    assigned: at that moment the fetch the assignment started has not finished.
  - **HLS** adds nothing of its own. It carries no chapters concept, and its
    `EXT-X-DATERANGE` support routes into the metadata track, so both engines
    share the native path over the media element's own track list.
  - **Vimeo** populates from the SDK's chapter list, read once the player is
    ready. Its `chapterchange` event keeps the collection current; nothing polls.
  - **YouTube** reports empty with `{ status: 'unavailable', reason: 'provider' }`.
    The IFrame Player API documents no chapter method and no chapter event, and
    the Data API's video resource has no chapter property. This is a published
    fact, not an error: no command rejects over it.
  - **Wistia** reports empty the same way. Its chapters ship as an inbound
    embed-option plugin — the embedder supplies the list — and no documented
    read-back accessor exists.

  **`TextTrackKind` is unchanged, and still admits only `'subtitles'` and
  `'captions'`.** Chapters get their own collection rather than joining the
  text-track one. Nothing downstream of that collection filters on kind, so a
  chapters track allowed into it would appear in the captions menu, become what
  the captions toggle switches to, make a captions menu render for a video with no
  captions, and render its chapter titles as caption cues.

- f1e678a: `Player.Root`'s `loop` prop now loops a YouTube, Vimeo or Wistia source. It
  used to travel only inside `NativePlaybackOptions`, which `loadProvider` hands
  to the native and HLS providers and to no others, so `<Player.Root loop />` was
  a silent no-op on the three embed providers (SIDEPRO-210).

  `loop` now takes the same route `controls` already took: `Root` folds it into
  the bag belonging to the detected source's own provider, and each provider
  answers it — YouTube by the `loop` player var together with a `playlist` naming
  the video itself (`loop` alone is a documented no-op on a single-video embed),
  Vimeo by the `loop` embed parameter, Wistia by the `endVideoBehavior` it
  already implemented. Native and HLS are unchanged.

  **Breaking for anyone writing `providerOptions={{ wistia: { loop } }}`.** That
  was the only spelling that worked before, and it is now omitted from
  `PlayerProviderOptions` so the setting has one home (ADR-0004). Write
  `<Player.Root loop />` instead. `WistiaProviderOptions.loop` itself stays, for
  callers building the adapter with `createWistiaProvider` directly.

  No new re-attach cost comes with this. `loop` already took part in the
  activation identity on every source type, so changing it mid-playback already
  rebuilt the provider. Before this change the rebuild produced an identical
  embed, the value having reached nothing; now it produces a looping one.

- 663d9b5: `Player.Root`'s `startTime` and `endTime` props now bound a YouTube, Vimeo or
  Wistia source. They used to travel only inside `NativePlaybackOptions`, which
  `loadProvider` hands to the native and HLS providers and to no others, so
  `<Player.Root startTime={30} />` on an embed began at zero and ran to the end of
  the media (#214).

  Both now take the route `loop` took in SIDEPRO-210: `Root` folds them into the
  bag belonging to the detected source's own provider, and each of the three
  embeds enforces the boundary itself. Playback starts at the start boundary,
  reaching the end boundary publishes `ended` there rather than at the media's
  end, the pause that produces is not reported as a pause, and `loop` restarts
  from the start boundary instead of from zero. The embeds' own start expressions
  — YouTube's `start` player var, Vimeo's `#t=` fragment, Wistia's `current-time`
  attribute — are written as load hints so there is no visible seek after load,
  but the adapter is the authority either way. No provider's native end mechanism
  is trusted.

  The sanitisation rules are the native provider's, unchanged and now identical on
  all five: a start that is absent, non-positive or non-finite is no start; an end
  that is absent, non-finite, or not above the start is no end; an end past the
  duration is clamped to it. `@playdeck/core` gains one export that states them:
  `createTimeBoundary(options)` resolves the window once and returns a
  `TimeBoundary` carrying every question the ports ask of it — `start`, `end`,
  `atEnd`, `atWrap`, `restartsAtStart` and `clamp`, alongside the sanitised
  `startTime` and `endTime` the embeds write as load hints.

  One pre-existing YouTube behaviour changes with it: `seekTo` and `seekBy` now
  clamp to the window's effective end — the `endTime`, or the duration when there
  is no `endTime` or the media is shorter — instead of only flooring at zero. A
  seek past the end of the media used to be forwarded to the player and published
  as a `currentTime` past the media's end, which the next poll then contradicted.
  Vimeo, Wistia and the native provider have always clamped this way.

  `PlayerProviderOptions` omits `startTime` and `endTime` from all three bags, so
  the setting has one home (ADR-0004). Nothing that compiled before stops
  compiling: no embed bag declared either key until now.

  No new re-attach cost comes with this. Both values already took part in the
  activation identity on every source type, so changing either mid-playback
  already rebuilt the provider. Before this change the rebuild produced an
  unbounded embed, the values having reached nothing; now it produces a bounded
  one. Native and HLS are unchanged.

- 5380f1e: Each provider factory now validates the id it is handed before it does
  anything else with it, rather than trusting it as far as the vendor (#222).
  `createWistiaProvider`, `createYouTubeProvider` and `createVimeoProvider` are
  each package's own published entry point, and `Player.Root` is only one
  caller of it. `detectSource`'s validation protected every source routed
  through `Root`, but a consumer calling a factory directly bypassed it
  entirely. A media id, video id or privacy hash that would never have survived
  `detectSource` — a script-injection payload, a path-traversal segment, a
  query string appended to an id — reached the factory unchecked and was
  carried straight into a DOM attribute, an iframe src, or an SDK call.

  The fix is the same shape in all three packages: the id (and, for Vimeo, the
  hash, when one is present) is checked with a predicate now exported from
  `@playdeck/core` — `isWistiaMediaId`, `isYouTubeVideoId`, `isVimeoVideoId`,
  `isVimeoHash` — before the factory builds anything. A value that fails is
  never carried to the vendor at all; the factory returns a rejected adapter
  instead, whose every method is a no-op and whose state immediately reports a
  `category: 'source', fatal: true, recoverable: true` error to every
  subscriber, present or late-arriving. `attach`, `load` and `retry` do nothing,
  `destroy` is idempotent, and every command resolves `{ ok: false, reason:
'not-ready' }` rather than hanging or throwing.

  **What a consumer sees.** A valid id: byte-identical behaviour, unaffected by
  the added check. An invalid id passed directly to a factory: previously an
  unguarded pass-through to the vendor — a request, a DOM write, an SDK call,
  whatever consulting the vendor with that value would do; now a same-shaped
  `source` error, delivered synchronously through the normal state-subscription
  path, with no vendor ever contacted. A consumer going through `Player.Root`
  sees no change: `detectSource` already turned away the same ids before a
  factory was ever called.

  Also, defence in depth beyond the new checks: the Vimeo embed URL is now
  built with `url.pathname` and `encodeURIComponent(source.videoId)` rather
  than interpolating the id into the URL string directly, so a rejected id that
  somehow still reached the builder could not break out of the path segment it
  is written into.

  Both land as `minor`: every package is still at `0.0.0` with
  `first-prerelease` unreleased, and under 0.x `minor` is the channel any
  change — including this purely additive one — travels on.

- 3ab602b: The Vimeo embed iframe now declares `referrerpolicy="strict-origin-when-cross-origin"`,
  so the embedding page's path and query no longer reach Vimeo with the iframe
  request — only its origin does, which is what Vimeo's domain-restriction check
  needs, so a private or domain-locked source still loads. This half is a
  narrowing of what the existing embed sends, nothing more.

  The `allow` list also drops `encrypted-media`. `autoplay`, `fullscreen` and
  `picture-in-picture` are unchanged and keep working exactly as before, but this
  half is a capability withdrawal, not a narrowing: a Vimeo source that needs EME
  (Widevine/FairPlay) for DRM-protected playback — an Enterprise/OTT video —
  relied on that grant to call `requestMediaKeySystemAccess` from inside the
  iframe, and will stop playing after this change where it played before. Nothing
  in Playdeck's own option surface ever turned that grant on or off; it is the video
  ID a consumer passes, not a Playdeck option, that decides whether a source needs
  it. There is no flag to opt back in today — DRM support is out of scope for
  this change.

  Both land as `minor`: every package is still at `0.0.0` with
  `first-prerelease` not yet released, and under 0.x `minor` is the channel a
  breaking change travels on.

### Patch Changes

- 7889ef8: `PlayerState.live` is now published by every provider that can tell whether its
  media is live, rather than by the HLS adapter alone. A native `<video>` playing
  an endless stream and a Wistia live broadcast both left `live` as `null`, so a
  control could not say "live" unless the source happened to be HLS (#187).

  `@playdeck/core` gains the derivation those adapters share. `deriveLiveState(input)`
  turns a duration, a seekable window, a playhead and the provider's own live flag
  where it has one into `{ isLive, atLiveEdge }`, or `null` when the media is not
  live. `liveStateEqual(a, b)` answers whether two of those say the same thing,
  which is what an adapter checks before publishing a change. `LiveDerivationInput`
  is the input type. Liveness is read from provider signals only — a source URL, an
  id or a filename never decides it.

  The at-edge tolerance is one number, held inside `@playdeck/core` and deliberately
  not exported. `LiveDerivationInput.atEdgeThreshold` relaxes from required to
  optional, and omitting it is how a caller takes the shared value; pass one only
  to answer a different question than the players ask. Nothing that compiled
  before stops compiling.

  Per provider:

  - **Native** derives `live` from the element's own signals — an endless
    `duration` and the moving `seekable` window, measured against the playhead. A
    file with a finite duration still reports `null`.
  - **HLS** reports what it always did. The derivation moved to `@playdeck/core` and
    is re-exported here, so a custom HLS adapter still imports `deriveLiveState`
    from `@playdeck/provider-hls`. This adapter stays the authority on both engines,
    because it adds hls.js's live flag and `liveSyncPosition`, which the native
    answer underneath it does not carry.
  - **Wistia** reports `live` from `MediaData.mediaType` on the
    `loaded-media-data` event and from nothing else. Wistia publishes no seekable
    window, so the at-edge flag measures the playhead against the duration the
    player reports, and it stays current while paused as well as while playing.
  - **YouTube and Vimeo** report no `live` at all: the key is absent from every
    patch rather than present holding `null`. Neither SDK publishes a liveness
    signal, and on both, a duration describes a live broadcast and a video on
    demand identically. Each README now says so, so the gap reads as a decision
    and not an oversight.

  `null` still means "not live, or not yet known" — never "this is on demand". A
  control should render neither claim until one arrives. Every provider publishes
  `live` only when the value changes; an unchanged value produces no patch.

- 07e47c3: Every provider fan-out now isolates a throwing subscriber, and `@playdeck/core`
  exports the helper that does it (#233).

  An adapter's `subscribe` accepts any number of subscribers and promises each of
  them every notification, but each provider published with a bare `Set.forEach`.
  That loop stops at the first throw, so one broken listener took two things with
  it. Every listener registered _behind_ the thrower silently missed that
  notification and resynced only on the next unrelated one — a control that
  subscribed late rendered exactly one transition stale, which is the defect #95
  measured at the controller. And the throw escaped back into whatever called the
  emit: a vendor SDK's own event dispatch, or the adapter's start path, where the
  load-error mapping reported a consumer's rendering bug to the viewer as "The
  Vimeo player could not load". A subscriber defect was misattributed to the
  provider.

  The controller had the answer already — `notifySafely`, added for #95 — but it
  was private to `@playdeck/core` and applied only at the controller's own four
  fan-outs. Through `Player.Root` the controller is the single subscriber to each
  adapter, so the composed path was bounded by subscriber count rather than by
  design; a consumer subscribing to an adapter directly, which the public
  `subscribe` surface invites, had no such protection.

  Each provider's state, dimension and text-track cue fan-outs now route through
  that helper. A listener that throws no longer stops the ones behind it, and the
  emitting call completes: the state transition lands, the SDK's dispatch loop
  runs on, and the start path reaches `ready` instead of reporting a load failure.
  The error is isolated rather than silenced — it is still rethrown on a fresh
  task, so it reaches the page's uncaught-error handling the way a listener
  throwing at top level would. Swallowing it outright is what would have hidden
  the media-session defect that found this bug in the first place.

  Nothing about `subscribe`/unsubscribe, listener signatures, or the patches and
  events an adapter publishes changes. A listener that does not throw sees exactly
  what it saw before.

  `minor` for `@playdeck/core`: `notifySafely` joins the public entry, because a
  provider package cannot reach a private helper and copying the implementation
  into five packages is how five copies drift. It also takes its arguments
  variadically now, so a `(patch, event)` state listener is called through it
  without a wrapper; the controller's own call sites are unchanged in behaviour.
  `patch` for the five providers: no export surface moves and no published value
  changes — only what happens when a consumer's own listener throws.

- 79abea3: The Vimeo chromeless-availability probe is now cancellable, and every path that
  ends or supersedes an attachment cancels it (#232).

  The probe asks Vimeo's public oEmbed record which account tier is behind the
  video, because that is the only place the tier is reported — the player SDK
  publishes it nowhere. It issued a bare `fetch` with no init object, so it had no
  `signal` and nothing held a handle on the request. The 4 second deadline
  (`CHROMELESS_PROBE_TIMEOUT_MS`, unchanged) resolved a provisional verdict
  _beside_ the request rather than stopping it, and the attachment's start
  generation decided which verdict was adopted, not which request kept running. So
  `destroy()` cleared the listeners and left the request in flight, and each
  `retry()` added a fresh one. Unmounting a React tree is the one action a
  consumer has to stop a component talking to a third party, and on this path it
  did not work: a player scrolled past, unmounted or retried went on disclosing the
  viewer to `vimeo.com` after the consumer's component was gone.

  Each probe now runs under its own `AbortController`. The seam gains a `cancel`
  alongside its `probe` and `adopt`, and the attachment calls it from its own
  teardown — the one thing `destroy` and `retry` both already run, and which a
  failed attach runs too. So the request is discarded with the player it was
  informing, in `retry`'s case before the replacement request is issued, and a
  teardown path added later cancels without having to remember to. The seam also
  abandons a request of its own accord if a second probe starts while one is
  running, so "one request at a time" holds in the seam rather than in its
  caller's ordering. The deadline aborts too, rather than only resolving beside
  the request.

  What the caller receives is unchanged in every case. An abandoned probe — timed
  out, destroyed, or superseded — resolves the same provisional `unknown` /
  `provider-check` verdict it resolved before, and resolves it rather than
  rejecting: an abort makes the request reject, and that lands on the fallback the
  way an offline network or a refused response already did, so no rejection reaches
  the page. A superseded probe still never records a verdict. A live probe still
  resolves and adopts the tier-derived one.

  The opt-in that governs whether a request happens at all is untouched: without
  `customControls: true`, or with the provider's own `controls` asked for, there is
  no request and the verdict resolves from a constant, so no viewer is disclosed to
  Vimeo before anyone has asked for the capability. This change is about when a
  request _stops_, which nothing governed before.

  `patch`: no export surface moves — `VimeoChromelessAvailability` is an internal
  seam type, not part of the package's public entry — and a consumer calling
  `createVimeoProvider`, or reaching it through `Player.Root`, sees the same
  capability values it saw before. Only the request's lifetime changes.

- 9359e21: `VimeoProviderOptions` gains `suppressSeoMetadata`, an opt-in switch that stops
  the Vimeo SDK sending the embedding page's full URL — path and query included —
  to the embed frame.

  `@vimeo/player` installs a `window` `message` listener at module scope. When a
  frame whose src matches its embed pattern completes the readiness handshake, the
  listener answers it with `appendVideoMetadata` carrying `window.location.href`.
  The url Playdeck builds matches that pattern, so Playdeck's own embed is the frame it
  resolves. The `referrerpolicy="strict-origin-when-cross-origin"` set on that
  iframe does not prevent this — that narrows the iframe's own request header, and
  this is a message sent afterwards — and neither does `dnt=1`. So any app
  carrying an identifier, a search term or a session-adjacent value in a path
  segment or query string was sending it to the embed on every Vimeo attach, with
  default options. Reproduced in a real browser by `e2e/vimeo-seo-metadata.spec.ts`
  rather than read off the bundle.

  With `suppressSeoMetadata: true`, Playdeck sets the SDK's own guard global before
  the dynamic import, so the listener is never installed. Reachable from
  `Player.Root` as `providerOptions={{ vimeo: { suppressSeoMetadata: true } }}`.
  Two consequences it is opt-in because of, both documented in
  `packages/provider-vimeo/README.md` and `docs/third-party-requests.md`:

  - **The suppression is page-wide, not per-embed.** The SDK's guard is a `window`
    global, so it silences the handshake for every Vimeo embed on the page,
    including embeds Playdeck did not create. That blast radius is the consumer's to
    accept, not the library's to decide.
  - **It takes effect on the first Vimeo attach, for the life of the page.** The
    SDK module is imported once and cached, and reads the guard while it
    evaluates, so a later attach cannot retroactively suppress anything. This is
    the vendor's design; nothing here re-imports or resets the cached module to
    pretend otherwise.

  A page that has already set that global keeps its own value, in either
  direction — Playdeck writes it only when it is not already set, and never writes it
  at all with the option off or absent.

  **Nothing changes by default.** With the option absent or `false`, Playdeck writes
  nothing to the global and the handshake happens exactly as it did before. So
  both packages land as `patch`: an added optional option that defaults to off
  breaks nothing, and `@playdeck/react` moves only because
  `PlayerProviderOptions.vimeo` now carries the key.

  **A documentation correction rides along.** `packages/provider-vimeo/README.md`
  and `docs/third-party-requests.md` both still said Vimeo has no
  `PlayerProviderOptions` key and that `customControls` cannot be reached from
  `Player.Root`. That stopped being true when the `vimeo` bag landed in #170, and
  `provider-loaders.ts` has forwarded it since. Both documents now say so. No
  behaviour changed with them — if you read either page and concluded the oEmbed
  probe could never fire through the React path, re-read the `customControls`
  note.

- Updated dependencies [42ee0c5]
- Updated dependencies [742b52d]
- Updated dependencies [5d0af45]
- Updated dependencies [6fc0477]
- Updated dependencies [7889ef8]
- Updated dependencies [e5a77a3]
- Updated dependencies [0303a63]
- Updated dependencies [b4e25c7]
- Updated dependencies [07e47c3]
- Updated dependencies [663d9b5]
- Updated dependencies [339b3a1]
- Updated dependencies [c5b9891]
- Updated dependencies [5380f1e]
- Updated dependencies [c9c1f15]
- Updated dependencies [ca1a544]
  - @playdeck/core@0.1.0
