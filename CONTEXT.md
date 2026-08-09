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
