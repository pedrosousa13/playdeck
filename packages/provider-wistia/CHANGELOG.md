# @playdeck/provider-wistia

## 0.1.0

### Minor Changes

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

- c5b9891: `isPermittedSourceUrl` now refuses a URL carrying a C0 control (U+0000 to
  U+001F) or a space at either end, which closes a bypass of the scheme allowlist
  itself (#326). The allowlist rejected a tab, line feed or carriage return
  anywhere and then read the scheme with a start-anchored match — but the URL
  parser's pre-processing is wider than those three characters: it also strips
  leading and trailing C0 controls and spaces. One leading space was enough to
  make the anchored read find no scheme at all, and a URL with no scheme is
  permitted for every source type. `' javascript:alert(1)'`,
  `' data:text/html,…'` and, for an `hls` source, `' blob:https://…'` all came
  back permitted, while the browser stripped the same byte and resolved exactly
  the scheme that was never checked. Their unprefixed forms were rejected then
  and are rejected now.

  The correction widens the rule that already covered the three interior
  characters rather than adding a second kind of rule: the whole set the parser
  pre-processes is rejected outright rather than stripped, which keeps the value
  that plays identical to the value that was validated (#219). Nothing is trimmed
  and nothing is rewritten. No URL that was permitted before is refused now — the
  guard stops at U+0020, the last character the parser strips, and U+0021 is
  outside it. `resolveNetworkPath` needs no trimming of its own as a result:
  `' //host/a'` is refused before any caller reaches the substitution, so a
  protocol-relative URL can no longer skip the `https:` normalisation (#219)
  behind a leading space and be resolved against the page's own scheme instead.

  **What a consumer sees.** Every boundary that runs the shared allowlist gets
  this, since none of them restate it. Through `detectSource`'s explicit-object
  path,
  `{ type: 'video', sources: [{ src: ' javascript:alert(1)', … }] }` and
  `{ type: 'hls', src: ' blob:https://…' }` no longer detect, and fail with the
  existing `invalid-source` reason. MediaSession artwork with such an edge is
  omitted. In `@playdeck/react`, a `Player.Poster` `src` or `srcSet` candidate, a
  `nativePoster` or a text-track `src` carrying one is dropped rather than
  rendered; `@playdeck/provider-wistia` emits its poster configuration notice
  instead of writing the value onto `<wistia-player>`.

  `@playdeck/core`'s README stated that everything outside the allowlist "is
  rejected, whether it arrives as a string or inside an explicit source object".
  That was false as executed for as long as the bypass stood. It is true now, and
  the sentence after it describes the whole set the parser strips rather than the
  three characters alone.

  `minor` for the same reason `one-scheme-allowlist-for-source-urls` is, which is
  the changeset this one corrects: every package is still at `0.0.0` with
  `first-prerelease` unreleased, and under 0.x `minor` is the channel a breaking
  change travels on. A URL that was accepted can now be refused — though a source
  URL with a space or a control character at an edge has no reading the browser
  and the allowlist ever agreed on, so what breaks is a value that was never
  carried faithfully in the first place.

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

- a8392b4: The Wistia provider no longer depends on `@wistia/wistia-player`. It fetches
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

- c9c1f15: The Wistia provider's `poster` option now runs through the one shared URL
  scheme allowlist (`isPermittedSourceUrl`, introduced for source detection)
  instead of a stricter, provider-local `https:`-only check. `http:`,
  protocol-relative and relative poster values are now accepted where they
  were silently dropped before; `javascript:`, `data:`, `file:` and `blob:`
  stay rejected, and a rejected poster still sets no attribute rather than
  raising or warning — that part of the behaviour is unchanged. A
  protocol-relative poster (`//host/...`) is normalised to `https:` in the
  value actually written, the same substitution source detection already
  performs (#219).

  **What a consumer sees.** A poster URL that previously had to be an
  `https://`-prefixed absolute URL can now be `http:`, `//host/path`, or a
  relative path, matching every other URL-bearing surface in the library. A
  poster that was accepted before (a well-formed `https:` URL) is written
  identically, byte for byte.

  Also exports `resolveNetworkPath` from `@playdeck/core` — the protocol-relative
  normaliser the poster fix consumes, previously private to source detection.

  Lands as `minor`: every package is still at `0.0.0` with `first-prerelease`
  unreleased, and under 0.x `minor` is the channel a breaking change travels
  on. It is breaking in one direction — a poster the old check dropped may now
  be accepted and written to the DOM.

- ca1a544: Add Wistia as a fifth provider. `detectSource` recognises Wistia URLs and
  `@playdeck/core` exports `WistiaSource`; `@playdeck/react`'s `loadProvider` lazily
  imports `@playdeck/provider-wistia` the same way it does Vimeo, so a consumer who
  never plays a Wistia source ships none of its code. `Media` mounts a `<div>`
  for the `<wistia-player>` custom element the provider appends into it, the
  same treatment YouTube and Vimeo get.

### Patch Changes

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

- 0239855: The Wistia provider now checks `playerColor` and `poster` where it turns an
  option into an attribute, rather than writing either verbatim onto
  `<wistia-player>`. A `playerColor` is kept only if it is a hex colour (three,
  four, six or eight digits, hash optional) and a `poster` only if it begins
  `https://` and parses as an `https:` URL; `http:`, `data:`, relative and
  unparseable values are dropped. A dropped value
  sets no attribute, which is the same element state as omitting the option, and
  the drop is silent — one bad presentation option must not fail playback. The
  option types are unchanged: both stay optional `string`, so a computed value
  still compiles.
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
