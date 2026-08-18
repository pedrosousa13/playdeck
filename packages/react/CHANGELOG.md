# @playdeck/react

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

- a896e55: `SeekSlider` now exposes its idle state to assistive technology. While the
  `seek` capability is available but no seek window can be derived — no positive
  duration and no seekable extent — its `[data-playdeck-part='seek-slider-input']`
  range control carries `aria-disabled="true"`, its `aria-valuetext` reads
  `Unavailable` instead of `0:00`, and a change event on it issues no seek.
  Previously the control announced a position it did not have and silently
  accepted scrubs that went nowhere, with the state reaching CSS through
  `data-state="idle"` and nothing else (WCAG 2.2 AA 4.1.2). It is `aria-disabled`
  and not the native `disabled` attribute on purpose: the state flips the moment
  the media reports a duration or a seekable extent, and `disabled` would drop the
  control out of the tab order and move focus out from under a keyboard user each
  time. `aria-disabled` joins `value`/`min`/`max`/`type`/`aria-valuetext` as an
  attribute the library owns against `inputProps`.

  It lands as `minor`: every package is still at `0.0.0` with `first-prerelease`
  not yet released, and under 0.x `minor` is the channel a breaking change travels
  on. It is breaking because that last sentence takes an attribute away from the
  consumer. `aria-disabled` on `[data-playdeck-part='seek-slider-input']` was
  settable through the documented `inputProps` escape hatch and was applied as
  passed; it is now owned by the library, which strips it wherever a seek window
  exists and forces `true` wherever none does. A consumer disabling the control
  for reasons of its own through that hatch no longer has it honoured.

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

- 2121135: `Player.Media`'s three return branches now state the same geometry, and state
  it as a default your `style` prop overrides (#150). The branches disagreed on
  both counts: the YouTube and Vimeo mounts filled their viewport but discarded a
  colliding `style` property outright, while the native `<video>` read `style`
  and set no size at all — so a consumer who shipped no stylesheet got an
  intrinsically-sized frame in the corner instead of one filling the viewport it
  was laid into. All three are now `position: relative; z-index: 0; width: 100%;
height: 100%` under the #89 rule, so a `style` you pass and saw ignored on a
  YouTube or Vimeo source now takes effect.

  The native `<video>` also states `display: block`, so it no longer sits on a
  text baseline and hangs a descender gap below the frame, and
  `object-fit: contain`: the frame is content,
  so a box that does not match its aspect ratio has to letterbox rather than crop
  away part of the picture, and cropping is available by passing
  `objectFit: 'cover'` through `style`. This matches what browsers already apply
  to `<video>` and what `theme.css` already sized the layer to, so themed
  rendering is unchanged; it is the unthemed, headless case that this fixes. Note
  that it is applied inline, so it beats a stylesheet: a CSS-only consumer who
  wants cropping now passes `objectFit: 'cover'` through the `style` prop rather
  than writing an `object-fit` rule.

  `theme.css` no longer restates the media layer's `display`, `width` and
  `height` — the inline defaults set the same values and already outranked them,
  so nothing renders differently.

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

- ad15d23: `Player.Controls` takes a `shortcuts` prop, and the media shortcut layer it has
  always owned is now something a consumer can turn off or rebind (#181). Every
  action in the default map, and the capability each is gated on, is unchanged;
  what a consumer who configures nothing does get differently is set out under
  the three behaviour changes below.

  `shortcuts={false}` turns the layer off entirely — in `global` mode no
  `document` listener is attached at all. An object is a partial override map of
  action to a `KeyboardEvent.key` value, an array of them, or `null` to suppress
  that one binding, and every action it does not name keeps its default, so
  moving one key never means restating the map. Both forms behave the same in the
  default region-scoped mode and in `global` mode. `ShortcutAction` names the ten
  actions — `togglePlayback`, `seekBackward`, `seekForward`, `seekBackwardLarge`,
  `seekForwardLarge`, `volumeUp`, `volumeDown`, `toggleMuted`,
  `toggleFullscreen`, `toggleCaptions` — and `ShortcutBindings` is the map type.
  Hoist the object or `useMemo` it: a fresh literal on every render re-attaches
  the global listener.

  This is what WCAG 2.1.4 Character Key Shortcuts asks for. `global` mode's
  single-character keys are live wherever focus is on the page, and until now
  there was neither a way to switch them off nor a way to move them; the
  region-scoped default was never the problem and conforms through the
  active-on-focus exception. `global` mode itself stays.

  **A focused slider no longer silences the layer.** The layer used to skip any
  `<input>` target before it looked at the key, so
  standing on the seek slider — a native range input — killed Space, `k`, `j`,
  `l`, `m`, `f`, `c` and the volume arrows as well as the seek arrows. Targets
  are now classified by what they do with a keystroke: text entry (a text
  `<input>`, `<textarea>`, `<select>`, a content-editable region) and an open
  menu still silence everything, a focused button, link, `summary`, checkbox or
  similar keeps Space and `Enter` for itself, and everything else — a range input
  included — goes to the layer. That, and the two page keys the map now claims,
  give a consumer who configures nothing three changes they will notice:

  - **`ArrowLeft`/`ArrowRight` on a focused volume slider now seek** rather than
    changing the volume. `ArrowUp`/`ArrowDown` still adjust it and `Home`/`End`
    still jump to 0 and 1, so the control stays fully operable — but they adjust
    it by the layer's fixed 0.05, not by the input's `step`. `VolumeSlider` is
    itself the range input, so its `step` — that same 0.05 by default, and
    overridable with `<Player.VolumeSlider step={0.1} />` — no longer reaches the
    arrows for a consumer who set their own.
  - **`ArrowLeft`/`ArrowRight` on a focused seek slider now travel 5s, not 1s.**
    They used to step the input by its `step`; the region owns them now, so the
    seek distance is the same wherever focus sits, and no `step` or `onChange`
    set on that input through `inputProps` sees an arrow press any more.
    `SeekSlider` keeps `step={1}`, which still governs pointer scrubbing —
    coarsening it to 5 would make a short clip unscrubbable — and the announced
    `aria-valuetext` stays the accurate time readout.
  - **`PageUp` and `PageDown` are now bound**, to the same ten-second jumps as
    `l` and `j`. A consumer who configures nothing therefore gets two keys the
    map did not claim before, and on a focused range input they no longer produce
    the engine's own page step. That was the point: the large jump is now a
    defined distance rather than whatever the browser does. `Home` and `End`
    remain native.

  `shortcuts={{ seekBackward: null, seekForward: null }}` is the way back for the
  seek arrows: it suppresses those two bindings and hands the arrows straight to
  whatever native control has focus, leaving the rest of the map in place. The
  volume pair and the two large jumps take the same treatment, under
  `volumeUp`/`volumeDown` and `seekBackwardLarge`/`seekForwardLarge`.

  Capability gating still runs before any key is claimed: a binding whose
  capability is unavailable neither acts nor prevents the default, so the key is
  left to the page — and to the focused control, which is why the arrows still
  step a slider on a provider that cannot seek. `togglePlayback` is the one
  ungated binding, unchanged by this release: there is no playback capability to
  gate on, so Space and `k` are claimed on every provider.

  It lands as `minor`: every package is still at `0.0.0` with `first-prerelease`
  not yet released, and under 0.x `minor` is the channel a breaking change travels
  on. It is breaking three times over — `ArrowLeft`/`ArrowRight` on a focused
  volume slider change what they do, the seek slider's arrow distance changes from
  1s to 5s and stops reaching that input's `step` and `onChange` at all, and
  `PageUp`/`PageDown` stop producing the engine's page step on any range input
  inside the region. A consumer relying on any of the three sees it without
  changing a line, and `shortcuts` is what hands each one back.

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

- ca1a544: Add `loadThreshold` to `Player.Root`, alongside `loadMargin`. Under
  `loading: 'viewport'` it sets the fraction of the player's box that must be on
  screen before the provider attaches — an `IntersectionObserver` threshold from
  `0` to `1` — where until now the activation observer took no threshold at all
  and always attached at the first visible pixel. Defaults to `0`, so every
  existing consumer keeps that behaviour unchanged.

  A box taller or wider than the scroll container it moves through can never reach
  a threshold near `1`: no amount of scrolling puts 100% of it on screen at once.
  Rather than
  leave that configuration dormant forever with no playback and no error, such a
  box activates at the first visible pixel instead, the same fallback the
  default already is for everything else.

- ca1a544: Add Wistia as a fifth provider. `detectSource` recognises Wistia URLs and
  `@playdeck/core` exports `WistiaSource`; `@playdeck/react`'s `loadProvider` lazily
  imports `@playdeck/provider-wistia` the same way it does Vimeo, so a consumer who
  never plays a Wistia source ships none of its code. `Media` mounts a `<div>`
  for the `<wistia-player>` custom element the provider appends into it, the
  same treatment YouTube and Vimeo get.

### Patch Changes

- b7df03a: `ActivationButton` now states `margin: auto` alongside its inline
  `position: absolute; inset: 0`, so an overlay a stylesheet sizes down is
  centred in its viewport instead of pinned to the top-left corner (#160). A
  fixed size against four zero offsets is over-constrained, and CSS 2.1 §10.3.7
  on the inline axis and §10.6.4 on the block axis resolved the excess into
  `right`/`bottom` — the box landed at (0, 0). An `auto` margin is what absorbs
  it instead, on both axes.

  Nothing changes on the default path: with `inset: 0` and an auto width and
  height those same two rules resolve the margins to zero, so an unstyled overlay
  is still the full-bleed click target it was, and a headless overlay never had
  the problem to begin with — a `<button>` centres its own content, so the
  full-bleed box already put an icon child in the middle. The bundled
  `theme.css`, whose 4rem circle is where this surfaced, is unchanged and now
  renders centred; so does any consumer stylesheet that gives
  `[data-playdeck-part='activation']` a size of its own, which for a headless
  library is the case that matters. It stays overridable through the `style` prop
  under the #89 rule, `margin` included.

  One degenerate case does render differently: a box your CSS makes _larger_ than
  the viewport. §10.3.7 clamps a negative inline-axis margin back to zero, so an
  over-wide overlay still overflows to the right exactly as before; §10.6.4 has
  no such clamp, so an over-tall one now overflows equally above and below
  instead of only below.

- 9d0dc8b: `SeekSlider` now states its buffered extent as text. The buffered geometry is
  drawn by CSS-positioned `[data-playdeck-part='seek-buffered-range']` elements under
  an `aria-hidden` wrapper, so how much of the media had loaded was readable off
  the screen and nowhere else: `aria-valuetext` carries the playhead position
  only, and nothing in the DOM carried the rest (WCAG 2.2 AA 1.3.1). A visually
  hidden `[data-playdeck-part='seek-buffered-description']` now sits beside the
  geometry, referenced by the range control's `aria-describedby`, and reads
  `45% loaded`.

  The share is measured against the seek window rather than against media time, so
  a live DVR window that starts past zero reports the part of _that_ window which
  has loaded. Several buffered ranges produce one description, not one per range:
  their union is counted, so a gap in front of the playhead reduces the share
  instead of being papered over by a "loaded through" time the playhead cannot
  reach without waiting. Where there is no seek window, no buffered range at all,
  or nothing left of one after it is clamped to the window — a live DVR buffer
  that has slid off the back — no description is rendered and no share is claimed:
  an absent measurement rather than a `0%` that reads as measured. A share that
  does render will not round into a claim it cannot back either. It reads `100%`
  only for a wholly covered window, and otherwise stays between `1%` and `99%`, so
  a sliver does not round away to nothing and a near-complete buffer does not
  round up to done.

  It is not a live region and never announces on its own: `buffered` moves many
  times a second during playback. The geometry stays `aria-hidden`. Consumers keep
  their own `aria-describedby` through `inputProps`: the library's id is appended
  to it rather than replacing it.

- 204bcc3: `SettingsMenu`'s roving focus now skips menu items hidden with `display: none`.
  A consumer hiding an entry with CSS — a container query that folds a control
  into the menu at one width and back out at another — left the element in the
  DOM and in the focus ring, so `.focus()` silently did nothing: wrapping from the
  first item landed on the hidden entry, which made ArrowUp at the top of the menu
  and `End` dead keys. The visibility test is on the item itself, not its
  ancestors, because `checkVisibility()` is newer than the declared support floor.
- 9d73266: `Player.Poster` now stays visible when autoplay is refused on a native or HLS
  source (#242). A decoded first frame hides the poster on purpose — it is what
  the poster stood in for, and a preload that reaches a frame without playing
  never confirms playback for the poster to react to — but that writer read no
  autoplay state at all, so a `loadeddata` after Safari rejected an audible
  attempt uncovered a paused frame: no cover, no playback, and no gesture that
  asked for either.

  The frame writer now defers for as long as autoplay is configured and has not
  played: while the attempt is still to come, while it is in flight, and once it
  has ended without playback. An attempt still in flight counts because a decode
  that beat the rejection would put the poster back out of reach; one still to
  come counts because media that attaches already decodable — a cached clip, or a
  `loadeddata` that arrives before the provider loads — reaches this writer before
  the attempt can start. Confirmed playback is unaffected: the poster hides the
  moment playback starts, autoplay-driven or not, and a source with no autoplay
  still uncovers itself on the first frame.

- 149a990: `SeekSlider` now shows the position the user last asked for until the media
  answers for it, and coalesces the seek commands a drag issues (#185). The
  control wired every change event straight to `controller.seekTo` and pinned its
  thumb to `PlayerState.currentTime`, so a drag through five positions issued five
  commands, and mid-drag the thumb read back the time from _before_ the drag. On
  the native and HLS providers the echo is fast enough to hide that; on the iframe
  embeds, where each seek is an asynchronous cross-document round trip, the thumb
  visibly lagged or fought the pointer while the commands queued behind one
  another.

  Commands are coalesced by trailing-edge supersession: one in flight at a time,
  and a change arriving during it overwrites the pending position rather than
  queuing behind it. Five change events in one tick therefore issue two commands —
  the leading one, and the one the four behind it collapsed into — and the last of
  them is still the drag's final position.

  There is no drag detection and there are no pointer handlers. A drag is a burst
  of change events and an arrow press is a single one, and the two are not
  distinguished, so a keyboard seek previews exactly as a drag does, a single
  arrow press remains exactly one immediate seek, and nothing depends on a release
  event the keyboard never sends. The preview is released on the first of: the
  reported time landing within half a second of it once the command chain has
  drained, a two-second deadline armed from that same moment, a command that
  failed, a replaced provider, or a seek window that has vanished. While it is
  held it is clamped into the window the way media time is, because a live DVR
  window can slide out from under it, and `aria-valuetext` reads the position the
  thumb is showing, so a screen reader is never contradicted by the visual.

  Coalescing made two failures matter that fire-and-forget had absorbed, and both
  are handled here rather than left to the adapters:

  - **A seek command that never settles no longer kills seeking for the session.**
    Nothing below this layer has a timeout, and the iframe providers hand back raw
    SDK promises across a `postMessage` bridge that a torn-down frame or a dropped
    message can leave unsettled forever. A chain that never drained would swallow
    every later change into the pending slot. Each command is now raced against
    four seconds and reconciles like a failed one if it loses.
  - **A source swap mid-drag no longer scrubs the new media to a position chosen
    on the old one.** A position queued behind an in-flight command is abandoned
    when the provider changes or when the seek window goes, which is how a swap
    between two sources of the same provider kind shows up.

  Two things a consumer will see. A seek issued from outside the control —
  `actions.seekTo(0)` from a menu item, say — moves the media at once but does not
  move the thumb while a preview is held; it appears when the preview releases, up
  to the two-second deadline after the last command settles. And the echo
  tolerance is stated against the control's default `step` of 1: an
  `inputProps.step` below half a second moves the preview less than the tolerance,
  so a single arrow press at that step reads the time from before the press as an
  answer to it and the thumb reverts as soon as the command settles — which is
  what it did at every step before this release.

  It lands as `patch`. Nothing is added and nothing is taken away: `SeekSliderProps`
  is byte-identical, no export is new, and the set of attributes the library owns
  against `inputProps` is the set it already owned — `step`, `onChange`, labelling
  and styling all still apply, and a supplied change handler still receives every
  change event. That is the line `idle-seek-slider-is-not-operable` drew on this
  same primitive: it went `minor` because it seized `aria-disabled` from the
  `inputProps` escape hatch, and this release seizes nothing.

- 7f12301: `SettingsMenuContent` now defaults its content root to `tabIndex={0}`. Bound
  the menu's height — which any real player must, once a quality ladder and a
  rate list are both present — and it becomes a genuinely scrollable region;
  every menu item carries `tabIndex={-1}` for roving focus, so there was no
  tabbable descendant either, and axe reported `scrollable-region-focusable`
  (impact serious, WCAG 2.1.1) with the lower entries reachable only by arrowing
  until focus pushed the scroll. Nothing in the primitive's type or behaviour
  flagged the requirement, so every consumer who bounded the menu shipped the
  violation until they rediscovered the fix. `Player.CaptionsMenu`, a preset over
  the same content primitive, was affected identically and is covered by the same
  default.

  A consumer-supplied `tabIndex`, `-1` among them, still wins, matching
  `Player.Controls`' existing `tabIndex ?? 0`. Nothing else moves: opening the
  menu still focuses the first item so the root is never the landing spot,
  Escape still closes and returns focus to the trigger, Arrow/Home/End still move
  among items, Tab still closes and lets focus leave, and the items keep
  `tabIndex={-1}`, so no per-item stop is added. The content root itself is a
  tabbable node while the menu is open — that is the whole point — but the Tab
  order a user actually traverses is unchanged: a closed menu renders nothing at
  all, and Tab from inside an open one closes it before focus can reach the root.

  A tabbable root is also a click target, so it can hold focus with no item
  current — clicking the menu's padding does it. From there ArrowDown moves to
  the first item and ArrowUp to the last, rather than wrapping from a
  nonexistent current item onto the second-to-last one.

  It lands as `patch`, not `minor`: this is a behaviour correction on a prop the
  consumer can still set to anything, including back to the previous effective
  value. Nothing documented is taken away — unlike the `SeekSlider`
  `aria-disabled` change, which claimed ownership of an attribute the `inputProps`
  hatch used to pass through, `tabIndex` stays fully the consumer's to control.

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

- 23347d9: The volume control now shows the volume the user last asked for until the media
  element confirms it, and no longer drops a press that lands while published
  state is catching up (#271). `VolumeSlider` is controlled from
  `PlayerState.volume`, which moves only on the media element's asynchronous
  `volumechange`: on a change React held no new volume yet, so it restored the
  input's value to the old one and committed the real one milliseconds later, and
  a range input fires no `input` and no `change` when a key asks it for the value
  it already holds. A press arriving inside that window vanished with no feedback
  — `End`, `Home` and a pointer drag all took that path, and pressing `End`,
  `Home`, `End` in quick succession left the player silent on `Home` rather than
  back at the maximum it was showing.

  **The volume arrows now compound.** They never reached the input at all: the
  shortcut layer owns them and computed its next value as the published volume
  plus a step, so two presses inside one round trip read the same base and asked
  for the same target. From a published `0.5`, `ArrowUp` then `ArrowDown` left you
  at `0.45` — a symmetric pair of presses leaving you quieter than you started.
  It now returns you to `0.5`, because the base is the volume still outstanding
  whenever there is one. N presses move N steps, clamped at either end.

  Volume commands are coalesced the way seek commands already were: one in flight
  at a time, and a change arriving during it overwrites the pending volume rather
  than queuing behind it, so N rapid changes issue fewer than N commands — a drag
  through a dozen volumes costs far fewer than a dozen round trips and still ends
  on the drag's last one. The rendered value still moves on every one of them: the
  coalescing is in the traffic to the player, not in what the control shows, and
  no press is lost. It bites hardest where the changes arrive in one tick, as a
  drag's do; presses far enough apart for the command in flight to settle between
  them each get their own.

  The request is released on the first of: a published volume landing within
  `0.02` of it once the command chain has drained, a two-second deadline armed
  from that same moment, a command that failed, or a replaced provider. While it
  is held it outranks the muted zero, so dragging up out of a muted player shows
  the volume being asked for instead of the zero the player is still reporting,
  and `aria-valuetext` reads the percentage the thumb is showing, so a screen
  reader is never contradicted by the visual.

  Two things a consumer will see. A volume set from outside the control —
  `actions.setVolume(0.2)` from a consumer's own UI, say — moves the media at once
  but does not move the thumb while a request is held; it appears when the request
  releases, up to the two-second deadline after the last command settles. And the
  echo tolerance is stated against the control's default `step` of `0.05`: a
  `step` below `0.02` moves the request less than the tolerance, so a single
  scrubbed increment at that step reads the volume from before it as an answer to
  it and the thumb reverts as soon as the command settles — which is what it did
  at every step before this release. The arrows are not that path. `step` governs
  pointer scrubbing only, because the shortcut layer owns `ArrowUp`/`ArrowDown`
  inside `Player.Controls` at its own fixed `0.05` and prevents the default before
  the input steps (ADR-0005).

  `PlayerState` is untouched. `volume` and `muted` stay event-driven and still
  report only what the media element did, so a consumer reading state rather than
  the control sees exactly what it saw before.

  It lands as `patch`, on the line `seek-slider-shows-where-the-user-is` drew for
  the same mechanism on the other control: nothing is added and nothing is taken
  away. `VolumeSliderProps` is byte-identical, no export is new — the requested
  volume lives on the player context and is not part of the public surface — and
  the set of attributes the library owns against the props spread onto the input
  is the set it already owned. `step`, `onChange`, labelling and styling all still
  apply, and a supplied change handler still receives every change event and can
  still `preventDefault` it. That is the difference from
  `idle-seek-slider-is-not-operable`, which went `minor` because it seized
  `aria-disabled` from an escape hatch; this release seizes nothing.

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

- Updated dependencies [42ee0c5]
- Updated dependencies [742b52d]
- Updated dependencies [5d0af45]
- Updated dependencies [6fc0477]
- Updated dependencies [7889ef8]
- Updated dependencies [e5a77a3]
- Updated dependencies [0303a63]
- Updated dependencies [b4e25c7]
- Updated dependencies [07e47c3]
- Updated dependencies [f1e678a]
- Updated dependencies [663d9b5]
- Updated dependencies [339b3a1]
- Updated dependencies [c5b9891]
- Updated dependencies [5380f1e]
- Updated dependencies [3ab602b]
- Updated dependencies [79abea3]
- Updated dependencies [9359e21]
- Updated dependencies [a8392b4]
- Updated dependencies [c9c1f15]
- Updated dependencies [0239855]
- Updated dependencies [ca1a544]
- Updated dependencies [5002981]
- Updated dependencies [e3d02c3]
- Updated dependencies [0107bf6]
  - @playdeck/core@0.1.0
  - @playdeck/provider-native@0.1.0
  - @playdeck/provider-hls@0.1.0
  - @playdeck/provider-youtube@0.1.0
  - @playdeck/provider-vimeo@0.1.0
  - @playdeck/provider-wistia@0.1.0
