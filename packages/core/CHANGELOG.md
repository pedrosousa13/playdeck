# @playdeck/core

## 0.2.0

### Minor Changes

- ecfef8b: A refused play command now reaches player state. `PlayerState` gains
  `refusedPlay`, which carries the last play command that was turned down against
  the media attached now — an `origin` and a `CommandFailureReason` — and `null`
  while none stands (#361).

  Before this, a refusal existed only as the `CommandResult` returned to whoever
  called `play()`. Under `autoplay={false}` a `NotAllowedError` left `playback` at
  `'paused'`, `autoplay` at `'idle'` because that machine never engaged, and
  `error` unset, so nothing subscribable moved. A consumer calling
  `handle.current?.play()` could at least read the result. A consumer whose viewer
  pressed `PlayButton` could not read anything at all: the button issues the
  command on the viewer's behalf and discards the result, so the one party who has
  to present the outcome never saw one. `refusedPlay` is what they subscribe to,
  and no React change was needed to get it — the press already routes through the
  same command funnel as every other play.

  **Why this is a state field when #244's attempt record deliberately was not.**
  That decision reasoned that a refusal is bookkeeping about a command, reported to
  the caller that issued it and to nobody else. The first half still holds and the
  second half is what #361 disproved: a `PlayButton` press has no caller in that
  sense. Where the library issues a command on a viewer's behalf and throws the
  answer away, "reported to the caller" reports it to nobody. So a **settled**
  refusal is a fact about the player that outlives its command and belongs on
  state, while an attempt **still in flight** is a property of the command alone
  and stays where #244 put it. `hasUnconfirmedPlayAttempt()` is unchanged and is
  still the poster writer's, for exactly the in-flight case this field cannot
  answer.

  **Beside the blocked-autoplay state, not folded into it.** `autoplay` keeps
  `'blocked'` and `'failed'`: it reports the autoplay machine, whose
  `'attempting'`, `'suppressed'`, `'started'` and recovered members are states no
  record of a refusal could carry. What the new field subsumes is the _question_ —
  "was a play refused, and who asked for it" — for every trigger at once. There
  are not two independent ways to observe a refusal to choose between. An autoplay
  refused by policy appears in both, and `refusedPlay.origin` is `'autoplay'`,
  which is the whole story about which applies when: ask `refusedPlay` about the
  refusal, ask `autoplay` about autoplay. A viewer's refused press is
  `origin: 'user'`; an untagged `play()` is `origin: 'api'`.

  **Lifecycle.** A refusal is a moment and a field is a condition, so what is
  published is the condition: _the last play command was refused and nothing has
  played since_. It is set when a play command settles unsuccessfully, replaced by
  a later refusal, and cleared by exactly two transitions. The first is **a
  provider patch that confirms playback** — not the play promise resolving, since
  playback is what a provider reports, and not only the patch answering the retry,
  because any play that starts clears it, autoplay's own muted recovery and the
  viewer working the provider's native controls included. That is the same site
  and the same moment at which #244's attempt record is dropped, which is
  deliberate: the two describe the same window and must not disagree about when it
  closed. The second is **the provider changing** — attach, swap and detach all
  end it, so a new source never inherits the last one's refusal, and that is where
  it parts company with a refused-URL notice, which survives an attach because a
  notice describes a consumer prop no provider ever saw while this describes a
  command one provider turned down. Nothing else clears it, and that is the point
  of stating it as a condition: a pause, a seek, a stall or a later error leaves a
  refused play exactly as refused as it was, and a consumer presenting it is not
  made to guess when to stop.

  **The condition holds under out-of-order settlement**, which is the part that
  takes real work, because a play command can settle long after the player has
  moved on. Each play command is recorded as its own attempt, and a refusal is
  published only where that attempt is still the one standing: a later play
  replaces it, and the patch that confirms playback clears it, so a command
  refused after another play succeeded — or after the viewer started playback from
  the provider's own controls — publishes nothing, and a pause arriving in between
  does not hand the refusal back. A refusal against media that is playing right
  now is dropped for the same reason: it would state that nothing has played since
  while something demonstrably is, and the clearing rule would take it back on
  whichever unrelated patch happened to arrive next. Publishing it anyway, on the
  grounds that a command really was refused, was the alternative, and it was
  rejected on those two grounds — a self-contradicting snapshot, and a lifetime
  decided by a `timeupdate`. Nothing is withheld from the party with a stake in
  it: the caller of every one of these commands receives the same `CommandResult`
  as before, and the field exists for the consumer who is _not_ the caller, to
  whom "your play was refused" over playing media is not a true thing to say.

  **What a subscriber sees during an `'audible-then-muted'` recovery**, since it
  follows from the above: the audible refusal is published as soon as it settles,
  while `autoplay` still reads `'attempting'` and the muted retry is still in
  flight, and it clears when that retry starts playback. Both states are true when
  they are published — a play really was refused, and the machine really is still
  attempting — so a consumer presenting `refusedPlay` on its own will show a
  refusal that then goes away. `autoplay` is what says the machine has not settled
  yet; gate on it where a refusal should only be presented once nothing more is
  coming.

  **What did not change.** The `CommandResult` handed back to a direct caller is
  untouched, byte for byte, including the `PlayerError` a refusal carries.
  `playback` still stays `'paused'` through a refused play, `autoplay` still stays
  `'idle'` where the autoplay machine never ran, and the error slot is still not
  filled — `keeps confirmed paused state when the media play command rejects`
  passes unchanged. `@playdeck/react` is not listed here at all — it ships no
  behaviour change, and takes only the dependency patch every dependent gets:
  `PlayButton` still discards its command result, which after this costs a consumer
  nothing, and no primitive, prop or part presents the refusal. That decision
  stands and is recorded in
  `.out-of-scope/default-presentation-on-blocked-autoplay.md`, which #361 updates:
  this is the primitive that file's composed path assumes, supplied rather than
  reopened.

  The refusal deliberately does **not** carry the `PlayerError` from the command
  result. The state has one error slot, `ErrorDisplay` renders whatever is in it,
  and filling it on a refused play would ship exactly the default presentation
  that file declines. Repeating the error inside `refusedPlay` instead would give
  one `PlayerError` two homes with two clearing rules. `reason` is what a consumer
  branches on, and the copy is theirs to write.

  A provider cannot forge one: `ProviderStatePatch` is a `Partial<PlayerState>`,
  so the key is in every patch's reach, and the field is filled from the
  controller's own record and never from the patch — the same rule
  `autoplayRecovered` already keeps.

  `CONTEXT.md` gains a **Refused play** term and qualifies **Unconfirmed play
  attempt**, whose "reported to the caller and to nobody else" no longer describes
  what the library does.

- b5fa01a: `detectSource` now refuses a **short-host YouTube URL whose only path segment is
  a full-host path keyword** — `watch`, `embed`, `live`, `shorts` or `playlist`,
  in any case — instead of reading that segment as the video id (#395).

  `https://youtu.be/watch?v=dQw4w9WgXcQ` used to detect, and to detect as
  `{ type: 'youtube', videoId: 'watch' }`. On a short host the whole first path
  segment is the id, and `watch` is a valid id _shape_, so the `v` parameter
  carrying the real id was never consulted. It is a plausible URL to write by
  hand: a consumer who knows `youtube.com/watch?v=<id>` works, and knows
  `youtu.be` is the short domain, may combine them.

  **The failure it removes is a silent one.** Detection reported success, so the
  player loaded the YouTube provider, asked for a video called `watch`, and failed
  at YouTube with no Playdeck error at all. The refusal is the same
  `malformed-string` every other unreadable provider URL gets — no new reason and
  no new message — so the consumer meets the named, actionable error that quotes
  the value it turned down, rather than a player that never plays.

  **Refused, not interpreted.** Reading `v=` when the segment is `watch` would
  have made the URL work, and would have taught a form YouTube does not serve and
  committed this library to supporting it. A URL this library invents is a URL it
  then owns.

  **The keyword set is derived, not duplicated.** The five keywords are named once
  each in `source-detection.ts`, and the list this rejection reads is assembled
  from those names rather than written out a second time. A path added to the full
  hosts is therefore excluded from the short hosts by the same edit that adds it —
  without that, `/live/` (added earlier in this release, #379) would have been readable
  as the id `live` on `youtu.be`, which is the same bug in a new spelling.
  `playlist` is in the set for the short hosts' sake: a full host reads no video
  out of `/playlist?list=<id>` and so refuses it already, and naming it as a
  keyword closes the short-host hole without changing the full hosts at all.

  **Case-insensitive on the short hosts, and only there.** The full-host `/watch`
  comparison stays exact, because the two hosts fail differently: `/Watch` on a
  full host is refused loudly, while on a short host it _succeeded_, with an id no
  video answers to. Folding case cannot cost a legitimate id — the comparison is
  still an exact one against the whole segment, the segment is `[A-Za-z0-9_-]+`
  and so is ASCII, which lowercases without changing length, and the keywords are
  four to eight characters against YouTube's eleven-character ids.

  **What still detects.** `https://youtu.be/<id>` is untouched for every id that
  is not one of the five keywords. The rejection keys on the keyword set alone and
  never on length or plausibility, so `watchAgain1`, `rewatching1`, `watch-later`
  and the single-character `w` all resolve to themselves — this library constrains
  an id to `[A-Za-z0-9_-]+` and does not enforce YouTube's own length.

  **Why `minor`.** This narrows what `detectSource` accepts, which is the opposite
  direction to the widening earlier in this same release (#379), and a narrowing has to answer for
  what it takes away. It takes away nothing that worked. Every form that changed
  resolved to the keyword itself as the video id — `watch`, `playlist`, `ShOrTs`
  and the like — and no YouTube video answers to any of them, so each one built a
  player that could not play. A sweep of 347 URL forms through the built package,
  before and after, moved 108 rows and no others: the five keywords in eighteen
  case spellings, on both short hosts, with a `v` query, with a `list` query and
  with none, every one of them accepted → refused. Every other form — the full
  hosts' five accepted shapes, the three forms #379 added earlier in this release, Vimeo,
  Wistia, and the file and manifest shapes — resolved exactly as before.

  `major` would ask a consumer to do something before upgrading and would take
  this package to `1.0.0`, neither of which is meant: at `0.x` the `minor` slot is
  where an intentional behaviour change belongs. `patch` would hide a public
  function answering differently for an input it already answered for. A consumer
  who was passing one of these URLs will now see a refused-source error where they
  previously saw a stuck player, and the fix is the one the error already points
  at: pass `https://youtu.be/<id>`, or the full-host `watch?v=` form.

  `@playdeck/react` is not bumped and takes only the dependency patch every
  dependent gets. `Root`'s `source` prop hands the string straight to
  `detectSource`, and neither the prop type, the detection call, nor the error
  published for a refusal moves here.

  `docs/provider-setup.md` documented this form as "a trap" a reader had to avoid
  and now lists it among the refused shapes.

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

- 8624a2e: `detectSource` now reads three URL forms it used to turn down, each of them a
  form a provider hands a consumer directly (#379):

  - **`https://vimeo.com/<id>/<hash>`** — the share link Vimeo hands out for an
    unlisted video, and the form copied out of Vimeo's own UI.
  - **`https://youtube.com/live/<id>`** — the canonical URL for a live broadcast.
  - **`https://youtube-nocookie.com/embed/<id>`**, and the `www.` spelling — the
    privacy-preserving host.

  None of the three was refused by the shared allowlist, so nothing unsafe was
  being kept out and nothing unsafe is being let in. They were refused by shape,
  and the refusals were safe and wrong: the same unlisted Vimeo video was already
  accepted two other ways (`?h=<hash>`, and the `player.vimeo.com` path), so the
  library supported the case and simply did not recognise the URL the provider
  gives you.

  **The Vimeo hash reaches the source, and that is the point.** A form that
  detected but dropped it would build a player that cannot load the unlisted
  video and would report no error at all — worse than the refusal it replaces.
  The canonical host reads the hash from the same trailing segment the
  `player.vimeo.com` path already read, so the three forms of one unlisted video
  now resolve to one identical `VimeoSource`. Where a query hash and a path hash
  both arrive, `?h=` still wins.

  **The no-cookie host needs nothing downstream, and gets nothing.** A
  `YouTubeSource` is a video id and carries no host, so a source URL cannot ask
  for an embed origin — only `providerOptions.youtube.host` can. It does not need
  to: `@playdeck/provider-youtube` already requests
  `https://www.youtube-nocookie.com` whenever no `host` is given, so a consumer
  who chose that host for privacy is served from the host they chose. Accepting
  it in detection cannot hand them the cookie-bearing origin.

  **Two consequences worth reading before upgrading**, both of them widenings and
  neither of them a form that previously worked changing:

  - The no-cookie host joined the **full hosts**, so it reads every full-host
    shape — `/watch?v=`, `/embed/`, `/live/` and `/shorts/` — not `/embed/`
    alone. Membership of that list is what a host has; a shape allowed on one
    full host and refused on another would be a new rule, not a smaller change.
    A URL in any of those shapes resolves to the same video id it would on
    `youtube.com`, and loads from the same default origin.
  - `https://vimeo.com/<id>/<trailing-segment>` is now read as an unlisted hash
    whenever that segment is `[A-Za-z0-9]+`, because that **is** the accepted
    form — a hash is not distinguishable from any other alphanumeric segment, on
    this host or on `player.vimeo.com`, where it has always been read this way.
    A URL of that shape that was not a share link resolves to a video id and a
    hash Vimeo will not recognise, where before it was refused outright.

  Each widening is bounded to one extra path segment. A trailing slash, an empty
  hash, a doubled slash and a third segment stay refused on both Vimeo hosts;
  `/live/` reads one id segment and reads it on the full hosts only, exactly as
  `/embed/` and `/shorts/` do. One refusal changed its **reason** without changing
  its answer: a bad path on the no-cookie host now reads as _not readable_ rather
  than _will not play_, because the host is recognised now and the path is what
  fails — the same way `https://www.youtube.com/<id>` already read.

  **Why `minor`.** This is an intentional behaviour change, so the level has to be
  argued rather than assumed. What moved is one direction only: the set of strings
  `detectSource` accepts grew, and nothing left it. No type, signature or field
  changes, no reason a consumer branches on is retired, and every URL that
  resolved before this resolves to the same source after it — the sweep behind
  this change checked that rather than assuming it. So no consumer upgrading can
  find a URL that stopped working; they can only find one that started. `patch`
  would understate a public function answering for inputs it did not answer for
  before, which is the surface growing. `major` would claim there is something to
  do before upgrading, and there is nothing: the one thing a consumer might be
  surprised by is the second consequence above, and that is a refusal becoming an
  acceptance, not an acceptance changing its answer.

  `@playdeck/react` is not bumped, and takes only the dependency patch every
  dependent gets. `Root`'s `source` prop is where most consumers will meet this
  widening, but it hands the string straight to `detectSource` — neither the prop
  type, the detection call, nor the notice published for a refusal moves here.

  `docs/provider-setup.md` listed all three as refused and now lists them as
  accepted, alongside the boundaries above.

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
