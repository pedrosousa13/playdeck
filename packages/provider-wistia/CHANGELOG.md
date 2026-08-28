# @playdeck/provider-wistia

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

- 636ead7: `startTime` is now a floor the YouTube, Vimeo and Wistia embeds are held to,
  rather than a position applied once when the provider adopts the player (#381).
  A reported position below it is pulled back into the window and the published
  `currentTime` reports the corrected position.

  **This is a behaviour change for shipped consumers, and it is deliberate.**
  Until now a viewer could drag the platform's own scrub bar below `startTime` and
  stay there. From this release they are returned to `startTime`. That follows from
  what `startTime` already claimed to be — the window playback is confined to —
  and from `seekTo` and `seekBy` having been clamped into that window since #214;
  a floor that only a Playdeck command respected was the inconsistency. A consumer
  who wants the viewer to reach earlier material should not set a `startTime` for
  it.

  **What was broken.** The start was written as a load hint and then seeked to
  once, at adopt, and nothing re-applied it. From that one seek onwards the window
  had no floor at all. Any later cause of a below-start position — an SDK-side
  seek, a repeat `ready`, or the viewer dragging the platform's own scrub bar —
  left the playhead outside the window, playing material the window was supposed
  to exclude, and no report said so. The clamp on `seekTo` and `seekBy` did not
  help: the positions that escaped were exactly the ones that arrived without a
  Playdeck command. It is corrected now however the position arrived.

  **The end of the window is corrected the same way, through the same predicate.**
  It was already enforced — a pause plus an `ended` — but only the published
  `currentTime` was pinned to the boundary; the playhead itself was left wherever
  the player had run on to before the pause landed. A viewer was therefore left
  looking at a frame outside the window, for as long as the player stayed there,
  while `currentTime` reported the boundary. The playhead is now seeked back onto
  the boundary, so what is on screen and what is published agree. Stated without
  inflation: the frames between the boundary and the report that notices it are
  still shown, briefly. These platforms report time on their own cadence — a poll
  every 250 ms on YouTube, the platform's own `timeupdate` on Vimeo and Wistia —
  so nothing driven by a report can stop before the boundary. What ends is the
  lasting disagreement, not the overshoot.

  **One rule, in one place.** `@playdeck/core`'s `createTimeBoundary` gains
  `correction(duration, time)`: where a position that simply _arrived_ has to move
  for the window to hold, or `undefined` when it needs no move. The three embed
  ports consult it, so one prop cannot mean three things — the reason the window
  was centralised in #214. `TimeBoundary` gains a member and loses none, and the
  existing questions (`start`, `end`, `atEnd`, `atWrap`, `restartsAtStart`,
  `clamp`) are unchanged in meaning and in what they answer.

  **It does not fight the seek clamp, and it cannot chase itself.** Every answer
  `correction` gives is the `clamp` of the same time, so a command the clamp
  already pulled into the window reports a position `correction` leaves alone —
  the two agree by construction rather than correcting one position twice. And
  every answer is a fixed point: move the playhead to it and the report that move
  produces asks for no correction, so one out-of-window position costs at most one
  corrective seek however many reports of it arrive.

  **The loop wrap guard is untouched.** `atWrap` is byte-identical — the loop
  concept it was documented as, still short-circuiting on `loop`, still the rule
  that restarts a looping embed and starts it playing again. What moved is the
  deference to it. Only the time-report paths ask it first: Vimeo's and Wistia's
  `onSeeked` call `correction` with no wrap test in front of them, because a
  paused embed reports no time update after a seek and the position has to be
  published from that handler. So the rule that a playhead behind the start of a
  looping player belongs to the loop now lives inside `correction`, which reads
  the loop from a parameter rather than from the call site and answers `undefined`
  for anything `atWrap` owns — sliding such a playhead onto the start instead
  would consume the wrap, leaving a position `atWrap` no longer recognises and
  quietly retiring the restart. A looping embed is therefore corrected by the loop
  rule exactly as it was and never reaches the floor below it, and that now holds
  wherever `correction` is asked from rather than depending on each call site
  remembering to ask in the right order. Widening `atWrap` into "enforce a floor
  whenever not looping" would have changed all three embeds' loop behaviour to fix
  something else, which is why it was not done.

  **The native and HLS providers are unchanged**, as they were for #214: native
  keeps its own boundary state machine, entangled with the element's `seekable`
  ranges, and nothing here reaches it. So `startTime` now means two things, and
  both ends say so rather than leaving it to be discovered: `RootProps.startTime`
  in `@playdeck/react` and `NativePlaybackOptions.startTime` in
  `@playdeck/provider-native` each state the divergence. Those two packages carry
  no code change at all — the corrected prose is their whole diff — but it is
  prose a consumer reads from the shipped `.d.ts`, so they take a `patch` for it,
  the way `@playdeck/react` took one for documentation alone in #457.

  **Why `minor` and not `patch`.** This is a defect fix, but not one behind an
  unchanged surface. `PlayerState.currentTime` publishes a value it did not
  publish before for the same viewer action, the library now moves a playhead it
  previously left alone, and `@playdeck/core` gained an export member. `patch`
  answers to a fix a consumer cannot observe except as the absence of a bug —
  `07e47c3` released the subscriber fan-out isolation that way — and this is
  observable on purpose: a consumer asserting on the provider stream sees patches
  that were not there before, and a viewer sees a seek they did not ask for. The
  precedent is `vimeo-no-longer-obeys-a-url-time-parameter.md` and
  `native-duration-no-longer-latches.md`: no API broke in either, but what a
  released package does changed, and a behaviour change should not arrive as a
  patch.

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
- Updated dependencies [a978938]
- Updated dependencies
- Updated dependencies [636ead7]
  - @playdeck/core@1.0.0

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

- 86fc6f0: The Wistia provider now checks `poster` before `playerColor` when it builds the
  `<wistia-player>` element, so an attach that rejects both reports the poster
  refusal rather than the colour one (#332).

  Both options are validated where they become attributes, and each rejection
  emits its own non-fatal `configuration` Notice. The controller keeps one such
  Notice per attach — the first one wins, and it is dropped with the provider
  that reported it — so with `{ playerColor: 'notacolour', poster:
'javascript:alert(1)' }` an operator was told only about the colour. The poster
  refusal is the security-relevant half: it is the shared allowlist turning down
  a `javascript:`, `data:` or `blob:` value, and it was never reported and never
  would be. Checking the cosmetic option second makes "first wins" coincide with
  "most important wins".

  **Nothing about either refusal changed.** A rejected value still sets no
  attribute — the same element state as omitting the option — the messages are
  the same two records, and both are still emitted. What changed is which of the
  two an operator observes on `PlayerState.error` in the one case where both are
  rejected in the same attach. A consumer who sets only one of the options, or
  whose values both pass, sees exactly what they saw before.

  The ordering is the fix, so it is commented as load-bearing at the call site
  and pinned by a test that fails if the two blocks are swapped back. The
  controller's single slot is unchanged: ranking notices there was weighed and
  declined as a concept addition disproportionate to the exposure, and Wistia is
  the only provider that can emit two notices in one attach, so nothing else can
  mask anything.

  It lands as `minor` rather than `patch` for the reason #319 did: no API
  changed, but what a released package reports did, and a behaviour change should
  not arrive as a patch.

  **Superseded in this release by #368.** The controller no longer decides its one
  notice slot by arrival. `PlayerError` carries a `severity` and the highest one
  holds the slot, so the ranking weighed and declined above is what shipped — in
  the same release as this. The ordering here is still correct and stays exactly
  as it is: the poster refusal is `protective` and the colour refusal
  `presentational`, so "first" and "most important" agree. It is simply no longer
  what the outcome rests on, and Wistia is no longer the only provider that can
  emit two notices in one attach.

### Patch Changes

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
