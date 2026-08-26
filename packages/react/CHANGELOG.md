# @playdeck/react

## 0.2.0

### Minor Changes

- 431fbe8: `ErrorDisplay` no longer paints a full-bleed overlay for a **Notice** — a
  non-fatal `configuration` error a provider publishes to report a value it
  rejected, while the fall-back it degraded to stands unchanged. Nothing stopped
  working, so covering a playing video with a `role="alert"` that carries no
  retry reported a failure that had not happened. A notice now renders at
  `data-playdeck-part="notice"` with no geometry, no stacking and no `role`, and
  `notice-message` inside it by default. It carries the error category on
  `data-state` like `error` does, and a consumer places it with their own `style`.

  The gate is notice-ness — `category === 'configuration'`, not `fatal`, and not
  in the error lifecycle — and deliberately **not** `fatal` alone. `fatal: false`
  also covers `toProviderError` (`provider`, and `recoverable: true`, so it offers
  a retry), Wistia's `policy` refusal and its `unsupported` refusal. Gating on
  `fatal` would have silently suppressed all three, including the retry a consumer
  relies on. Every failure keeps the overlay it had; only notices lose it.

  The lifecycle clause matters as much as the category. A `configuration` error is
  not always a notice: `useActivation` publishes one alongside
  `activation: 'error'` for `loading="interaction"` with autoplay, and for
  viewport activation without a `Player.Viewport`. Both mean the player will never
  load, so both keep the overlay — without that clause they would have rendered as
  an invisible notice, leaving a dead player with nothing on screen, which is the
  defect this change removes rather than relocates.

  The predicate mirrors `noticeIn` in `@playdeck/core`'s controller rather than
  importing it: that one classifies a `ProviderStatePatch` on the way in, this one
  classifies the published `PlayerState.error` on the way out. No new core export,
  so nothing is added to that package's public surface.

  This changes what an existing composition renders. The muted-autoplay
  configuration conflict produced the identical overlay before this and is
  included, which was the pre-existing case #319 recorded rather than something
  introduced by the notices #235 added. A consumer who was relying on a
  `configuration` error rendering as `error` should target `notice` as well —
  `ErrorDisplay`'s render-prop child still receives every error, with `retry` as
  `null` for a notice, because `configuration` is always `recoverable: false`
  (#198).

  It lands as `minor` rather than `patch`: nothing about the API changed, but what
  the component puts on screen did, and a released behaviour change should not
  arrive as a patch.

  **Superseded in this release by #368.** The third caller named above as the
  trigger for lifting the rule arrived in the same release: `#applyPatch`
  classifies the error already standing in the slot. So `isNotice` lives in
  `@playdeck/core` now and is exported, `ErrorDisplay` imports it rather than
  mirroring `noticeIn`, and this release does add to that package's public
  surface. What the component renders is unchanged — the same category, `fatal`
  and lifecycle clauses, applied to the same published error.

- 003763b: A refused `source` now says which failure occurred and quotes the value it
  turned down, and a provider that fails to load names itself.

  `detectSource` distinguishes three failure reasons internally —
  `malformed-string`, `unsupported-string`, `invalid-source` — and all three
  published the one sentence "The player source is not supported.", which named
  neither the failure nor the value. `ErrorDisplay` renders `error.message` and
  nothing else, so that sentence was the entire surface a consumer had: a
  mistyped Vimeo URL, a `javascript:` URL the shared allowlist refused, and a
  source object with a bad id were indistinguishable, and nothing said which URL
  forms are accepted. Each reason now reads differently:

  **Not readable** (`malformed-string`):

  > Playdeck could not read a video from the player source "…" — it is either not
  > a well-formed URL, or a provider URL in a form Playdeck does not read.

  That reason genuinely covers both, so the sentence says both: a string that
  broke a shared rule, and a recognised provider host in an unrecognised path
  shape, are one reason inside the detector.

  **Will not play** (`unsupported-string`):

  > Playdeck will not play the player source "…". An accepted source URL is
  > http(s) or scheme-less, carries no control character at either end, and is
  > either a YouTube, Vimeo or Wistia URL or a path ending .mp4, .webm or .m3u8.

  This is the one reason that cannot name a cause, so it states the requirement
  rather than guessing which half of it failed. It covers a scheme the allowlist
  refuses, an invisible C0 control at either end of an otherwise playable URL, and
  a URL that simply matched nothing — and for `clip.avi` there is no host to blame
  at all, while for a `.mp4` URL with a stray control character the host is
  irrelevant. Any sentence naming the scheme or the host would be wrong for two of
  the three.

  **Not a source object** (`invalid-source`):

  > The player source … is not a source object Playdeck accepts.

  Each quotes the rejected source, truncated to 120 code points — by code point
  and not by code unit, so the cut cannot split a surrogate pair and leave a
  replacement character in a message quoting the consumer's own value. There is no
  injection risk in the quoting: `ErrorDisplay` renders the message as a React
  text child, which escapes it. The bound is about layout rather than safety — the
  message is one paragraph over the player, and a long query string would push a
  retry button off a small viewport — and 120 keeps every URL form the new
  document lists whole, with the scheme, host and path that identify the mistake
  all inside it. A non-string source is quoted as JSON.

  `recoverable: false` is unchanged (#331): a retry re-reads the same `source`
  prop and the same rules refuse it again, so no control offers one.

  `'Unable to load the player provider.'` becomes:

  > Unable to load the &lt;provider&gt; provider. Playdeck cannot say why: the
  > rejection it caught is on this error's cause. See Playdeck's
  > docs/provider-setup.md for what to check.

  The provider is knowable from the resolved source, so it is named. The reason is
  not: a dynamic import the network never delivered, a CSP that refused the chunk,
  a missing media mount and an adapter factory that threw all arrive as one
  rejection, and the message says so rather than guessing. `cause` still carries
  that rejection — but `ErrorDisplay` renders `error.message` and nothing else, so
  `cause` alone would be a dead end for the person looking at the player. The
  document is the step both audiences can take, and its provider-load section
  gives an ordered list to check, forwarding to the CSP origins list rather than
  duplicating it.

  Every message points at
  **[Provider setup](https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md)**, new in
  this release, which lists the source values each provider accepts and refuses —
  derived from `detectSource` and checked by running it, not by reading a
  provider's documentation — along with each provider's `providerOptions` and a
  working player per provider. The per-provider examples deliberately pass no
  `providerOptions` at all: `youtube.host` moves the embed off the
  privacy-enhanced `youtube-nocookie.com` default and `vimeo.suppressSeoMetadata`
  acts page-wide, and neither is a decision a starting example should make for a
  copy-paster. The root README's quick start names the YouTube and Vimeo URL forms
  directly, so neither needs the reference document to get a source playing.

  `CONTEXT.md` gains a **Refused source** term and qualifies **Notice**. A
  `source` the shared allowlist refuses is a consumer-supplied URL prop, so
  Notice's unqualified claim that such a refusal "names the refused surface and
  never the value" no longer held once this change started quoting the value. The
  new term draws the line on why the two differ: a source is one prop with one
  value, so naming the value is naming what to fix, while a **Refused surface** can
  be refused by several instances at once and has no single value to name.

  One internal consequence worth naming, because it changes when a message is
  republished: the three loading strategies now depend on the refusal message
  rather than on the source's `status`. Every refusal collapses to one activation
  key, so replacing one refused source with another moved nothing those effects
  watched, and the message would otherwise have kept naming a value the consumer
  had already corrected.

  It lands as `minor` rather than `patch` for the reason
  `interaction-loading-reports-a-refused-source` gives: no API changed, but a
  released behaviour did, and a consumer asserting on either message string has to
  update. Both are prose intended for a person to read, not a stable identifier —
  branch on `error.category` and `error.recoverable`, which are unchanged.

- 5ae1450: Playdeck no longer starts playback on its own for a viewer who matches
  `prefers-reduced-motion: reduce` (#311). Both `loading: 'eager'` and
  `loading: 'viewport'` autoplay are declined — the rule is about motion the
  viewer did not ask for, not about where on the page it happens. `PlayerState`
  gains a sixth `autoplay` member, `'suppressed'`, and `Player.Root` gains an
  `ignoreReducedMotion` prop that opts out.

  **The autoplay you configured stays configured; only the attempt is declined.**
  That distinction is the whole implementation. `Player.Root`'s poster gate reads
  the `autoplay` prop and lets every autoplay state that is not `started` keep the
  poster up, so a suppressed autoplay holds its poster over the frame through
  `loadeddata` exactly as a refused one does. Passing `autoplay={false}` under
  reduced motion instead would open that gate and uncover a paused first frame
  with no cover over it and no gesture that put it there — the defect fixed in
  #242, arriving by a different route. Nothing else changes: `playback` stays
  where it was, `PlayButton` still starts playback from a click, and
  `autoplayRecovered` is `false`, as it is for every autoplay that did not start.

  `'suppressed'` is its own member rather than a reuse of `'idle'` because `'idle'`
  already means "no autoplay configured". Without it a consumer cannot tell an
  autoplay that was suppressed from one that never existed, which is what a
  "video paused for reduced motion" affordance needs to know. What the viewer sees
  is unchanged — the existing poster surface, with no presentation Playdeck
  invented for the occasion.

  `ignoreReducedMotion` defaults to `false`, and with it set autoplay behaves
  exactly as it did before this change. Its JSDoc on `Player.Root` carries the
  naming rationale.

  The query is read fresh at the moment each player decides whether to attempt,
  not subscribed to. A viewer who turns reduced motion on mid-session is honoured
  by every player that has not yet decided; one who turns it off does not get
  video retroactively starting at them. Where `matchMedia` is unavailable — server
  rendering, a worker, an older engine — the query cannot match and autoplay
  proceeds unchanged, so the browser-support floor is where it was.

- 753af5d: `loading="interaction"` now reports a refused `source` the way `eager` and
  `viewport` already did. Source detection turning a URL down **is** the security
  control — it is where `javascript:`, `data:` and tab-split scheme smuggling are
  rejected — and two of the three loading strategies published that refusal as an
  `unsupported` error while the third checked only whether `autoplay` had been
  combined with it. The consumer's own code is identical in all three cases, so
  whether a poisoned `source` prop was observable at all depended on an unrelated
  prop. Under `interaction` the player sat at `activation: 'dormant'` with
  `error: null`, which is indistinguishable from "the viewer has not clicked yet":
  nothing to render, nothing to log, and a play button that did nothing forever.

  **Nothing about the refusal itself changed.** No provider was constructed for a
  refused source before this and none is now; no URL was fetched and none is. The
  error is the same record the other two strategies publish — `unsupported`,
  `fatal: false`, and the same message text — with one field changed for all
  three, described under its own heading below.

  The refusal is reported **ahead of** the `interaction`-with-autoplay
  configuration conflict when both are true at once. `setActivation` carries one
  error, and the order matters: a security-relevant refusal masked by a complaint
  about an unrelated cosmetic prop is what #332 reported in the Wistia notice
  slot, where the same order-first rule settled it. Source first is also the
  order `eager` and `viewport` already check in. Neither error is lost — fix the
  source and the autoplay conflict is what you are told next.

  The interaction path also refuses to **arm** on a refused source. Publishing the
  error alone would not have been enough: `activateFromInteraction` would have
  taken the error branch, committed to `eligible` and cleared the error — putting
  the player back at the silent dead end this change removes, one call later. The
  session guards could not catch it, because they compare a source key that is the
  same constant for every detection failure.

  ## A refused source no longer offers a retry — under `eager` and `viewport` too

  The refused-source error changes from `recoverable: true` to
  `recoverable: false`. `recoverable` is the one flag `ActivationButton` and
  `ErrorDisplay` read to decide whether to offer a retry (#34, #198), and a retry
  here cannot work: it re-reads the same `source` prop, and the allowlist refuses
  the same URL again. An enabled control that does nothing is the affordance this
  change exists to remove, so the honest answer is to withhold it —
  `ActivationButton` renders `aria-disabled` and `ErrorDisplay` renders no retry
  button at all.

  **This is deliberately wider than `interaction`.** All three strategies publish
  this error, so all three lose that retry, and a consumer on `eager` or
  `viewport` will see a retry button that used to be enabled become disabled (or,
  in `ErrorDisplay`, disappear). Those two strategies had the same defect all
  along: the button armed a source the library had already refused. Nothing else
  is affected — the other `unsupported` error `useActivation` publishes, for a
  missing `IntersectionObserver`, is about the environment rather than the URL and
  stays `recoverable: true`. If you branch on `error.recoverable` yourself, that is
  the one field to re-check.

  This changes what an existing composition renders: a player whose `source` was
  being refused under `interaction` showed nothing and now enters the error
  lifecycle, so `ErrorDisplay` paints its overlay for it as it does under the other
  two strategies. That is the point of the change rather than a side effect of it —
  the alternative is a player that cannot play and says so nowhere. It is not a
  Notice and does not render as one: a notice is a `configuration` error published
  beside a fall-back that still works, and there is no fall-back here.

  It lands as `minor` rather than `patch`: no API changed, but a consumer who saw
  no error now sees one, and a released behaviour change should not arrive as a
  patch.

- beeecf5: `Player.Controls`' volume arrows now act on the muted zero the control is
  showing rather than on the published volume hidden behind it (#274). Muted at a
  published 0.5 the thumb sits at `0`, and the shortcut layer stepped `0.5` all
  the same: `ArrowDown` moved to `0.45` — a step down from a number nothing on
  screen displays — and, because `0.45 > 0`, it took the `muted && next > 0`
  branch and **unmuted the player**. Pressing "quieter" made the video audible.

  While muted with the thumb on that zero, `ArrowUp` unmutes and moves the volume
  nowhere, and `ArrowDown` is a no-op. `muted` and `volume` are independent on
  player state, so `unmute()` on its own restores the published level — the arrow
  never has to compute from a value the control is not showing, and the level the
  user left is not discarded the way treating the muted zero as an arithmetic base
  would discard it. Downward has nothing to do: the player is already silent, and
  "less" must not produce sound.

  **One muted case still moves the volume.** At a published volume of `0`,
  unmuting alone restores silence and the press looks dead, so `ArrowUp` there
  unmutes _and_ steps to `0.05`. That is the only value a muted arrow moves the
  volume to that the player was not already holding: everywhere else a muted
  `ArrowUp` asks for the published volume itself, which leaves every state value
  on the player where it was and is there to record where the unmute is going —
  see the round trip below. A muted arrow pressed over a change the player has not
  answered yet steps it, as it always has.

  **That redundant `setVolume` is not free of events on YouTube.** It moves no
  state value on any provider, but the YouTube adapter emits a volume intent on
  every accepted `setVolume` whether or not the number moved, and the controller
  does not dedupe, so a YouTube consumer listening for `volumechange` now sees one
  extra, value-identical event per muted `ArrowUp` where one fired before —
  analytics counting those events counts one more. Native is genuinely inert and
  HLS delegates to it; Vimeo and Wistia re-emit only when the provider refuses the
  change. The YouTube emit is a provider-honesty defect of its own — an event
  reporting a change that did not happen — and is tracked as
  [#365](https://github.com/pedrosousa13/playdeck/issues/365) rather than fixed
  under this issue.

  `ArrowDown` keeps preventing the default even though it does nothing.
  [ADR-0005](https://github.com/pedrosousa13/playdeck/blob/main/docs/adr/0005-the-shortcut-layer-owns-its-keys-on-a-range-input.md)
  gives the arrows to the layer wherever focus sits inside the region, a focused
  `<input type="range">` included; a no-op that skipped `preventDefault()` would
  hand the key back to `VolumeSlider`'s own stepping and produce exactly the
  native step the ADR exists to suppress. The capability gate still runs _ahead_
  of `preventDefault()`, so where `setVolume` is unavailable both arrows are left
  whole for the page.

  The muted branch applies only while no request is outstanding, which is the one
  state in which the request and the published volume disagree. A request is the
  muted-adjusted volume the thumb is already showing — from the unmute above, or
  from a pointer drag up off the muted zero — so an arrow pressed over one
  compounds on it at 0.05 as it always has, downward included. Reverting to the
  published base there would have re-introduced this issue's own complaint in
  mirror image: an arrow ignoring the value the control _is_ showing.

  That is also why the unmute records a request rather than nothing at all, and
  what keeps the round-trip coalescing #271 introduced intact through it. The
  player publishes `muted: false` a round trip later, so two presses inside one
  would both find `muted` true and no request outstanding, both take the branch,
  and the second would step nothing — the lost press #271 was filed over, on the
  muted path. Recording the published level gives the second press the base the
  first was restoring, so muted at `0.5`, `ArrowUp` `ArrowUp` lands on `0.55`. The
  thumb moves to the restored level at once, before the player has published the
  unmute — it is showing what the arrows are acting on, which is the whole of what
  #274 asks for.

  That base also had to survive the command settling. A muted player publishes a
  volume of `0` however loud it is, so the volume request now takes that zero as
  an answer only to a request for silence; it previously took it as an answer to
  anything inside the 0.02 echo tolerance. Muted at a published `0.02` or less —
  reachable through a consumer `step`, a consumer `setVolume(0.01)`, or YouTube's
  rounding to whole percent — the base was released the moment the command
  settled, and the press after it found no request, re-entered the muted branch,
  unmuted again and stepped nothing: the same lost press, one branch over. Above
  zero the deadline armed at the drain is still what releases a request no unmute
  ever answers, so a provider that refuses `unmute()` while accepting `setVolume`
  shows the restored level for that window and then falls back to the muted zero.

  Unmuted behaviour is untouched, and so is `VolumeSlider`'s own `onChange`. Its
  `muted && next > 0` unmute is correct where it stands — a pointer, `Home` or
  `End` change genuinely starts from the displayed zero, so dragging up off it
  means "unmute at this level" and still does.

  It lands as `minor` rather than `patch`: no API changed, but what a released
  version does with two keys did. A consumer who relied on `ArrowDown` unmuting,
  or on a muted `ArrowUp` landing one step above the remembered volume, sees
  different behaviour.

  **Superseded in this release by #365.** The extra YouTube event described above
  never ships: the fix it was tracked under landed in the same release, so the
  adapter no longer emits a volume intent for a `setVolume` that moves neither the
  volume nor the muted flag. A muted `ArrowUp` publishes one `volumechange` on
  YouTube, from the unmute, exactly as it does on the other four providers. The
  paragraph's account of those four is corrected there too: Vimeo and Wistia
  publish nothing for an accepted volume command at all, and what they emit on a
  refused `setVolume` is a capability downgrade rather than a volume.

- 6910f1c: The five consumer-supplied URL props the shared allowlist refuses now publish a
  **Notice** instead of dropping the value in silence: `PosterImage`'s `src` and
  each `srcSet` candidate, `Media`'s `nativePoster` and each `textTracks[].src`,
  and `bindMediaSession`'s artwork `src`. All five were routed through
  `isPermittedSourceUrl` without one, three hours after the library's rule that a
  refused consumer value must be observable was written and applied to `host`,
  `playerColor` and the provider-side `poster`. A poisoned CMS field was blocked
  correctly and left no trace anywhere — no error, no event, no console output —
  so the only symptom was a missing thumbnail.

  **Nothing about the refusal changed.** The value is still dropped exactly as an
  absent prop would be: no attribute, no `<track>`, no throw, no lifecycle move,
  and a poster given only refused values still settles in `data-state="idle"`.
  This is the detection half only.

  `PlayerController` gains one method, `reportRefusedUrl(surface)`. It takes a
  closed union naming the prop — `'poster src'`, `'poster srcSet'`,
  `'nativePoster'`, `'textTracks src'`, `'mediaSession artwork'` — and never the
  URL. That union is `RefusedUrlSurface`, the one type this change adds to
  `@playdeck/core`'s public API; the method above is the only other addition. The
  message is built in core from that key alone, so a refused value cannot be
  carried into an error that a monitoring system may log or `ErrorDisplay` may
  render.

  The method registers a standing refusal and returns a disposer. The notice is
  published while any registration stands and is withdrawn only by the reporter
  that made it, so fix the poisoned CMS field and the notice goes — a notice that
  could never be cleared would be a permanent false positive, and an operator who
  cannot clear a security notice learns to ignore all of them, which is the
  monitoring failure this change exists to fix. Registration is per reporter and
  not per prop because a prop name is not a component instance: two `PosterImage`s
  under one `Player.Root` both hold a `src`, and the one holding a permitted value
  must not be able to withdraw the other's notice. Each call site registers from an
  effect and returns the disposer as that effect's cleanup, so a refusal is
  withdrawn exactly when the value turns permitted or the component holding it goes
  away, and nothing is left standing that no live reporter owns.

  Several surfaces can stand refused at once and the state has one error slot, so
  the published notice is the first refused surface in the rank core fixes —
  `poster src`, `poster srcSet`, `nativePoster`, `textTracks src`,
  `mediaSession artwork` — never the order the reports arrived in. Report order
  depends on where a consumer placed `PosterImage` in the tree and on whether the
  pass is a mount or an update; the same poisoned fields should always produce the
  same message.

  A refused consumer URL is scoped to the controller rather than to a provider,
  unlike a provider's own notice. It has to be: a poster reports from its mount
  effect, which in the ordinary flow runs before the provider module has finished
  loading, so a provider-scoped report would be wiped by the very next attach. It
  never displaces a standing error. Against a provider's own notice the single
  error slot decides by arrival, not by rank: a provider notice resolved in the
  same pass as a refused URL wins, but a refused URL already published keeps the
  slot against a provider notice that arrives after it, until a later patch clears
  the slot and the two are ranked together. That first-one-wins is the single-slot
  behaviour #332 owns; this change makes it reachable from one more direction and
  does not settle it.

  `PosterImage` reads the player context optionally rather than through
  `usePlayer()`, so a poster rendered outside `Player.Root` keeps working and
  simply has nothing to report to.

  **Superseded in this release by #368.** The single error slot no longer decides
  by arrival, and the later patch anticipated above is in this same release: a
  notice declares a `severity` and the highest one holds the slot. All five
  refused-URL notices are `protective` — what each reports is the shared allowlist
  blocking an untrusted URL — so a cosmetic provider notice never takes the slot
  from one, whichever of the two arrived first. Where a provider's own notice ties,
  a fixed precedence settles it rather than arrival: what already stands, then the
  provider's notice, then the refused URL. The rank among the five surfaces
  described above is untouched.

- 3f98517: `Player.SeekSlider` and `Player.VolumeSlider` now snap the value they render
  onto the `step` grid their input is rendered with, so the value the library
  hands the control is always one the control can keep.

  A range input keeps only the values its own grid can express: the HTML value
  sanitisation algorithm clamps into `[min, max]` and then snaps to the nearest
  step, ties going to the higher. Both sliders render what the media publishes
  rather than what the user chose, and neither published value has any reason to
  land on that grid — a seek window of `[0, 1]` under the default 1s step has two
  values it can express and `currentTime` is a float between them, and a chain of
  0.05 volume steps drifts off its own grid in floating point.

  **What that cost.** React records the string it assigned to `value`; the input
  records the string it kept. Hand it one it cannot keep and those two disagree
  from then on, and React drops a change event whose new value equals the string
  its tracker is holding. The press behind that event issues no command at all,
  while every other signal says it was seen: the thumb moves, the keydown fires,
  `aria-valuetext` updates, and only the media never arrives. Measured on the ~1s
  reference clip, mid-playback: React assigned `0.505738182`, the input kept `1`,
  and the tracker went on holding `0.505738182`.

  `aria-valuetext` was reading off the same unsnapped value, so it disagreed with
  the thumb beside it by up to half a step — `0:00 of 0:01` while the thumb sat
  hard right. It now reads the snapped value, which is the policy `VolumeSlider`'s
  percentage already followed: assistive technology is never told the opposite of
  what a sighted user is being shown.

  **What it does not change.** Nothing downstream reads the rendered value. A
  command still carries the value read back off the DOM on the change event, the
  preview policy still compares against what was requested, and `Player.Controls`'
  volume arrows still compute from the outstanding request rather than from the
  thumb — so no command this library issues moves by so much as a step. `step="any"`
  turns snapping off, which is what the attribute means, and a consumer `step` is
  the grid rather than the default.

  **Where it is visible.** A control whose grid cannot express the published value
  shows the nearest value it can, and says so. A volume of `0.37` under the default
  0.05 step renders `0.35` and announces `35%`; it rendered `0.37`, announced
  `37%`, and every real engine displayed `0.35` regardless. The change is that the
  library now agrees with the engine instead of being silently corrected by it.

  It lands as `minor` rather than `patch`: no API changed, but what a released
  control renders and announces did, and a consumer asserting on either sees
  different values.

  **Found under #277, and not the cause of #277.** This defect was found while
  investigating #277, a WebKit-only CI failure in which three pipelined seek
  presses leave the media at the start of the seek window. The tracker desync
  above was the only known mechanism that produced that shape, so it was fixed and
  the WebKit leg of `e2e/rapid-slider-presses.spec.ts` was re-enabled as the
  experiment. The experiment came back negative: the failure survived the fix.
  Instrumenting the media element then showed that the third press does issue its
  seek and that WebKit completes that seek at the superseded position, so #277 is
  an engine bug closed as wontfix and that leg is excluded from WebKit
  permanently. The snapping change stands on its own regardless: a control handed
  values its input cannot keep is a defect whatever #277 turned out to be.

  **A short window is still a coarse control.** Snapping makes the control honest
  about its grid; it does not add positions to it. On a window of ~1s the default
  1s step still leaves two, so a press asking for an end the thumb already sits at
  moves nothing and seeks nowhere on every engine — no event is fired for the
  library to act on. That is [#383](https://github.com/pedrosousa13/playdeck/issues/383),
  which needs a decision about the step and about ADR-0005's arrow ownership with
  it, and is not made here.

  **Superseded in this release by #431.** The closing paragraph above defers the
  coarse-control problem to #383 and says the decision "is not made here". It was
  made in the same release: #431 derives the seek step from the window the control
  renders, `Math.min(1, span / 20)`, so the ~1s window that had two positions now
  has twenty, and #383 is closed. ADR-0005's arrow ownership was reviewed with it
  and left standing deliberately. The snapping change this changeset describes is
  unaffected and still stands on its own — snapping makes the grid honest, and
  #431 is what added positions to it.

- ef506fc: The seek slider's loaded-range indicator no longer paints over the control it
  annotates (#415). `SeekSlider` renders `seek-buffered` before the input and
  `theme.css` positioned that bar while leaving the input in flow, so a positioned
  element painted after in-flow content and the theme's own translucent bar
  composited on top of the native slider — white at 0.36 alpha, and a second white
  at 0.7 wherever a range was loaded. A `#000` thumb ring reached the screen as
  `rgb(206 206 206)` and cleared 1.03:1 against the loaded range on all three
  engines, against a 3:1 floor, while the contrast gate that reasons over token
  defaults said 9.96:1.

  The bar is behind the input now, and it is the slider's track: the theme draws
  the seek control on all three engines rather than decorating each engine's own.
  That is not a preference. Positioning the input alone hands the row back to the
  engine's track and the loaded indicator stops stating anything — measured as
  loaded against unfilled over the bar's four rows, 1.00:1 on all four on
  Chromium, 2.10:1 on the two `::-moz-range-track` covers on Firefox, 3.49:1 on the
  two WebKit's translucent track covers. And no rule silences that track while the
  native appearance is on: a `::-webkit-slider-runnable-track` painted transparent
  with no `appearance: none` beside it changes not one pixel on either engine.

  So `appearance: none`, with `::-webkit-slider-thumb` carrying
  `::-moz-range-thumb`'s declarations to the letter, and one 16px thumb drawn on
  all three. Measured on `player-seekslider--with-buffered-ranges`, on the row
  through the middle of the bar:

      ring vs unfilled track   chromium 2.48 -> 3.55   firefox 3.76 -> 3.55
                               webkit   3.76 -> 3.55
      ring vs loaded range     chromium 1.11 -> 13.73  firefox 1.03 -> 13.73
                               webkit   1.03 -> 13.73
      loaded vs unfilled       chromium 2.76 -> 3.86   firefox 3.86 -> 3.86
                               webkit   3.86 -> 3.86

  Every pixel in those pairs is now painted from this file's own tokens, which is
  why the three engines agree exactly rather than to a band, and why the two
  figures that fell did so onto a floor they clear rather than off one.

  Turning the native widget off takes `accent-color` with it, and neither Blink nor
  WebKit offers a pseudo-element for a range's filled part. `SeekSlider` therefore
  renders a new part, `seek-progress` — the span of the seek window before the
  current position, placed by the primitive like the loaded ranges beside it and
  painted by CSS. The seek slider looks the same as it did; it is drawn by
  different hands.

  Forced colors is unchanged, deliberately. There the platform draws the control
  and `seek-buffered` is opaque, so it still hides the thumb — the same defect, and
  both ways out cost more than they buy: positioning the input takes the loaded
  range from 21.00:1 to 1.00:1 on Chromium, and drawing the control by hand there
  flattens Gecko's thumb to between 2.05:1 and 2.85:1 against the canvas, which is
  the trade #190 already refused on the same measurement. Both halves of what is
  left are asserted rather than left silent.

  The contrast gate now composites a loaded range over the track it nests inside
  rather than over the ground behind it, because that is where it paints. No
  assertion is weakened: `buffered vs track` moves from 3.18:1 to 4.26:1 and `ring
vs buffered` from 9.96:1 to 13.35:1, and the seek-slider pixel test that recorded
  the failing state now records the fixed one.

  It lands as `minor` rather than `patch`: `seek-progress` is a new part, so this
  package's public surface grew, and `patch` would hide an additive API change.
  `major` is not meant — nothing a consumer wrote stops working, and at `0.x` the
  `minor` slot is where an intentional addition belongs.

- 4a3069d: `Player.Root`'s `ref` now hands back a fresh object carrying exactly the members
  `PlayerHandle` declares, and no longer the live `PlayerController` (#328).
  `Object.assign(controller, { activateFromInteraction })` used to build the
  handle, and `Object.assign` mutates and returns its target, so the ref held the
  whole controller — the narrowing `PlayerHandle` describes existed in TypeScript
  alone and was absent at runtime. The OWASP sweep on #245 reported it as **A01 /
  broken access control**.

  **This removes members that were reachable in a released version.** Off the ref,
  `setProvider`, `setActivation`, `configureAutoplay`, `subscribeDimensions`,
  `subscribeCues`, `getActiveCues`, `reportRefusedUrl` and the five `*WithOrigin`
  commands now read `undefined`, and `handle.current instanceof PlayerController`
  is now `false`. None was ever named by `PlayerHandle`, and the README has always
  documented the `ref` as receiving a `PlayerHandle`, so no documented member
  moved — but a consumer who reached past the type and called one of them is
  broken by this, and that is the point of the change rather than a side effect of
  it. Everything `PlayerHandle` names still works and still reaches the same live
  player: the handle's members are plucked off the controller, so a command sent
  through the ref is the same call it always was.

  The declared surface being honest is the whole fix; stopping the caller was
  never the goal. Per the issue's own impact bound, whoever holds the ref is
  already running same-origin script and could reach the controller other ways —
  no network input, no `postMessage` and no consumer-supplied prop leads here. What
  the leak cost was truthfulness: a reviewer auditing what a vendor overlay can do
  reads `PlayerHandle` and, before this, got the wrong answer. The failure shape
  the issue records is a first-party wrapper handing the ref to a vendor overlay
  typed against `PlayerHandle`, which could then swap the vetted adapter out with
  `setProvider` or forge `PlayerEventOrigin: 'user'` on an API-initiated command
  that a consumer's analytics or consent accounting reads as a real interaction.

  The handle's command list is no longer hand-written twice. `Root` and
  `usePlayerActions` now build it from one function in `player-context.ts`, so the
  ref's surface and the hook's surface cannot drift — and the ref's drifting is
  how a member leaks back out. `reportRefusedUrl` is the case that proved it can
  happen: it landed on the controller after the narrowing was written (#330) and
  was correctly left out of `PlayerHandle`, and the old handle exposed it anyway.

  **In-repo callers that genuinely need the controller have one escape route**, and
  it is not a new export. The handle carries a registered symbol,
  `Symbol.for('playdeck.internal.controller')`, whose value is the controller. It
  is installed with `Object.defineProperty` and so is non-enumerable: `Object.keys`
  and `JSON.stringify` drop symbol keys outright, but object spread copies
  enumerable ones, and `{...ref.current}` in a narrowing wrapper is exactly the
  failure shape above. A `@playdeck/react/testing` entry point was the alternative
  and was rejected — it would have added published surface and build configuration
  while stopping nobody. The symbol is deliberately absent from this package's
  `exports` map and from `PlayerHandle`, is not part of the public API, and is not
  covered by semver. It exists so the Storybook mock-player decorator and this
  package's own render helpers can stage a fake provider through `setProvider`, and
  it is one greppable name rather than the whole controller by default.

  It lands as `minor` rather than `patch` because a runtime surface a released
  version handed out is smaller now. The React context path is unaffected and
  always was: `usePlayerActions` already built a fresh narrowed object, `usePlayer`
  is not re-exported from the package entry, and the `exports` map is `"."` plus
  `"./theme.css"` only. `@playdeck/core` is untouched — no controller member
  changed, and nothing was added to or removed from that package.

- f0d9427: `Player.Time` renders nothing for `type="duration"` and `type="remaining"` on a
  source with no duration (#248). It used to render a literal `0:00`, which a
  viewer reads as a zero-length video rather than a live stream — and it did so
  beside a `type="current"` instance counting up, which is what makes the zero
  look authoritative rather than absent. `type="current"` is untouched:
  `currentTime` means the same thing on a live source as on a VOD one.

  **In that state the element is a `<span>`, not an emptied `<time>`.** There is
  no time to mark up, so it is not a `<time>`: one carrying neither a `datetime`
  nor parseable time-string content is invalid, and the `PT0S` that would make it
  conformant is the same zero-duration claim the text has just stopped making —
  the half of the defect `children` could never have worked around, because the
  library owns that attribute. Every hook survives the swap:
  `data-playdeck-part="time"`, `data-state="untimed"`, `data-time-type` and
  `data-provider` are all still there, and your props and `children` render as
  before. Two things do move with the tag — a selector written
  `time[data-playdeck-part="time"]` stops matching (the documented hook is
  `data-playdeck-part`, not the element type), and a `ref` receives the `<span>`.

  Because the element is no longer fixed, **`TimeProps['ref']` is now
  `Ref<HTMLElement>`** rather than `Ref<HTMLTimeElement>`. TypeScript could not
  have caught the mismatch on its own: `HTMLSpanElement` declares no member
  `HTMLElement` does not, so `HTMLTimeElement` is structurally assignable to it
  and a consumer holding `useRef<HTMLTimeElement>(null)` read
  `ref.current?.dateTime` as `string` while getting `undefined` on any live
  source. The declared surface has to be honest about what it hands back, which is
  the same reasoning #356 applied to `Player.Root`'s ref. No consumer code breaks
  — `useRef<HTMLTimeElement>(null)` and `(el: HTMLTimeElement | null) => void`
  both still assign — and the only thing lost is `.dateTime` autocomplete off the
  ref, which is exactly the member that was never guaranteed.

  A `dateTime` prop no longer reaches the DOM on an untimed source. The `<time>`
  always overrode one by ordering, but the `<span>` wrote no `datetime` of its
  own, so a consumer's passed straight through — republishing, in the form a
  machine parses, the zero-duration claim this change exists to remove. The
  library owns the attribute in both states now.

  One consequence worth planning for: `duration` is `null` until metadata arrives
  on nearly every source, so a `duration` or `remaining` instance normally starts
  as a `<span>` and is **replaced** by a `<time>` when metadata lands rather than
  re-rendering in place — a CSS transition, focus, or a `MutationObserver` a
  consumer has attached to that node resets at that moment.

  Nothing is substituted for the text, and nothing new is exported to substitute
  it with. A consumer who wants a `LIVE` badge, an em dash or an elapsed-time
  fallback composes it off `data-state="untimed"` in their own layout, or passes
  `children`, which still outrank the rendered time. That is the line
  `.out-of-scope/default-presentation-on-blocked-autoplay.md` draws for a refused
  autoplay, and it applies unchanged here: publish the state, do not materialise a
  presentation inside someone else's design. `Contract.mdx` documents the state,
  the empty text and the element.

  A source is untimed where `duration` is not a finite number, so both a `null`
  duration and the `Infinity` a live HLS stream publishes are covered. A genuine
  zero-second source is a measurement rather than a missing one: still timed,
  still a `<time>`, still `0:00`.

  It lands as `minor` rather than `patch`: what the component puts on screen
  changed, the element type and `datetime` attribute a released version handed out
  are different now, and `TimeProps['ref']` is declared wider than it was.

### Patch Changes

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

- 727a376: `Player.Poster` now stays over the frame when a play **command** is refused, not
  only when an autoplay attempt is (#244). The `loadeddata` first-frame writer
  added for #242 gates on the configured autoplay mode, so under `autoplay={false}`
  it had no mode to read and the gate was inert: a `play()` the browser rejected
  with `NotAllowedError` — from `handle.current?.play()`, from a `PlayButton`
  press, or from any `usePlayerActions` consumer — left the media paused on the
  frame it had just decoded, uncovered, with nothing on screen reporting the
  refusal. That is the defect #242 fixed, arriving through a command instead of
  through autoplay. Nothing about a refusal itself changed: it is still reported to
  the caller that issued it and to nobody else, `playback` stays `paused`,
  `autoplay` stays `idle`, and no error is set.

  The race is covered with it. A `loadeddata` can land while the `play()` promise
  is still in flight, and a promise in flight is a refusal not yet told — hide the
  poster on the decode and the rejection that follows has no way to put the cover
  back. An unsettled attempt therefore defers exactly as a settled refusal does.

  `PlayerController` gains one method, `hasUnconfirmedPlayAttempt()`, and that is
  the whole addition to `@playdeck/core`'s public API. It answers whether a play
  command was issued against the media attached now and playback never reached
  `playing` — refused, faulted, or still in flight — for whatever issued it: the
  API, a user gesture, or autoplay's own attempt. The record is dropped the moment
  a provider patch confirms playback, so a viewer who pauses does not re-arm it,
  and it is scoped to the provider generation, so attaching a provider ends it and
  the first frame of freshly attached media goes back to hiding the poster unaided.

  It is a method on the controller rather than a field on `PlayerState` on purpose.
  A refused command is a fact about the command, not about the player, and the one
  thing that needs it is the React layer's first-frame poster writer; publishing an
  attempt record to every consumer and every subscriber would be a permanent
  addition to the state snapshot made to change what exactly one internal reader
  does. `Player.Root` cannot count the calls itself either — `PlayButton` and every
  `usePlayerActions` consumer reach `play` straight from the player context and
  never through that component.

  `@playdeck/core` takes `minor` for the new public member and `@playdeck/react`
  takes `patch`: the React change is a defect fix behind an unchanged surface, the
  same level #242's own fix took, and no React prop, part or published state moved.

  **Superseded in this release by #361.** "Nothing about a refusal itself changed:
  it is still reported to the caller that issued it and to nobody else" was true
  when written and is not true of this release. #361 landed alongside it and gives
  `PlayerState` a `refusedPlay` member carrying the last refused command's `origin`
  and `CommandFailureReason`, `null` while none stands — so a refusal now reaches
  player state and any subscriber, not only the caller that issued it. The rest of
  the sentence holds: `playback` stays `paused`, `autoplay` stays `idle`, and no
  error is set. `CONTEXT.md` was corrected in the same change.

- d28f2a4: `theme.css` raises the default alphas of `--playdeck-color-track` and
  `--playdeck-color-buffered` together, from `0.3` and `0.5` to `0.36` and `0.7`, so
  every seek-slider boundary the theme paints clears the 3:1 floor WCAG 2.2 AA
  1.4.11 puts under the visual boundary of a user-interface component (#190).
  Composited over the `--playdeck-color-backdrop` default of `#000`, the unfilled
  track moved from 2.46:1 to 3.13:1 and the loaded range moved from 2.14:1 to
  3.18:1 against that track. Both stay white at an alpha: no hue, no opaque
  colour, and no hairline or outline was added to the slider parts.

  The two tokens had to move together. The track alone failed the reported check,
  but raising only the track narrows the loaded-vs-unloaded boundary — itself a
  1.4.11 concern, and already failing at 2.14:1 — to roughly 1.9:1, fixing the
  reported defect by worsening an unreported one.

  It lands as `patch`. Nothing about the documented surface changes: both values
  are still read as `var(--name, default)` and are still never declared by this
  file, so a token you set on the player or any ancestor is what applies and the
  new defaults are never consulted. Only a consumer who mounts the theme and
  overrides neither token sees a difference, and what they see is the correction.
  The forced-colors branch, which maps these parts onto system colour keywords, is
  untouched.

  `packages/react/test/theme.test.ts` now composites the token defaults it parses
  out of the shipped stylesheet, and asserts both boundaries against the 3:1 floor
  plus the exact ratio of all six slider boundaries — so a default cannot move
  without restating what it does. It is a computed check rather than an axe rule
  on purpose: axe-core implements 1.4.3, which is text only, has no 1.4.11 rule at
  all, and the composition the a11y suite scans never mounts this stylesheet, so
  an axe run passes either side of this change and reports nothing.

  Two boundaries are measured and deliberately not asserted. The thumb's
  `--playdeck-color-accent` now reads 2.59:1 against the track (it was 3.29:1) and
  1.23:1 against the buffered range (it was 1.53:1). Neither can reach 3:1 while
  the accent stays `#3ea6ff`: at a relative luminance of 0.3552 it clears 3:1 only
  against something at or below 0.0851, and the floor this change enforces puts
  the track at or above 0.10 and the buffered range at or above 0.40. Against
  opaque white — the brightest the buffered range could ever be — the accent still
  measures 2.59:1. Raising either needs a decision about the accent token, which
  is recorded on #190 and is not made here.

- 45e309e: `theme.css` now draws the ring around the Firefox slider thumb too, and draws
  that engine's track and progress fill by hand to pay for it (#190). Both sliders
  are covered. Nothing changes on Chromium or Safari — measured, not assumed: with
  the new rules in and out, their screenshots are byte-identical, because
  `::-moz-*` is inert there and needs no feature query.

  The previous change said Gecko honoured nothing on `::-moz-range-thumb` and that
  a rule naming it would be dead CSS. Pixel-differencing real builds says
  otherwise, in two parts. `outline` and `box-shadow` really are no-ops there —
  those are what had been probed. `background-color`, `border` and the thumb's own
  box metrics are honoured. What makes the ring expensive is the consequence: the
  first paint property to land on any part of a Gecko range input switches the
  native widget off for the whole control, so `accent-color` stops filling the
  progress and the native track stops painting at all. Colouring the thumb alone
  does not add a ring to the shipped slider, it deletes the slider and leaves a
  ring — and the volume slider, which the theme paints no bar for, collapses to a
  bare thumb.

  So `::-moz-range-track`, `::-moz-range-progress` and `::-moz-range-thumb` are
  one unit, and each reads a token this file already reads
  (`--playdeck-color-track`, `--playdeck-color-accent`,
  `--playdeck-slider-thickness`, `--playdeck-color-thumb-ring`). No token is
  added, no default moves, and every one is still read as `var(name, default)` and
  never declared, so one consumer value restyles every engine.

  **The three Gecko rules are held inside `@media (forced-colors: none)`,** which
  is not tidiness. Switching the native widget off also gives up the forced-colors
  rendering that came with it, and the theme's `forced-colors: active` block maps
  no range part. Measured on the volume slider in Firefox with the rules
  unguarded: the progress fill and the unfilled track both paint `rgb(255 255
255)` — one colour, 1.00:1, a slider stating no value — and the thumb reaches
  `rgb(240 240 240)` inside a `rgb(153 153 153)` border, 1.14:1 and 2.85:1 against
  the canvas. Left native, the same slider paints a `rgb(0 0 0)` fill against a
  `rgb(233 233 237)` track at 17.34:1. So the ring, which exists to buy contrast,
  steps aside in the one mode where the platform already supplies more of it than
  the ring can. Chromium renders the same row of pixels either way, forced colors
  included, because `::-moz-*` never reached it.

  Measured on the volume slider, where the theme covers the control with nothing
  and a screenshot shows the slider itself, Firefox goes from a grey native thumb
  at **2.15:1 against the filled track** to a `#000` ring at **8.10:1**, and holds
  **3.55:1** against the unfilled track. Chromium and Safari stay at 8.10:1 against
  the filled track. `e2e/thumb-contrast.spec.ts` is the gate, and it samples
  rendered pixels rather than compositing tokens: it asserts the ring reaches the
  screen as `#000` on all three engines, which is exactly what a rule that no-ops
  on its target engine cannot do.

  **Two boundaries this does not clear, both now measured and recorded rather than
  implied.** On Blink and WebKit the volume slider's unfilled track is the
  engine's own and the theme never colours it, so the ring reads 1.87:1 and 1.07:1
  there. And the seek slider fails the loaded-range boundary on all three engines,
  and the unfilled-track one on Blink: `SeekSlider` renders `seek-buffered` before
  the input and this file positions it absolutely while the input stays in flow,
  so the theme's own translucent bar paints over the native control and lifts the
  whole thumb towards white — a `#000` ring reaches the screen as `rgb(92 92 92)`
  under one veil and `rgb(206 206 206)` under two. No ring colour escapes that,
  because the veil puts a floor under how dark the ring can land and a ceiling
  under how light. WebKit was read wrong at first: the bar sits one pixel lower
  than the input's own centre line there, so a sample taken on that centre line
  met the engine's near-black native track and never the bar. It reaches the
  screen on WebKit like everywhere else, and `e2e/thumb-contrast.spec.ts` picks
  its row from `seek-buffered` rather than from the input for that reason. That
  overlay is owned by #415 — in forced-colors mode it is opaque rather than
  translucent and hides the seek thumb outright, on every engine and on both sides
  of this change.

  Those are the ratios the token arithmetic in `packages/react/test/theme.test.ts`
  cannot see, and both test files now say so. Clearing them means `appearance:
none` and a hand-drawn control on all three engines, which is a larger change
  than #190 decided on.

  **Superseded in this release by #415.** That larger change arrived in the same
  release, for the overlay rather than for the ring: the seek slider takes
  `appearance: none`, the bar behind the input becomes its track, and the thumb is
  hand-drawn on all three engines. Both of that slider's boundaries clear there
  now — 3.55:1 against the unfilled track and 13.73:1 against a loaded range, the
  same figure on Chromium, Firefox and WebKit, because every pixel in each pair is
  painted from this file's own tokens. What it costs is `accent-color` on the seek
  slider: Blink and WebKit lose it there with the native widget, as Gecko already
  had. The volume slider is untouched by that change and its two boundaries stand
  as measured above — nothing is painted over that control, so it had no overlay
  to remove — and forced colors is unchanged, so the opaque overlay named above
  still hides the seek thumb there.

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

- `Player.SeekSlider` now derives its default `step` from the window it renders
  instead of always rendering a whole second (#431, closing
  [#383](https://github.com/pedrosousa13/playdeck/issues/383)).

  A range input can only express the values its own grid holds, and the grid was a
  fixed one second against `[0, duration]`. On the ~1s clip the e2e suite and the
  reference example both use, that is two positions: the thumb sat hard left for
  the first half of the clip and hard right for the second, and a `Home` or `End`
  press from mid-clip moved nothing, fired no change event and seeked nowhere — on
  all three engines. Nothing downstream was broken; there was simply no event for
  the library to act on.

  `seekStep` now answers `Math.min(1, span / 20)`. A window narrower than twenty
  seconds gets twenty positions rather than two; every clip of twenty seconds or
  more keeps exactly the numbers it had, because the cap is the same second it
  always rendered. A span of zero or `NaN` divides to nothing an input can hold and
  falls back to that second. An infinite span — what a live HLS source publishes
  for its duration — reaches the same second through the cap instead, which is the
  right answer either way: an unbounded window has no extent to divide.

  The seek echo tolerance moves with it rather than staying pinned to a literal.
  It is derived from the step the control is actually rendering and stays under it
  deliberately: a tolerance wider than one native step would read the time from
  _before_ a step as an answer to that step and snap the thumb back.

  `patch`, not `minor`: no prop, part or published state moved, and the constant
  behind the cap is module-private. A consumer passing its own `inputProps.step`
  overrides the derivation exactly as it did before. What changed is the value the
  control renders when it is not told one, which is a defect fix behind an
  unchanged surface — the same level #242's own fix took.

- a2c67a5: `theme.css` draws a ring around both slider thumbs, from a new
  `--playdeck-color-thumb-ring` token defaulting to `#000`, so the thumb clears the
  3:1 floor WCAG 2.2 AA 1.4.11 puts under the visual boundary of a user-interface
  component (#190). Composited over the `--playdeck-color-backdrop` default of
  `#000`, the ring measures 3.13:1 against the unfilled track and 9.96:1 against
  the loaded range, and the accent fill measures 8.10:1 against the ring itself.
  `--playdeck-color-accent` is unchanged at `#3ea6ff`.

  A ring rather than a different accent, because no accent value exists. At the
  track and buffered defaults, a colour clearing 3:1 against the loaded range needs
  a relative luminance at or above 1.4440 or at or below 0.1160 — and 1.4440 is
  brighter than white, whose luminance is 1.0. The only colour satisfying both
  surfaces is pure black, which reads as a gap in the bar rather than the control
  you drag. 1.4.11 asks for contrast on the visual information that identifies the
  component, and a boundary supplies that as well as a fill does. This settles what
  the previous change deferred: the accent fill still reads 2.59:1 against the
  track and 1.23:1 against the loaded range, and those two boundaries are now
  carried by the ring instead of by the fill.

  It lands as `patch`. The ring is read as `var(--playdeck-color-thumb-ring, #000)`
  and is never declared by this file, so a value you set on the player or any
  ancestor applies and the default is never consulted; `outline: none` on the thumb
  removes it entirely. Only a consumer who mounts the theme and overrides nothing
  sees a difference. The forced-colors branch, which maps these parts onto system
  colour keywords, is untouched.

  **Firefox is not fixed by this, and still fails 1.4.11.** Painted with `outline`
  on `::-webkit-slider-thumb`, with no `appearance: none` — that is what keeps
  `accent-color` painting the rest of the control. Measured on the three engines
  the e2e suite runs: Blink honours either `outline` or `box-shadow` on the thumb
  with `accent-color` intact, WebKit honours only `outline`, and Gecko honours
  neither. The only properties that reach `::-moz-range-thumb` are ones that switch
  native theming off, taking `accent-color` and the whole painted slider with them,
  so there is no Gecko rule to write. Firefox therefore keeps the thumb it renders
  today, which measures **1.20:1 against the track and 2.64:1 against the loaded
  range** — both under the 3:1 floor. That gap stays owned by #190.

  Worth knowing why those numbers are not the accent's: the thumb is only
  accent-coloured on Blink. Measured with this stylesheet mounted over the backdrop
  default, Blink paints it `rgb(62 166 255)`, WebKit paints it white, and Gecko
  paints it `rgb(103 103 116)`; on WebKit and Gecko `accent-color` tints the filled
  track and leaves the thumb alone. So the ring is not only correcting the accent —
  on WebKit the white thumb already cleared the track at 6.71:1 but failed the
  loaded range at 2.11:1, and the ring fixes a real failure there too.

  This is the theme's first selector that is not specificity-zero: a pseudo-element
  may not appear inside `:where()`, so the rule carries that pseudo-element's own
  (0,0,1), which any single class of yours outranks. The guarantee that matters is
  unchanged — the rule is inside `@layer playdeck`, and unlayered CSS beats a
  cascade layer whatever its specificity.

  `packages/react/test/theme.test.ts` composites the new token default out of the
  shipped stylesheet alongside the others, asserts the three ring boundaries
  against the 3:1 floor, and states the exact ratio of all nine slider boundaries,
  so a default cannot move without restating what it does. It also freezes
  `::-webkit-slider-thumb` into the CSS-feature inventory that guards the declared
  browser-support floor.

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
- Updated dependencies
- Updated dependencies [8624a2e]
- Updated dependencies [07180ca]
- Updated dependencies [8157f0a]
- Updated dependencies [86fc6f0]
- Updated dependencies [a30e040]
- Updated dependencies [9874c90]
  - @playdeck/core@0.2.0
  - @playdeck/provider-native@0.2.0
  - @playdeck/provider-vimeo@0.2.0
  - @playdeck/provider-wistia@0.2.0
  - @playdeck/provider-youtube@0.2.0
  - @playdeck/provider-hls@0.1.1

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
