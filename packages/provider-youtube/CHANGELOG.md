# @playdeck/provider-youtube

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

- 5002981: The YouTube iframe API load now settles within a bounded time in every case,
  and can be started again after it fails (#220).

  The loader settled its promise on exactly two events: the injected script's
  `error` listener, and `window.onYouTubeIframeAPIReady` firing. Neither covers a
  response that arrives 200 OK but is not the API — a captive portal, an
  inspecting proxy, a region block serving HTML, a truncated body. The browser
  fires `load` for all of those, not `error`, so the ready callback never ran and
  the promise never settled. The memo holding it is module-global and was cleared
  only on the `error` path, so `retry()` awaited the same permanently pending
  promise: one bad response stranded every YouTube player on the page for the
  document's lifetime. Adopting a `script[src]` another consumer had already
  injected reached the same state by a second route — an element that has already
  failed will fire no further `error`.

  Every attempt is now under a `API_READY_TIMEOUT_MS` deadline, exported and
  holding 15 seconds — the same number as the Wistia provider's ready timeout, and
  the same kind of backstop rather than a performance budget. An attempt that
  expires rejects with a message naming a script that loaded without
  initializing, clears the memo, and puts back whatever `onYouTubeIframeAPIReady`
  was on the window before it, so a late API cannot settle a discarded attempt.
  An adopted script element is put under the same deadline as one the loader
  creates. The next call — a fresh `loadYouTubeIframeApi()`, or the adapter's
  `retry` command — then starts a genuinely new attempt and can succeed if the
  network has recovered.

  A script element the loader did not create is still left in the document when
  its deadline expires, unchanged from how the `error` path already behaved: the
  loader does not remove a DOM node it did not add. It is now also left alone when
  the attempt that created it has already been superseded — by a reset, or by a
  failure before it — because a later attempt may have adopted that same element
  and be waiting on it. Either way the next attempt adopts it again under its own
  deadline, so the outcome is a bounded rejection rather than a hang.

  `resetYouTubeIframeApiLoader` is exported alongside, discarding the memo the way
  `resetWistiaPlayerLoader` and `resetVimeoSdkLoader` already do for their
  loaders — for tests that need a clean load, not for app code.

  `minor`, because the package gains public module exports. Under 0.x this repo
  sends a package that grows its export surface on `minor` — `@playdeck/core` took
  `minor` for gaining `deriveLiveState` while the providers that merely consumed
  it took `patch` — and `API_READY_TIMEOUT_MS` and `resetYouTubeIframeApiLoader`
  are two such exports. The behaviour change rides along and is not itself
  breaking: it turns a hang into a rejection, and a caller that already handles
  the existing `error`-path rejection handles this one too.

- e3d02c3: The YouTube provider now builds the embed iframe itself and hands the finished
  element to the iframe API, instead of appending a `<div>` for the API to
  replace with an iframe of its own. The API's documented alternative path adopts
  a frame that already exists, so the attributes on that frame — the
  `referrerpolicy="strict-origin-when-cross-origin"` this change is for among
  them — are set here, before the element enters the document. That ordering is
  the whole point: the `Referer` header leaves with the frame's first request, and
  an attribute written after the frame has loaded changes nothing about a request
  already sent. The Vimeo embed has declared the same policy since SIDEPRO-220;
  this brings the second embed provider onto it (#221).

  **What this does not do, stated plainly.** It does not narrow the `Referer`
  header, because that header was already narrow. `www-widgetapi.js` — the script
  `iframe_api` loads, read at player build `b0d2d49a` and confirmed against a real
  player in a browser — sets `referrerPolicy="strict-origin-when-cross-origin"` on
  the iframe it builds, alongside `frameBorder`, `allowfullscreen`, `allow` and
  `title`. So a Playdeck YouTube embed was already sending only the page's origin in
  that header. What changes is who guarantees it: Google serves that script
  unversioned and mutable, so the guarantee was theirs to withdraw on their
  schedule, and it is now this repo's to keep.

  **What it does narrow is the embed url.** When the API composes that url it
  appends `forigin=<the embedding page's full URL>`, plus `aoriginsup`, plus
  `gporigin` and `widget_referrer` where a referrer exists. The page's path and
  query therefore reached YouTube in the query string whatever the referrer policy
  said — a `referrerpolicy` was never going to stop that, which is the part the
  issue behind this change had not established. Playdeck's own url carries the video,
  `enablejsapi=1` and the player vars this adapter has always set, and none of
  those parameters. That is a real narrowing and also a behavioural change on
  Google's side of the frame that nothing here can test: whatever those parameters
  are for, this embed no longer reports them.

  Everything else about the embed is preserved deliberately rather than by
  accident. The `host` allowlist is untouched and now decides the origin of the
  url the iframe carries, falling back to `https://www.youtube-nocookie.com` for
  anything unrecognised exactly as before. Every player var still travels —
  `autoplay`, `controls`, the `loop`-plus-`playlist` pairing, `start`,
  `playsinline`, `rel` and the declared embedding `origin` — as query parameters
  rather than as constructor options, because the API reads neither `videoId` nor
  `playerVars` when the element it is given is already an iframe. The `allow` list
  is the API's own, restated verbatim: `accelerometer`, `autoplay`,
  `clipboard-write`, `encrypted-media`, `gyroscope`, `picture-in-picture` and
  `web-share`, so this frame is granted neither more nor less than the API's was.
  Narrowing it is a separate decision with its own capability consequences and is
  not folded in here. `allowfullscreen`, the `title`, and the `100%` width and
  height are the API's too; `frameBorder="0"` becomes an inline `border: 0`, which
  is how the Vimeo embed spells the same thing.

  `YouTubeProviderOptions` is unchanged — this introduces no option, and the
  referrer policy is not consumer-configurable, exactly as it is not for Vimeo.
  One exported type changes, and only a caller who injects their own
  `loadIframeApi` can notice: **`YouTubePlayerConstructor` takes an
  `HTMLIFrameElement`** rather than an `HTMLElement`, because that is what the
  adapter now hands it. Constructor parameters are checked contravariantly, so an
  injected fake typed against the wider element type still satisfies it.

  `YouTubePlayerOptions` keeps every field it declared. The adapter now sets only
  `events` — `host`, `videoId`, `width`, `height` and `playerVars` are read by the
  API on the `<div>` path and ignored on this one — but they remain optional
  members of a public type, so an existing fake that names them still compiles. A
  fake that used them to build its own iframe should read the `src` of the iframe
  it is handed instead, which is where the whole embed is described now.

  `minor` rather than `patch`: every package is still at `0.0.0`, and under 0.x
  this repo sends breaking changes on `minor`.

  This is verified against a real player, not only against a stand-in —
  `e2e/youtube-real.spec.ts` now asserts the attribute on the attached frame, and
  that spec is the manually-run `PLAYDECK_REAL_PROVIDERS=1` suite rather than a CI
  one. Wistia gets no code change and can get none: its frame is written into a
  vendor element's shadow root, so the only remedy there is a page-level
  `Referrer-Policy` response header on the embedding page, which is the consuming
  application's call. `docs/third-party-requests.md` now carries the referrer
  account for all three embed providers, that remedy included.

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

- 0107bf6: The YouTube provider now checks `host` where it resolves the option, rather
  than handing any string to the iframe API as the origin the embed is built
  from. A `host` is kept only if its parsed origin is `https://www.youtube.com`
  or `https://www.youtube-nocookie.com`; a trailing slash or upper-case spelling
  of either resolves to the same origin and is accepted. Any other origin — and
  a malformed or empty value, which does not parse — falls back to the
  privacy-enhanced `https://www.youtube-nocookie.com` default rather than
  throwing, so a misconfigured host degrades to the safe embed instead of
  breaking the page. This matters beyond the iframe's own location: the embedding
  page's origin is declared to the player for `postMessage` validation, and a
  host outside YouTube would have received it. The option type is unchanged: it
  stays an optional `string`, so a computed value still compiles.
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
