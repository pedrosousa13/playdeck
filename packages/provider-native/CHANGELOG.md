# @playdeck/provider-native

## 0.2.0

### Minor Changes

- a7b73f7: The native provider no longer republishes an empty `buffered` over a non-empty one.
  It published that field from four places — the media-state snapshot, reached by the
  attach snapshot, `canplay` and `loadedmetadata`, and `progress` — each putting
  whatever `media.buffered` read at that instant on the wire, unconditionally. An
  empty `TimeRanges` therefore erased ranges the player had already been told about
  (#405).

  **An empty reading is ambiguous and the element gives no way to disambiguate it.** No
  ranges means one of two things — "nothing is buffered" and "not telling you" — and
  WebKit means the second often enough to matter. Measured in situ on 2026-08-21 under
  [#401](https://github.com/pedrosousa13/playdeck/issues/401), over 13 sequential loads
  of the reference composition on the maintainer's machine: on 2 of them WebKit opened a
  buffered window for the ~1s WebM tracer clip while it parsed and closed it again when
  parsing finished, with the data still there and still playable.

  ```
  run 6:  1942 progress   elBuf=[[0,0.357423974]] rs=2 ns=2 dom=1   <- window open, range rendered
          2598 progress   elBuf=[]                rs=4 ns=1 dom=1   <- onProgress republishes []
          2600 canplay    elBuf=[]                rs=4 ns=1 dom=0   <- range gone from the DOM
  ```

  A buffered indicator that had rendered correctly disappeared, and
  `PlayerState.buffered` reported less than the player had already been told. On 6 of the
  other 11 loads the window never opened at any observable instant — a different problem,
  and one no adapter change reaches.

  **What ships: within one source, an empty reading is _unknown_ rather than _none_.**
  The adapter records the ranges it last put on the wire and withholds the `buffered`
  key when the reading is empty and that record is not — the key is absent from the
  patch rather than present and empty, which `#applyPatch` resolves by retaining what
  it already holds. Withheld and not ignored outright, and scoped to one source with an
  explicit reset point, because eviction is real: on another engine an empty reading
  genuinely can mean none.

  **`PlayerState.buffered`'s meaning moves with it,** and that is the substance of this
  change rather than a side effect. It is no longer a faithful instantaneous mirror of
  the media element — it is the last thing the provider was willing to vouch for. The
  term is written down in `CONTEXT.md` as **Buffered window**.

  **`emptied` is the one reset point inside an attachment.** It fires from the media
  load algorithm, which empties the element's buffer as it runs, so there the ranges
  are gone rather than merely unreported and the retained value goes with them. Silent
  when the record was already empty: `load()` calls `media.load()`, so every ordinary
  load fires this, and a patch restating a value that never moved is the empty patch
  this adapter refuses everywhere else. A source change needs no code at all — it
  builds a new provider over state rebuilt from `createInitialPlayerState()`, so the
  record is fresh by construction.

  **A seek is deliberately not a reset point.** Clearing on "a seek outside the known
  buffered range" was the proposed third rule, and it was measured before being wired.
  Measured 2026-08-24 on the maintainer's machine: chromium, firefox and webkit, three
  runs each, a 600 s clip served through a range-honouring local server throttled to
  250 KiB/s so only ~4% of it was ever buffered when the seek went out.

  `buffered` never read empty after any seek on any engine. The old ranges were retained
  verbatim — the leading range's `end` was bit-for-bit identical before and after — with
  a new disjoint range added at the target, and seeking back into the retained range was
  served with **zero HTTP traffic** on firefox and webkit and without a re-fetch on
  chromium. The retained ranges were not merely reported, they were still true, so that
  rule would have discarded real data. It is not implemented, and
  [#405](https://github.com/pedrosousa13/playdeck/issues/405) carries the full traces
  for anyone who wants to re-measure.

  **What did not change.** `seekable` is published on every `progress` exactly as
  before — only `buffered` carries the ambiguity. A non-empty reading is published
  whenever it arrives, unchanged or not: the record suppresses the empty-over-non-empty
  case and nothing else. A DVR window that slides, dropping ranges off its start, is
  non-empty at every step and is published like any other reading.

  **The buffered indicator's WebKit skip is untouched.**
  [#401](https://github.com/pedrosousa13/playdeck/issues/401) closed by adding that skip,
  and this change is not grounds for removing it: the loads it addresses are the ones
  where WebKit reported a window and withdrew it, not the ones where it never reported
  anything, and `e2e/reference.spec.ts`'s `skipWithoutWebKitBuffered` describes the
  second. Removing the skip needs its own evidence, of the kind that put it there.

  It lands as `minor` rather than `patch` for the reason `native-duration-no-longer-latches`
  did: no API moved, but published state did, and a consumer asserting on the provider
  stream sees a patch shape that was not there before — one from `emptied`, and one from
  `progress` that carries `seekable` without `buffered`.

- 3300d23: The native provider now publishes `duration` when the media element says it
  changed. It listened for `durationchange` nowhere — the package's only such
  listener fed chapters — and published a duration from one place, the media-state
  snapshot, which runs on the attach snapshot, `canplay` and `loadedmetadata` and
  on nothing else. `progress` republished `buffered` and `seekable`; `timeupdate`
  republished `currentTime`; neither ever touched the duration (#400).

  An element is entitled to revise its duration, and WebKit does: it publishes a
  growing one while it is still parsing. `PlayerState.duration` therefore latched
  whatever `media.duration` happened to read at the last of those three events and
  never recovered, even after the element itself had converged.

  **What a viewer got.** `SeekSlider` takes its `max` from
  `seekWindow(duration, seekable)`, so a duration that never moves is a `max` that
  never moves. On the ~1s reference clip the control froze at maxima between 0.05
  and 0.56 while the element sat at 1.000333333, for the rest of the session. That
  is not a mis-scaled control, it is an inoperable one: under the default
  `step={1}` a `max` below 1 leaves `0` as the only value the input's grid can
  express, so `End` snaps to the value the input already holds, no change event
  fires, and no seek is ever issued — the mechanism
  [#383](https://github.com/pedrosousa13/playdeck/issues/383) describes, reached
  here through a bogus `max` rather than a genuinely short clip. That issue is
  open and is not fixed here. Every other signal says the press was seen.

  **A narrow `ProviderStatePatch`, not a second media-state snapshot.**
  Republishing the whole snapshot was the obvious shape and is not what shipped.
  The snapshot rebuilds `capabilities` and restates `lifecycle` and `activation`,
  three fields this event has no news about, and `durationchange` also fires from
  the media load algorithm with `readyState` back at 0 — so a `retry()` would have
  walked a ready player back to `loading` on its way through. What ships instead
  is the shape `progress`, `volumechange` and `ratechange` already use: a provider
  patch carrying what its event reports and nothing else — one key here, where
  `progress` carries two.

  **Nothing is published for a duration that did not move.** A live stream fires
  `durationchange` for an endless duration that normalizes to `null` every time,
  and a reload fires one more for a `NaN`. The handler compares against the value
  last put on the wire and stays silent when it held, so an endless duration
  publishes exactly once and cannot flap, and no state change is fanned out for a
  value nobody can observe changing. Liveness that such an event does move is
  still published, because liveness is derived from the _raw_ duration, which is
  what an endless stream's `Infinity` is.

  **`seekable` is deliberately left where it was.** For a finite duration above
  zero `seekWindow` reads the duration and ignores the window entirely — it guards
  on `duration > 0`, so a finite `0` falls through to the seekable branch — and
  for the live DVR case that does read it, `progress` is the event that reports
  the window moving and already republishes it on every one. A duration changing
  says nothing about the seekable window that a `progress` has not already said.

  **What did not change.** `canplay` and `loadedmetadata` still publish the whole
  media-state snapshot with the duration in it: this adds a publisher rather than
  replacing one. Liveness, the at-edge flag and the endless-duration normalization
  are untouched, and no field another seam owns is written from the new path.

  It lands as `minor` rather than `patch` for the reason `7889ef8` did, when
  `PlayerState.live` stopped being the HLS adapter's alone and every provider that
  can tell began publishing it (#187): no API moved, but published state did, and
  a consumer asserting on the provider stream sees a provider patch that was not
  there before. What `patch` answers to is a defect fix behind an _unchanged_
  surface, not the absence of a behaviour change — `07e47c3` released the
  subscriber fan-out isolation, a behaviour change on every provider, at `patch`
  (#233). This is a defect fix too, but `PlayerState.duration` is part of the
  surface and what it carries moved.

  **Superseded in this release by #431.** The paragraph above says the mechanism it
  reaches belongs to an issue that "is open and is not fixed here". Both halves
  stopped being true before this shipped: #431 landed in the same release and
  closed #383. `SeekSlider` no longer renders a fixed one-second step — `seekStep`
  derives `Math.min(1, span / 20)`, so a window narrower than twenty seconds gets
  twenty positions instead of two, and a zero, `NaN` or infinite span falls back to
  the second. What the paragraph describes still happened, and the latched `max` it
  diagnoses is still the defect this changeset fixes; only the "under the default
  `step={1}`" premise and the claim that #383 stands are out of date.

### Patch Changes

- ca47d59: The native provider no longer writes an initial position onto the media element
  when there is no start position to apply. `applyInitialPosition` ran on every
  `loadedmetadata`, the default `startTime` of 0 included, where the value it
  asked for was the one the media load algorithm had already put there.

  A same-value `currentTime` write is not a no-op. It starts a seek, and #407
  measured what a seek into a partly-parsed WebKit element costs: the write is
  clamped into `seekable`, the playhead lands on the leading edge, the duration
  freezes there permanently and the network goes to `stalled`. #411 measured that
  same hazard reaching every native and HLS consumer through this line, on every
  ordinary load — a viewer on a slow connection clicked play, the clip loaded
  completely, and the player sat at 0:00 with no error, while the library reported
  `playback: 'ended'` for a clip that never showed a frame. Clicking play a second
  time recovered it, which is the kind of thing a viewer works around silently and
  never reports.

  Two writes are skipped now, for two reasons:

  - `startTime` 0, because there is no start position to apply. The element is
    already at 0, and if metadata arrives after playback has begun, writing 0 is
    not applying a start position — it is rewinding playback that already
    happened.
  - A `startTime` above 0 that the element is already sitting on, because asking
    the element for the position it holds buys nothing and costs the same seek.

  A real `startTime` still reaches the element on every load, and still after a
  `retry()`. What changes for a consumer who never set one is that the element is
  left alone: no seek, and no seek to freeze a partly-parsed source at 0:00.

  **One behaviour beyond the defect changes with it.** On a live source the
  skipped write was never a same-value write, so this is the one place a consumer
  can see the difference. A DVR window that starts above 0 — `seekable` of
  `[[100, 200]]`, an endless duration — has no point at 0 for the default
  `startTime` of 0 to be clamped to, so `withinMediaBounds` returned the nearest
  one it had, the back of the window, and every load rewound the viewer to the
  oldest thing in the DVR buffer. Nothing asked for that; it fell out of clamping
  a request that should not have been made. The position is now left where the
  engine placed it, which for a live stream is the live edge, and a unit test
  pins it.

  **Why `patch` and not `minor`.** This is an intentional behaviour change, so
  the level has to be argued rather than assumed. `PlayerState` gains no field
  and loses none, no signature moves, and nothing a consumer calls answers
  differently: what changes is a `currentTime` write onto an element the consumer
  does not own, and the observable difference is the absence of a seek that
  served no one. For a consumer without a `startTime` the element is left at the
  position the media load algorithm already gave it — 0 — which is the position
  the removed write asked for. For one with a `startTime` the position is
  unchanged, and it still lands on every load and after a `retry()`. The live
  case does move an observable position, and it moves it from a value nobody
  requested to the engine's own, which is the fix rather than a second change to
  absorb. `07e47c3` is the precedent this leans on: the subscriber fan-out
  isolation changed behaviour on every provider and released at `patch`, because
  `patch` answers to a defect fix behind an unchanged surface, not to the absence
  of a behaviour change. `native-duration-no-longer-latches.md` went `minor` for
  the opposite reason — `PlayerState.duration` is surface and what it carried
  moved. Nothing here is surface.

- cf13c02: `RootProps` is now a single declared object type rather than
  `NativePlaybackOptions & PlayerActivationProps & { ... }`. `Root` accepts exactly
  the same twenty-five props, none added and none removed, and nothing it renders
  moves — this changes only what a consumer's compiler prints when a prop is
  rejected.

  Compiled against the built declarations, an invented prop used to read:

  ```
  error TS2322: Type '{ children: Element; ref: RefObject<PlayerHandle | null>; source: string; tracks: never[]; }' is not assignable to type 'IntrinsicAttributes & NativePlaybackOptions & PlayerActivationProps & { readonly autoplay?: AutoplayMode | undefined; ... 16 more ...; readonly volume?: number | undefined; }'.
    Property 'tracks' does not exist on type 'IntrinsicAttributes & NativePlaybackOptions & PlayerActivationProps & { readonly autoplay?: AutoplayMode | undefined; ... 16 more ...; readonly volume?: number | undefined; }'.
  ```

  and now reads:

  ```
  error TS2322: Type '{ children: Element; ref: RefObject<PlayerHandle | null>; source: string; tracks: never[]; }' is not assignable to type 'IntrinsicAttributes & RootProps'.
    Property 'tracks' does not exist on type 'IntrinsicAttributes & RootProps'.
  ```

  **TypeScript still does not list the props it would have accepted**, and no shape
  this library can declare makes it. It elides the members of an object type it
  prints, and `--noErrorTruncation` does not change the output above either,
  because what gets printed now is the alias rather than its members. What changes
  is that the rejected type has a name, and that name is exported from
  `@playdeck/react`: the error points at a declaration a consumer can open, rather
  than at a flattened intersection that had lost the alias and named
  `NativePlaybackOptions`, a type from a package
  [the README](https://github.com/pedrosousa13/playdeck#readme) says nobody needs
  to install.

  `PlayerActivationProps` keeps its shape and its export. It is now
  `Pick<RootProps, 'loadMargin' | 'loadThreshold' | 'loading' | 'preload'>`, so
  those four props have one declaration between them rather than two.

  **The JSDoc on `loop`, `startTime` and `endTime` now describes the props rather
  than the plumbing that carries them.** These are `Root` props on every provider
  ([ADR-0004](https://github.com/pedrosousa13/playdeck/blob/main/docs/adr/0004-cross-provider-options-live-on-root.md)),
  but their hover text lived in `@playdeck/provider-native` and opened by calling
  itself the native and HLS route to the same prop, citing two bare issue numbers
  — which is what a consumer on a YouTube source read when they hovered
  `startTime`. Both the `Root` declaration and `NativePlaybackOptions` now say what
  the prop does and which values it refuses. No behaviour and no type moved with
  the text.

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
