# @playdeck/provider-hls

## 1.0.0

### Major Changes

- Playdeck is 1.0.0, and the public API is frozen: anything reachable from a
  package entry is a contract, and changing it costs a major.

  **What the major is for.** Not a finished feature list. It is that the gaps
  between what this library reported and what was true have been closed rather
  than documented around:

  - A capability answers `available`, `unknown` or `unavailable` with a reason
    rather than guessing, and a control whose capability has not resolved is
    absent rather than disabled-but-visible.
  - A consumer value a security control refuses is published as a notice rather
    than dropped in silence.
  - An embedded provider that cannot attach reaches `error` within a stated
    deadline rather than waiting forever. The native and hls.js engines carry no
    such deadline and do not need one: they answer to the media element's own
    error event and to hls.js's, which report a failure to load without being
    asked.
  - A `ref` on `Player.Root` hands back the members its type declares. One hatch
    reaches past it, keyed by a well-known symbol and used by this package's own
    tests; it is in no export map and is not part of the frozen surface, but a
    consumer who goes looking can reach it.

  **Upgrading from 0.2.0 removes nothing.** Measured rather than assumed: every
  name each package exported at its published version — values and types together,
  read off the shipped declarations — is still exported here, and names were only
  added. That is a statement about names and not about every type's shape, so read
  the entries below for what individual releases changed; several of them alter
  what an existing call reports.

  `@playdeck/provider-hls` moves from `0.1.1` to join the others. The publishable
  packages now version as one, so a single number describes the whole API a
  consumer installs together.

  **Two unions widened, which is breaking for an exhaustive switch.**
  `SourceDetectionFailureReason` gains `unsupported-format`, and `Availability`
  gains `provider-build`. A `switch` with no branch for the new member falls
  through where it used to match.

  **What the freeze is over.** React 19 only, pure ESM, named exports, the stated
  browser floor, headless primitives that import no CSS, and providers whose code
  loads only when the active source needs it.

### Minor Changes

- 083df66: A CommonJS consumer is now refused by their own type-checker instead of by Node
  at runtime (#458). Being ESM-only is unchanged and stays unchanged; what changes
  is when a consumer who cannot use these packages finds out.

  **What was wrong.** The export map answered `types` and `import` and nothing
  else. A consumer whose project is CommonJS, on `moduleResolution: nodenext`,
  resolved the `types` condition, got `tsc` exit 0 with zero diagnostics, and then
  got this from Node:

  ```
  Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in
    .../node_modules/@playdeck/react/package.json
  ```

  TypeScript used to report that disagreement and stopped, because Node learned to
  `require` an ES module — but `require(esm)` still needs the `require` condition
  to resolve to something, and an ESM-only map had nothing to answer it with. So
  the diagnostic went away while the failure did not. An intentional constraint a
  consumer meets at build time is a supported boundary; one that passes typecheck
  and fails at `node` is a trap.

  **What each package now carries.** Two files, and a `require` condition that
  points at them:

  ```json
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./esm-only.d.cts", "default": "./esm-only.cjs" }
    }
  }
  ```

  `esm-only.d.cts` is deliberately not a module — it declares nothing and exports
  nothing — so the consumer's own import statement fails to compile:

  ```
  app.tsx(1,25): error TS2306: File '.../node_modules/@playdeck/react/esm-only.d.cts'
    is not a module.
  ```

  `esm-only.cjs` throws on load, so a consumer who gets past their build is
  refused by name rather than by a report of a missing file:

  ```
  @playdeck/react is ESM only and cannot be loaded with require(). Import it from
  an ES module, or reach it with a dynamic import().
  ```

  **Nothing gained a second implementation.** The guard refuses; it never
  implements. That is the point of it being a throw and an empty declaration
  rather than a shim: no bundler configuration can select it in place of the real
  ESM entry and get something that runs, so the ESM-only guarantee is not weakened
  by having answered `require` at all. Each package's `sideEffects` now names
  `./esm-only.cjs` for the same reason — a blanket `"sideEffects": false` would
  let a bundler that took the `require` condition drop a module it saw no
  bindings taken from, and hand the consumer an empty namespace instead of the
  refusal. `dist` is unaffected and still tree-shakes.

  **The types sit inside each condition rather than above both.** Conditions match
  in the order the map writes them, and a `types` key at the top of the `.` entry
  matches a CommonJS consumer before `require` ever does — which is the silent
  pass, restored. The nesting is what lets the two consumers be told different
  things.

  **Why `minor`, and what it breaks.** No API, no type and no rendered output
  changed, and `dist` is byte-identical — this is the export map and two files
  that are never imported. Nothing that ran stops running, because the builds this
  turns red were already producing code that Node refused.

  It is a `minor` rather than a `patch` because a build going red on upgrade is a
  break a consumer should be able to see in the version, whatever the state of the
  code underneath it. A CommonJS consumer type-checking code they never executed
  gets `tsc` exit 0 before the upgrade and a hard failure after it; calling that a
  patch asks them to discover the boundary from their own CI. While the major is
  `0`, `minor` is the slot a break belongs in.

  **What is unaffected, verified rather than assumed.** The three resolution modes
  that worked still do — `bundler`, `node16` and `nodenext` on a `"type":"module"`
  consumer, each type-checked against an installed package. `node10` still fails
  as it always did, naming the settings that would work; export maps are invisible
  to it, so nothing here could have reached it.

- 3896f17: A light hls.js build reports the captions it cannot show, and a subtitle-less stream stops claiming to be checking

  Two capability bugs on the hls.js engine, both of them `selectTextTrack`
  reporting `unknown` / `provider-check` for the whole session — the value that
  means "still checking" — long after the answer was known.

  **A stream with no subtitles.** The capability was only ever written by the
  `SUBTITLE_TRACKS_UPDATED` handler, and real hls.js does not fire that event when
  a manifest declares no subtitle renditions at all. So an ordinary subtitle-less
  HLS stream never settled. The unit test that covered the `unavailable` / `source`
  branch fired the event with an empty array by hand, which hls.js never does, so
  the gap did not show. It is now settled from `MANIFEST_PARSED`, which fires for
  every manifest.

  **A light hls.js build.** `hls.js/light`, reachable through `loadHls`, saves
  about 53 KB gzip by compiling out the subtitle controllers along with alternate
  audio, CMCD and EME. It still parses subtitle renditions and reports them once,
  then never emits `SUBTITLE_TRACKS_UPDATED`, so the tracks could be counted and
  never selected. That combination now publishes:

  ```ts
  capabilities.selectTextTrack; // { status: 'unavailable', reason: 'provider-build' }
  ```

  `Availability` gains the `provider-build` reason for it. Neither neighbour was
  true: the provider is able, so `provider` would be wrong, and the media does
  carry subtitles, so `source` would be wrong. Widening the union is breaking for
  a consumer switching exhaustively on the reason -- a build this applies to used
  to report a reason from the old set, and now reports one a switch may have no
  branch for.

  The build is told apart by reading `Hls.DefaultConfig` for the controllers the
  light build omits — synchronous, settled before anything loads, and no deadline.
  A module exposing no `DefaultConfig` is read as the full build, so an
  unrecognised one behaves exactly as it did before.

### Patch Changes

- a978938: Every package now ships its own `CHANGELOG.md` (#460). The file existed in the
  repository all along, but `files` named `dist` and nothing else, and a changelog
  is not one of the names npm includes regardless — unlike the README, the LICENSE
  and the manifest. So an installed `node_modules/@playdeck/react` carried no
  account of what had changed, and a consumer upgrading between two published
  versions had nowhere local to read one.

  This is packaging only. No code, no types and no rendered output changed, and
  `dist` is byte-identical.

  **It is not free, and the number belongs here rather than in a commit message.**
  Measured on the 0.2.0 tarballs, packed: `@playdeck/react` 123,391 → 170,286
  bytes (+38%), `@playdeck/core` 69,941 → 95,793 (+37%), and the seven together
  408,465 → 549,301 (+34%). None of it is code — a changelog is never imported, so
  it reaches no bundle and no bundle budget moved — but it is bytes in every
  install, and it grows with every release. If that becomes the wrong trade the
  next step is a truncated or per-major changelog, not a return to shipping none.

  Alongside it, and outside the packages: a published version now has a git tag on
  the remote. One per package, named `@playdeck/core@0.2.0`, so that the tag
  answering "what shipped as that" carries the name a consumer resolves from the
  registry, and so that packages publishing nothing are not implied by it. The tags are
  pushed before the publish rather than after it, so a release that fails halfway
  still leaves something to diff against. Versions published before this change
  are deliberately not backfilled.

- Updated dependencies [85e38d1]
- Updated dependencies [083df66]
- Updated dependencies [3896f17]
- Updated dependencies [3896f17]
- Updated dependencies [ef04afe]
- Updated dependencies [a978938]
- Updated dependencies
- Updated dependencies [636ead7]
  - @playdeck/core@1.0.0
  - @playdeck/provider-native@1.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [ecfef8b]
- Updated dependencies [b5fa01a]
- Updated dependencies [a7b73f7]
- Updated dependencies [ca47d59]
- Updated dependencies [cf13c02]
- Updated dependencies [5ae1450]
- Updated dependencies [3300d23]
- Updated dependencies [727a376]
- Updated dependencies [6910f1c]
- Updated dependencies [ea664ad]
- Updated dependencies [8624a2e]
  - @playdeck/core@0.2.0
  - @playdeck/provider-native@0.2.0

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
  - @playdeck/provider-native@0.1.0
