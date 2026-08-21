# Playdeck

A headless video player: React primitives over a framework-agnostic core, with
provider adapters for native media, HLS, YouTube, Vimeo and Wistia. The
project's language separates what a consumer composes (primitives), what they
can target (parts), what they may restyle (structural geometry, appearance,
tokens), what they can read but not set (outputs), and how a player gets from
mounted to playing (activation, then lifecycle).

## Language

### Composition

See [ADR-0005](docs/adr/0005-the-shortcut-layer-owns-its-keys-on-a-range-input.md)
for why the shortcut layer claims its keys on a focused range input rather than
conceding them to the control.

**Primitive**:
An exported React component a consumer composes into a player, such as
`Player.PlayButton` or `Player.Media`.
_Avoid_: component, widget

**Part**:
A named element in the rendered DOM, identified by `data-playdeck-part`. One
primitive may render several — `ErrorDisplay` renders `error`, `error-message`
and `error-retry` — so a part name is not a primitive's name.
_Avoid_: element, node, slot

**Viewport**:
The player's own bounding box, rendered by `Player.Viewport`, which every
overlay positions against. Not the browser viewport.

**Provider**:
The integration that drives playback for one kind of source — native, HLS,
YouTube, Vimeo or Wistia. The object implementing one is a provider adapter.
_Avoid_: engine, backend, player

**Source**:
What a consumer asks the player to play: a URL string, or a resolved descriptor
naming its kind. Distinct from the `<source>` elements the native provider
renders.

**Shared allowlist**:
The one rule (`isPermittedSourceUrl` / `resolveNetworkPath`, `@playdeck/core`)
for whether a URL the library did not construct is carried forward: `http:`,
`https:` and the scheme-less forms are permitted, `blob:` only for a `video`
source, and everything else is refused. Governs source detection, every
consumer-supplied URL prop and provider option alike (#219, #236). A refused
value is treated exactly as if the prop were absent — never a throw.
_Avoid_: whitelist, sanitise, safe URL

**Refused surface**:
The name of one consumer-supplied URL prop the shared allowlist can refuse
outside a provider, published as the closed union `RefusedUrlSurface`:
`poster src`, `poster srcSet`, `nativePoster`, `textTracks src` and
`mediaSession artwork`. A surface names the prop an operator has to go and fix
and never the value that was refused, so a Notice built from one carries no
consumer text at all. It is a prop name, not a component instance: several
instances can refuse the same surface at once.
_Avoid_: field, key, call site

**Refused source**:
The `source` prop turned down before any provider is constructed — by the shared
allowlist, or by source detection failing to read a video out of it. Published
as an `unsupported` error whose message names which of the three detection
failures occurred **and quotes the offending value**, truncated, escaped by the
text child that renders it. Never recoverable: the same prop re-read is refused
by the same rules, so no control offers a retry.

Quoting the value is what separates this from a **Refused surface**, and the
reason is structural rather than a difference of opinion about disclosure. A
source is one prop holding one value, so naming the value _is_ naming what to
fix. A surface can be refused by several component instances at once, so no one
value describes the refusal and the prop name is the only honest thing to
report. Neither is a Notice: a refused source is a failure with no fall-back.
_Avoid_: bad source, invalid URL, unsupported source

**Shortcut layer**:
The media keys `Player.Controls` owns. One binding maps keys to one action —
`seekForward`, `toggleMuted` — and a consumer rebinds or suppresses a binding
through `shortcuts` without restating the rest. Scoped to the region unless
`global` moves it to the document.
_Avoid_: hotkeys, key handler, keymap

**Requested value**:
The value a user last asked a control for — a volume, a seek position — shown in
place of published state until the player answers for it. Held over the round
trip because published state moves only on the media element's own asynchronous
events, so a control rendering it alone restores the old value and swallows the
next press.
_Avoid_: optimistic value, pending value

**Command chain**:
How a control's changes reach the player: one command in flight at a time, with
a value asked for during it overwriting the value queued behind it rather than
joining a queue. It coalesces the traffic only — every change still moves what
the control shows.
_Avoid_: queue, debounce, throttle

**Echo**:
A published value that answers the request that caused it, within the tolerance
that control's own domain sets, and so releases it. A request nothing echoes is
released by its deadline instead.
_Avoid_: confirmation, acknowledgement

**Requested origin**:
Where a command the library issued came from — a control a person operated, an
untagged public command, an autoplay attempt. Held from the moment the command
is issued until the provider reports the change that confirms it, and used in
place of the `provider` an adapter stamps every report of its own with. Distinct
from a requested value: this is who asked, not what for.
_Avoid_: source, trigger, cause

**Chapter**:
One named division of a video's timeline, published as an ordered collection on
player state beside a capability that says whether the provider can report any
at all. No provider reports where a chapter ends, so every end is derived: each
chapter ends where the next begins, and the last where the media does.
_Avoid_: segment, marker, cue point

### Loading

**Activation**:
The player's lifecycle before a provider attaches — whether loading has been
permitted, started, or failed. Reaches `ready` when a provider takes over.
_Avoid_: startup, boot, init

**Lifecycle**:
Whether media is loaded and playable. Derived from activation until a provider
attaches, and the provider's own from then on.
_Avoid_: status, phase

**Activation identity**:
The source, loading strategy and configuration an activation commits to. Change
any of the three and the commitment made under the old one is retired.

**Committed source**:
The source whose media element may mount, because its activation identity
matches the one activation committed to.
_Avoid_: eligible media

**Recovered autoplay**:
Playback that started only because the audible attempt was refused by policy and
the muted retry behind it played. Reported next to the `started` autoplay a
recovery does not change, and reachable from the `audible-then-muted` mode only.
_Avoid_: autoplay fallback, muted fallback

**Suppressed autoplay**:
An autoplay that stays configured and is deliberately never attempted, because
the viewer matches `prefers-reduced-motion: reduce`. Distinct from an autoplay
that was never configured, and from one a browser refused: nothing was asked of
the provider at all.
_Avoid_: skipped autoplay, disabled autoplay, cancelled autoplay

**Unconfirmed play attempt**:
A play command issued against the media attached now, for which playback has
never reached `playing` — refused, faulted, or still in flight. Whatever issued
it counts: the API, a `PlayButton` press, or autoplay's own attempt. It is
bookkeeping about a command rather than a fact about the player, so it lives on
the controller and not in player state, and the one reader is the first-frame
poster writer, which must not uncover a frame a refusal left paused (#244).
Dropped by any provider patch that leaves playback at `playing`, and scoped to
the generation, so attaching a provider ends it. "Confirmed" here is the
confirmation a Requested origin waits for — the provider reporting the change a
command asked for — and not the published answer Echo names, which is why
Echo's _Avoid_ list does not reach it.

The in-flight half is what keeps this off player state, and it is the whole of
what is left there: a command still settling is a property of the command and
of nothing else. The settled refusal is a **Refused play** and is published
(#361).
_Avoid_: play in progress, unacknowledged play

**Refused play**:
The last play command turned down against the media attached now, published on
player state as an origin and a `CommandFailureReason` — never the
`PlayerError` the command result carried, because the state's one error slot is
not a refusal's to take and presenting one is the consumer's decision. One
field answers "was a play refused, and who asked", for every trigger, so no
consumer assembles that answer out of two unrelated fields. It sits beside the
autoplay state and subsumes neither `blocked` nor `failed`: autoplay reports its
own machine, whose attempting, suppressed, started and recovered members no
refusal record could carry, so an autoplay refused by policy shows in both and
the `autoplay` origin is what says which it was.

A refusal is a moment and a field is a condition, so what is published is the
condition: the last play command was refused and nothing has played since.
Cleared by the provider patch that confirms playback, whichever play started
it, and by the provider changing — and by nothing else, because a pause, a
seek, a stall or an error leaves a refused play exactly as refused as it was.
That second clearing rule is where it parts company with the refused-surface
half of a **Notice**, which survives an attach: a notice describes a consumer
prop no provider ever saw, while this describes a command one provider turned
down, so replacing that provider is what stops it being true.

Commands settle out of order, and the condition survives that: a refusal a later
play replaced, one playback was confirmed after, and one refused while media is
already playing are all dropped rather than published, because each would state
a thing that had stopped being true. The caller of such a command still receives
its command result — this term names what is published, not what is reported.
_Avoid_: play error, blocked play, failed play

### Adapters

See [ADR-0004](docs/adr/0004-cross-provider-options-live-on-root.md) for what
makes a setting Playdeck's own prop rather than a key in one provider's option bag.

**Seam**:
A part of a provider adapter that exclusively owns one slice of the adapter's
state and the commands over it — playback, presentation, tracks and captions,
attachment, and whatever else a platform demands, such as HLS's quality levels
and fatal-error recovery. Exclusive ownership is the whole test, so the list is
open rather than closed, and a seam is named for the slice it owns.
_Avoid_: layer, subsystem

**Attachment**:
An adapter's binding to its media element — attach, load, listener wiring and
teardown. Not Lifecycle, which is what the player state reports.
_Avoid_: adapter lifecycle, setup

**Fan-out**:
One emit delivered to every listener in a subscriber set — state, dimensions or
cues. Isolating a listener that throws is the emitter's duty, not the
subscriber's: the rest of the set is owed that notification. Not the single call
a `subscribe` makes at registration, which runs on the subscriber's own stack.
_Avoid_: broadcast, notify loop

**Notice**:
A non-fatal `configuration` error published to report a consumer-supplied value
that was rejected, or one accepted and then impossible to apply, while the
fall-back behaviour it degraded to stands unchanged. A provider reports one
through a state patch; a consumer-supplied URL prop the shared allowlist refuses
— every one except `source`, which is a **Refused source** and reports its own
value — is reported by `reportRefusedUrl`, which names the refused surface and
never the value, and which returns a disposer the reporter holds for as long as it keeps
refusing that surface — so the notice stands while any reporter's registration
stands, and is withdrawn only by the reporter that made it. Held as controller
state and surfaced on `PlayerState.error` like any other error, but never a
failure: it never masks a standing error, and it never drives a transition into
the error lifecycle.
_Avoid_: warning, soft error

**Aurora**:
Wistia's current player generation — the `<wistia-player>` custom element the
Wistia provider targets, and the only one it supports. Named here because the
distinction is load-bearing: Wistia's legacy player (the `E-v1.js` script tag
and `window._wq`) has a different API and a different embed, and the provider
deliberately drives neither.
_Avoid_: the Wistia SDK, the Wistia embed

### Styling

See [ADR-0001](docs/adr/0001-structural-css-ships-inline.md) for why structural
geometry and appearance are separate, and
[ADR-0002](docs/adr/0002-published-measurements-are-outputs.md) for why an
output is not a token.

**Structural geometry**:
The positioning a primitive needs in order to function — stacking, insets, the
media element filling its viewport. Set inline by the primitive, ahead of the
consumer's `style` prop.
_Avoid_: layout CSS, base styles

**State-derived property**:
A style property a primitive computes from player state, such as `Poster`'s
`visibility`. Set inline by the primitive after the consumer's `style` prop,
because overriding it would pin a state machine rather than adjust layout.
_Avoid_: output

**Appearance**:
Everything a player can look like without changing what works — colour, radius,
typography, and sizing that is an opinion rather than a requirement. What the
optional stylesheet carries.
_Avoid_: theming, skin

**Token**:
A CSS custom property a primitive reads inline with a fallback, so a consumer
can change a value from a stylesheet without importing one.
_Avoid_: variable, custom property

**Output**:
Something the library states about itself for a consumer's CSS or tests to
read — a part name, a `data-state`, or a measurement written as a CSS custom
property. The library writes it and the consumer reads it, the opposite
direction to a token.

### Dependency audit

**Publishable**:
A workspace package whose `package.json` does not set `private`, so npm would
accept it. `scripts/workspace-packages.mjs` holds the one definition, and both
the audit gate and the packaging harness draw their boundary from it.
_Avoid_: public, released

**Reachable**:
An advisory whose resolved version appears in the transitive `dependencies`
closure of at least one publishable package. What the audit gate turns on.
Severity is a separate label and gates nothing. A floored package fails the same
gate on its own.
_Avoid_: affected, vulnerable

**Shipped**:
What the audit report calls a reachable advisory, against `not shipped` for one
it prints and tolerates. A critical in the linting toolchain is not shipped; a
low under a published package's `dependencies` is.
_Avoid_: production, runtime

**Floored**:
A package in a publishable package's `dependencies` closure that an `overrides`
entry in the root `pnpm-workspace.yaml` resolves — holding it to a version range,
or replacing it outright with an alias, a tarball or a workspace link. The audit
gate fails on one whether or not any advisory is reachable, and prints it as
`FLOORED`: the entry governs this workspace but is written into no published
`package.json`, so it rewrites the graph the gate measures while a consumer
resolves something the gate never saw (#335).
_Avoid_: overridden, pinned

**Suppressed**:
An advisory an `auditConfig` entry in the root `pnpm-workspace.yaml` removes
from the audit report — `ignoreGhsas` by advisory id, `ignoreCves` by CVE. pnpm
applies both while it builds the report, so a suppressed advisory is absent from
the gate's input rather than labelled in it, and reachability cannot be computed
for it at all. The audit gate fails on any entry carrying an identifier and
prints it as `SUPPRESSED`. Distinct from **floored**, which changes what the
graph resolves to; this changes what the gate is shown (#337).
_Avoid_: ignored, allowlisted, accepted

**Governed**:
An install the root `pnpm-workspace.yaml` reaches — its advisory floors, its
`minimumReleaseAge` cooldown and that cooldown's exclusions. The packaging
fixture installs outside the repository, so the root file travels into the temp
directory with it rather than the fixture being an exception (#336).
_Avoid_: audited, protected, safe

**Replayed**:
An install that reuses a committed lockfile's resolutions instead of resolving
afresh from the registry. `reresolvedPackages` compares the two lockfiles
afterwards, so replay is proven per run rather than assumed of the flag that
asked for it.
_Avoid_: frozen, cached, pinned
