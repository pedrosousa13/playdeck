# Reely

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
A named element in the rendered DOM, identified by `data-reely-part`. One
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

### Adapters

See [ADR-0004](docs/adr/0004-cross-provider-options-live-on-root.md) for what
makes a setting Reely's own prop rather than a key in one provider's option bag.

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
Severity is a separate label and gates nothing.
_Avoid_: affected, vulnerable

**Shipped**:
What the audit report calls a reachable advisory, against `not shipped` for one
it prints and tolerates. A critical in the linting toolchain is not shipped; a
low under a published package's `dependencies` is.
_Avoid_: production, runtime
