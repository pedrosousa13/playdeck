# Reely

A headless video player: React primitives over a framework-agnostic core, with
provider adapters for native media, HLS, YouTube and Vimeo. The project's
language separates what a consumer composes (primitives), what they can target
(parts), what they may restyle (structural geometry, appearance, tokens), and
how a player gets from mounted to playing (activation, then lifecycle).

## Language

### Composition

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
YouTube or Vimeo. The object implementing one is a provider adapter.
_Avoid_: engine, backend, player

**Source**:
What a consumer asks the player to play: a URL string, or a resolved descriptor
naming its kind. Distinct from the `<source>` elements the native provider
renders.

### Loading

**Activation**:
The player's lifecycle before a provider attaches — whether loading has been
permitted, started, or failed. Reaches `ready` when a provider takes over.
_Avoid_: startup, boot, init

**Lifecycle**:
Whether media is loaded and playable. Derived from activation until a provider
attaches, and the provider's own from then on.
_Avoid_: status, phase

**Committed source**:
The source whose media element may mount, because its identity matches the one
activation committed to.
_Avoid_: eligible media

### Styling

See [ADR-0001](docs/adr/0001-structural-css-ships-inline.md) for why the first
two are separate, and
[ADR-0002](docs/adr/0002-published-measurements-are-outputs.md) for why an
output is not a token.

**Structural geometry**:
The positioning a primitive needs in order to function — stacking, insets, the
media element filling its viewport. Set inline by the primitive, ahead of the
consumer's `style` prop.
_Avoid_: layout CSS, base styles

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
