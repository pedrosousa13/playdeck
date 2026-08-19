# @playdeck/core

## 0.1.0

### Minor Changes

- 42ee0c5: Add `PlayerState.commandsReady` and `PlayerController.whenReady()`. Each
  provider declares for itself when a command will be accepted and will not be
  undone by a pending load, which core cannot derive — the four adapters open
  their command guards at four different moments. Commands issued before that are
  still refused with `{ ok: false, reason: 'not-ready' }`; this adds a signal to
  await rather than changing any behaviour. `whenReady()` is also on the React
  player actions and the `Player.Root` ref handle.
- 742b52d: `AutoplayMode` gains a fourth member, `'audible-then-muted'`, and `PlayerState`
  gains `autoplayRecovered` (#306). In the new mode the player attempts audible
  playback first; if and only if that attempt is refused by policy — the
  `reason: 'blocked'` an adapter reports for a browser that would not start
  unmuted playback — it mutes and attempts once more. Any other failure is
  reported as it is, unretried: a decode error or a provider fault fails for a
  reason muting does not address.

  `autoplay` still reads `'started'` after a recovery, because playback did start
  and nothing switching on that value should have to change. `autoplayRecovered`
  is what tells the two apart: it is `true` only where the audible attempt was
  refused and the muted retry is what played, so a consumer can offer an unmute
  affordance. It is `false` everywhere else — a deliberate `'muted'` autoplay, an
  audible attempt accepted first time, a failed recovery, and an in-flight retry
  too, since the recovery is recorded at the moment playback starts and not when
  the retry is issued. The poster therefore stays over the frame for the whole
  recovery and uncovers only if it succeeds.

  Exactly one retry ever fires, and only inside this mode. The retry is a second
  attempt within one configuration, so the same guard that governs the first one
  governs it: a source change, a reconfiguration or a teardown that lands while
  the audible attempt is in flight discards the retry rather than adopting it.

  `'muted'` and `'audible'` are unchanged in every respect, as is how a refusal is
  detected. The React `autoplay` prop accepts the new mode and its default stays
  `false`.

  **The new mode against a controlled `muted={false}` suppresses the recovery.**
  The audible attempt runs normally, and a refusal ends `'blocked'` with
  `autoplayRecovered` false, exactly as `'audible'` would. The configuration is
  not rejected up front — an audible attempt under a controlled unmuted state is
  a legitimate thing to ask for — but muting to recover would override a value the
  consumer owns, and this library does not do that. `'muted'` against a controlled
  `muted={false}` keeps its existing configuration error, which is a different
  case: there the two requests contradict each other before anything is attempted.

  Which providers the recovery reaches was established per adapter rather than
  generalised from the native one:

  - **Native** maps a `NotAllowedError` to `reason: 'blocked'`, so it recovers.
  - **HLS** delegates `play` to the native adapter verbatim, so it recovers
    identically.
  - **Vimeo** maps the same error name off the promise its SDK rejects, so it
    recovers wherever the SDK names the rejection that way.
  - **YouTube** throws nothing for a refusal. It reports `'blocked'` when the
    player has not reached playing or buffering inside its playback-confirmation
    window, so the recovery does run — it just begins at the end of that window
    rather than at the refusal.
  - **Wistia** does not recover. It carries the same error-name mapping, but
    `player.play()` is synchronous and returns nothing, so the command resolves
    successfully whatever the browser did and no refusal ever reaches the
    controller. Making Wistia report one is a separate change.

- 5d0af45: Every configuration error now reports `recoverable: false`, and both
  `Player.ActivationButton` and `Player.ErrorDisplay` decide what to offer from
  that one flag (#198). The two used to disagree over the same error:
  `ErrorDisplay` offered a retry, because a configuration error stamped itself
  recoverable, while `ActivationButton` refused one, because it re-read the
  error's category. A composition rendering both offered a retry and refused it at
  once.

  Retrying a configuration error cannot succeed by any path. The three published
  by the activation layer — interaction loading with autoplay, viewport loading
  without `Player.Viewport`, an invalid viewport margin or threshold — are all
  published before a provider exists, so a retry returns its not-ready result and
  leaves the state untouched. The muted-autoplay conflict published by core does
  reach a provider, and the conflict flag survives it: only reconfiguring autoplay
  clears that one. The remedy for every one of them is a change the consumer
  makes.

  So `ErrorDisplay` renders no retry action for one, and hands render-prop
  children a `null` retry, which is the capability-aware behaviour it already
  applied to every other non-recoverable error. `ActivationButton` refuses
  activation and reports itself `aria-disabled` when the current error is not
  recoverable, whatever its category, and offers activation when it is — so a
  non-fatal notice that says nothing about retrying can no longer disable it. Its
  accessible name follows: `Retry loading video` only where a retry is on offer,
  `Play video` otherwise, with the child text (`Retry` / `Play`) tracking it.
  Recoverable values on every other category are unchanged.

  **Also a widening, beyond the configuration category.** `ActivationButton` and
  the `activateFromInteraction` behind it now refuse _any_ error the state reports
  as not recoverable, where before they refused only the `configuration` category.
  A provider-supplied `recoverable: false` error reaching the activation error
  state — a failed retry that concluded there is nothing left to try, say —
  previously rendered an operable `Retry loading video` whose press re-ran an
  activation that could not succeed. It is now `aria-disabled` and reads
  `Play video`, matching the retry `ErrorDisplay` already withheld for it. That is
  the point of deciding retryability once, but it does change what these controls
  do for errors no configuration factory produces.

  Both land as `minor`: every package is still at `0.0.0` with `first-prerelease`
  not yet released, and under 0.x `minor` is the channel a breaking change travels
  on. It is breaking twice over — the published value of the public
  `PlayerState.error.recoverable` field flips for an entire category, which any
  consumer branching on it sees, and the retry action and the `Retry loading
video` accessible name disappear from every configuration error, which a test
  suite asserting on either will fail against.

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

- 0303a63: One scheme allowlist now governs every source URL, and it is exported as
  `isPermittedSourceUrl` so no boundary has to restate it (#219). `http:`,
  `https:` and the scheme-less forms — protocol-relative, root-relative and
  relative paths — are permitted. `blob:` is permitted for a `video` source only,
  which is how a consumer hands over a `MediaSource` or a picked `File`, and
  rejected for `hls`, whose manifest loader fetches the URL itself. Everything
  else is rejected. The predicate takes the URL and the `type` of the
  `ResolvedPlayerSource` it belongs to — or `undefined` for a bare string no type
  has been resolved for yet — so `isPermittedSourceUrl(url, source.type)` reads
  straight off a resolved source.

  The allowlist previously ran on the string path alone, and two things walked
  past it. An explicit source object was never scheme-checked at all, so
  `{ type: 'video', sources: [{ src: 'javascript:alert(1)', … }] }`,
  a `data:text/html,…` source and `{ type: 'hls', src: 'file:///etc/passwd' }`
  were all accepted and carried to a `<source src>`, a media element's `src` or
  the HLS manifest loader — through the documented public source API, with no
  attacker-supplied string required. And a scheme split by a raw tab, line feed
  or carriage return — `java<TAB>script:…` — matched no scheme, skipped the
  allowlist, and resolved by file extension instead; the URL parser strips
  exactly those three characters before parsing, so what would have loaded was
  never what was validated. Any of the three, anywhere in a string, is now
  rejected as malformed, matching the treatment leading and trailing whitespace
  already had. A rejected object fails with the existing `invalid-source` reason
  and its existing guidance, so a consumer sees the same shape of refusal it
  already sees for a rejected string, and `Player.Root` declines to commit the
  source exactly as before.

  Protocol-relative sources are also normalised, by both paths. Detection already
  resolved `//host/clip.mp4` against `https:` in order to parse it; the resolved
  source now carries that resolution, so
  `detectSource('//cdn.example.com/video.mp4')` emits
  `src: 'https://cdn.example.com/video.mp4'` rather than the caller's form — and
  so does `{ type: 'hls', src: '//cdn.example.com/master.m3u8' }`, and every entry
  in a `video` source's `sources`. Normalising the string alone would have left
  the same string-versus-object split this change exists to close. An explicit
  source object is therefore returned as a normalised copy rather than the object
  passed in; a successful result's `input` is still, referentially, the caller's
  own object.

  **What a React consumer sees.** `Player.Root` detects its `source` prop through
  the same `detectSource`, so both halves reach React. A source that is now
  refused makes `Root` decline to commit it and render its unsupported-source
  path, where before it committed and handed the URL to a provider. And a
  protocol-relative source's committed `src` changes value, which any test or
  snapshot asserting on the rendered `<source src>` or media `src` will fail
  against.

  Both land as `minor`: every package is still at `0.0.0` with `first-prerelease`
  unreleased, and under 0.x `minor` is the channel a breaking change travels on.
  It is breaking twice over. Sources that were accepted are now refused — the
  `blob:` HLS source is the one plausible case that was not already a defect, and
  it must move to `type: 'video'`. And a protocol-relative source's emitted `src`
  changes value, which any test asserting on it will fail against, and which
  pins such a source to `https:` on a page served over `http:` rather than
  letting it follow the page.

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

- 339b3a1: Seeks now carry a provenance, the way playback commands already do (#186).
  `PlayerController` gains `seekToWithOrigin` and `seekByWithOrigin`, each taking
  the same `PlayerEventOrigin` the playback commands take, and `PlayerState` gains
  `seekOrigin`. Every seek a person asks for is tagged `'user'`: a drag on
  `Player.SeekSlider`, an arrow, `j`, `l`, `PageUp` or `PageDown` inside
  `Player.Controls`, and a double tap on `Player.Gestures`. The untagged `seekTo`
  and `seekBy` keep their signatures and delegate with `'api'`, exactly as the
  untagged `play` already did. A seek nobody asked for stays `'provider'`.

  The three user routes report the same origin on purpose. ADR-0005 gives the
  arrow keys to the shortcut layer rather than to the scrubber's range input, so a
  keyboard seek never reaches `SeekSlider`'s own command — reporting it as `'api'`
  would make the provenance depend on where focus sat, which is the distinction
  that decision exists to remove.

  `seeking` is untouched: still a boolean, still true over the same interval.
  `seekOrigin` is the additive field beside it, set exactly while a seek is in
  flight and `null` the rest of the time — a seek that is not happening has no
  provenance. A seek already under way keeps the origin it started with, so a
  provider that re-reports `seeking` does not relabel it.

  Provider adapters are unchanged. They go on stamping every report they make
  `'provider'`, which says who reported the seek and not who asked for it; the
  controller replaces that stamp on the `seeking` and `seeked` events whose seek
  it holds a request for. What each provider reports therefore decides what a
  consumer sees:

  - **Native** reports both halves of a seek, so both events carry the origin,
    and `seekOrigin` is readable for the whole of the seek.
  - **HLS** forwards the native reports, so it behaves identically.
  - **Vimeo** reports both halves off its SDK, so it behaves identically.
  - **Wistia** reports only the settled half. `seeked` carries the origin; there
    is no `seeking` report to label, and `seekOrigin` is never set.
  - **YouTube** reports no seek at all, so nothing is labelled. This changes
    nothing about YouTube — it published neither event before this.

  The request is held until the provider confirms it, and dropped when it cannot
  be: a seek command that fails drops its own request, and swapping the provider
  or advancing the controller generation drops every request outstanding. A
  provider that accepts a seek and then reports nothing for it leaves the request
  held, which is what a play command that is never confirmed already does.

  This reuses the machinery that already reconciles playback provenance rather
  than adding a second one beside it. Playback and seek requests are held apart
  because both can be outstanding at once, but they share one lifecycle, and
  playback provenance is unchanged in every respect.

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
