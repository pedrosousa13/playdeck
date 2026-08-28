# @playdeck/provider-youtube

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

- 9874c90: The YouTube provider now publishes `volumechange` — and the state patch beside
  it — only when the volume or the muted flag it was handed differs from the one
  it is already holding. It published both for every accepted `mute`, `unmute` and
  `setVolume`, whether or not the value moved, so an event reported a change the
  media never made (#365).

  The helper that emits the pair compared nothing, and could not: each of the
  three commands overwrote the known value first and then asked for the emit, so
  by the time the comparison would have run, the value to compare against was
  gone. It now takes the values it is about to publish as arguments and does the
  assignment itself, which is what puts the current and the next values in the
  same place at the same time.

  **Why this was YouTube's alone.** It was the only adapter that treated an
  accepted command as an event. The native provider assigns the media element's
  `volume` and emits nothing of its own — the element fires `volumechange` only on
  a real change, so a redundant command there is genuinely inert — and HLS
  delegates to it. Vimeo and Wistia publish nothing at all for an accepted volume
  command. The only thing either emits off one is a **capability downgrade** —
  `{ capabilities }`, carrying no volume — when `setVolume` comes back refused as
  `unsupported`, and `mute`/`unmute` emit nothing on any refusal. #365's
  description said the two "re-emit only when the SDK refuses a command, to snap
  consumer state back off a change that did not land"; neither re-emits a volume,
  and the point that reading was reaching for — that no other adapter turns an
  accepted command into a volume event — holds without it. Nothing
  downstream absorbed the difference: `PlayerController` fans every provider event
  straight out to the registered listeners rather than deduping them, and that is
  deliberately still true. A general filter in the controller would have masked
  the same defect wherever else it appeared.

  **Where a consumer will notice it.** A muted volume-arrow press. `Player.Controls`
  records the level an unmute is restoring as a volume request (#274), which at a
  nonzero published volume asks the player for the volume it already holds. That
  second command moves no state value on any provider and is silent on all five,
  YouTube now included. The unmute is the one real change in the pair, and every
  other provider does publish exactly one event for it — through its element or
  SDK event path rather than its command path. Native's `muted = false` makes the
  element fire `volumechange`, and HLS inherits that; Vimeo's attachment
  subscribes to the SDK's `volumechange`, which is where the muted half arrives,
  which is why it re-reads `getMuted()` on every fire; Wistia's subscribes to
  `mute-change`. So the count to match here was one, not zero: YouTube fired the
  unmute's event and then a second, value-identical one off the redundant
  `setVolume`, and now fires the one. One press, one real change, one event, on
  every provider. That is the extra event
  [#274](https://github.com/pedrosousa13/playdeck/issues/274)'s changeset stated
  so it would not be silent in the meantime; it is gone.

  **This removes events, and that is the direction that needs the care.** A
  consumer counting `volumechange` — analytics, telemetry, anything persisting the
  volume on the event rather than on a state diff — counted more volume changes on
  YouTube than the viewer made, and now counts what the other four providers
  count. A consumer treating the event as an acknowledgement that a command was
  carried out is the one that has to look: it never was that. The command result
  is what answers a command, and it is unchanged here — an accepted no-op still
  resolves `{ ok: true }`, it simply publishes nothing. The event says the volume
  moved, and now it only fires when it did.

  **The commands themselves still reach the player.** `mute()`, `unMute()` and
  `setVolume()` are called on the iframe API whether or not the mirror moves, and
  that call is load-bearing rather than defensive. `adoptVolume` reads `isMuted()`
  and `getVolume()` back off the player at ready, and nothing re-reads it after
  that — there is no volume event to subscribe to and no volume poll — so
  re-asserting a mirror the command did not move is the only mechanism that
  re-converges a player whose volume has drifted from it. Nothing else would
  notice until the next `onReady`. Only the report is suppressed.

  **Rounding is untouched, and the comparison is deliberately not made on it.**
  The player is sent a rounded `0-100` integer while the mirror keeps the
  unrounded clamped `0-1` value, so `setVolume(0.501)` and `setVolume(0.502)` are
  two distinct requests that land on the same player step, and both are still
  published. The comment on `emitVolumeIntent` carries the reasoning, next to the
  comparison it governs.

  **Nothing was silenced that the platform reports.** The IFrame Player API
  publishes no volume event of its own to arrive through this path: its event set
  is `onReady`, `onStateChange`, `onPlaybackQualityChange`, `onPlaybackRateChange`,
  `onError` and `onApiChange`, and the adapter subscribes to five of those and to
  nothing else. Volume is readable only through the `isMuted()` and `getVolume()`
  getters, which is why these mirrors exist at all. The adapter does read them:
  `adoptVolume` runs at ready and the ready patch publishes what it found, so a
  volume the viewer set in YouTube's own chrome before that point does reach a
  consumer. What has never existed is an ongoing report — a change made in that
  chrome mid-session is not observed until the next ready adopt, which was as
  true before this change as after it.

  It lands as `minor` rather than `patch` for the reason
  [#400](https://github.com/pedrosousa13/playdeck/issues/400)'s duration fix did:
  no API moved, but what a released version puts on the provider stream did, and a
  consumer asserting on that stream sees a difference. Here the difference is a
  subtraction, which is the stronger case of the two — a consumer counting these
  events gets a smaller number from the same session. `patch` answers to a defect
  fix behind a surface whose behaviour did not change, and this one's did.
  `major` would ask a consumer to do something before upgrading; there is nothing
  to do, and at `0.x` the `minor` slot is where an intentional behaviour change
  belongs.

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
