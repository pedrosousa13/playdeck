# @playdeck/react

Headless, composable React 19 media-player primitives with one API across
native MP4/WebM, HLS, YouTube, Vimeo and Wistia. No CSS is imported by the
primitives, and every control is capability-gated: a control whose command the
active provider cannot honour renders nothing rather than rendering disabled.

```sh
pnpm add @playdeck/react
```

React 19 is a peer dependency. Provider packages are pulled in as dependencies
but loaded lazily — a consumer playing only MP4 ships no YouTube, Vimeo, Wistia
or hls.js code in its initial graph, and makes no provider network requests.

This package's entry carries a `'use client'` directive, so a React Server
Component can import these primitives and render them directly, with no wrapper
of your own to hold the boundary. It is still a boundary: the props a server
component hands across it are serialised, so a function prop — a `renderCue`, an
`onVolumeChange` — belongs on a component of yours that carries the directive
itself.

`@playdeck/core` and the provider packages import no React API and carry no
directive; server code can call `detectSource` and the rest of that surface
without a boundary at all.

Every primitive below is staged, running, in the Storybook workbench at
[pedrosousa13.github.io/playdeck](https://pedrosousa13.github.io/playdeck/). That is
where the full styling
contract ([**Overview/Contract**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-contract--docs))
and the caption guidance ([**Overview/Captions**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-captions--docs))
live.

## Usage

<!-- example:react-composition -->

```tsx
import * as Player from '@playdeck/react';

export const Clip = () => (
  <Player.Root source="https://example.com/clip.mp4">
    <Player.Viewport>
      <Player.Media
        textTracks={[
          { src: '/captions.en.vtt', srcLang: 'en', label: 'English' }
        ]}
      />
      <Player.Poster>
        <Player.PosterImage alt="" src="/poster.jpg" />
      </Player.Poster>
      <Player.Captions />
      <Player.Controls>
        <Player.PlayButton />
        <Player.MuteButton />
        <Player.VolumeSlider />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.Time type="duration" />
        <Player.CaptionsButton />
        <Player.PipButton />
        {/* Renders only where there is somewhere to cast to. */}
        <Player.AirPlayButton />
        <Player.FullscreenButton />
      </Player.Controls>
    </Player.Viewport>
  </Player.Root>
);
```

<!-- /example -->

`source` takes the same input as `detectSource` — a URL string, or an explicit
`{ type: 'hls' | 'video' | 'youtube' | 'vimeo' | 'wistia', ... }` object. See
[Provider setup](https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md) for which URL forms each provider
accepts, which it refuses, and what each provider's `providerOptions` are.

`textTracks` is a prop on `Player.Media`, not on `Player.Root`. It takes an
array of `{ src, srcLang, label, kind?, default? }`, where `kind` is
`'captions'` or `'subtitles'` and `default` selects that track on load. Tracks
you supply this way reach native playback and the HLS provider's native engine;
everywhere else only the captions a provider discovers for itself are
available. Selection, discovery and what `Player.Captions` renders are covered
in [**Overview/Captions**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-captions--docs).

`Player.Captions` draws the active cues only where the provider hands caption
rendering over, and renders nothing otherwise — where the provider paints its
own captions there is nothing for it to add. `renderCue` replaces what it draws
for each cue:

<!-- example:ignore a signature and a type shape quoted from packages/react/src/captions.tsx and packages/core/src/types.ts, not runnable code; nothing gates this copy against them -->

```ts
renderCue?: (cue: TextCue) => ReactNode;
// TextCue: { id: string | null; startTime: number; endTime: number; text: string }
```

A cue is stripped to those four fields before it reaches your function, so no
provider-specific field leaks into consumer code. Supplying `renderCue` also
drops the default styling from each cue's own box, leaving its appearance to
you; the overlay that positions the cues keeps its own. Reach for it when the
`--playdeck-caption-*` tokens do not go far enough, or to render a cue as
something other than a run of text. The default splits `text` on newlines into
one `caption-line` part per line.

`captionRenderer` on `Player.Root` chooses which side draws the cues, and
defaults to `'custom'`: the provider hands its cues to Playdeck and
`Player.Captions` paints them. `'native'` asks the provider to draw its own
captions instead — a request rather than a setting, because what a provider has
to hand them to differs. The answer is `state.captionRendering`, and that is
what `Player.Captions` follows: it draws while that reads `custom` and renders
nothing otherwise, whatever the prop says.

What the request can reach differs by what is playing. Where the browser holds
the media itself, asking for `'native'` puts the selected track back into its
hands and the state reads `native` while a track is selected. Where an embed
paints cues inside its own frame, the state reads `provider` and the prop
changes nothing — there is no second surface to hand them to. Where a provider
parses cues itself without a native seam, the request lands and the state
honestly stays `custom`. In every case the state reports what is really
drawing, not what was asked for.

`unavailable` is the answer before anything has reported otherwise. A source
whose provider found no caption tracks reads that way, and so does one whose
provider has no caption seam at all — it is the value the state starts at, so
nothing having patched it and nothing being there are indistinguishable from
outside.

Optional stylesheet with the default look:

<!-- example:ignore one import line; the theme.css subpath export and its presence in the tarball are gated by test/theme.test.ts -->

```ts
import '@playdeck/react/theme.css';
```

## Reading state and issuing commands

<!-- example:react-hooks -->

```tsx
import * as Player from '@playdeck/react';

// `usePlayerState` takes a selector and re-renders only when the selected
// value changes — not on every time update.
export const PlaybackLabel = () => {
  const playback = Player.usePlayerState((state) => state.playback);
  return <span>{playback}</span>;
};

// Commands are answered: `whenReady` tells you when one will land, instead of
// issuing it and hoping.
export const SlowMotionButton = () => {
  const actions = Player.usePlayerActions();
  return (
    <button
      onClick={async () => {
        if (await actions.whenReady()) await actions.setPlaybackRate(0.75);
      }}
    >
      0.75×
    </button>
  );
};

// The cues active right now, for rendering captions yourself.
export const CueText = () => {
  const cues = Player.useActiveCues();
  return <p>{cues.map((cue) => cue.text).join(' ')}</p>;
};
```

<!-- /example -->

`usePlayerState` takes a selector and re-renders only when the selected value
changes. `Player.Root` also accepts a `ref`, which receives a `PlayerHandle`
carrying the same commands plus `getState`, `subscribe` and `on`.

The commands that ask a provider to do something resolve a `CommandResult` —
`{ ok: true }`, or `{ ok: false, reason }` with an optional `PlayerError` behind
it. Not every member is one: `whenReady` answers a `boolean`,
`setCaptionRenderer` records a preference and returns nothing, and
`activateFromInteraction` starts a player rather than issuing a command.

That result is the only place the answer lives, because nothing is queued and
replayed once the player catches up: a `reason` of `not-ready` means the call
did nothing and the caller has to ask again, which is what `whenReady` is for.
The `reason` vocabulary and the capability contract are shared with the
controller and are documented in
[@playdeck/core](https://github.com/pedrosousa13/playdeck/blob/main/packages/core/README.md).

`seekBy` moves the playhead by an offset in seconds — negative back, positive
forward. It is not sugar for `seekTo(currentTime + offset)`: the offset is added
to the position the provider itself holds when the command reaches it, so it
does not inherit the lag between a provider's real position and the
`currentTime` a render last read. Every provider clamps the target into the same
window `seekTo` lands in, so overshooting either end of the media is not itself
a failure — the seek lands on the boundary. An offset that is not finite is a
failure, answered `provider-error` without the playhead moving. This is the
command behind `Controls`' arrow, `j`/`l` and `PageUp`/`PageDown` bindings, and
behind `Gestures`' `seekOffset`.

`toggleMuted` reads the muted state the player is in and issues `mute` or
`unmute` accordingly, resolving whatever that one command resolved — so a `false`
result is the mute or the unmute failing, not the toggle. It writes no volume of
its own, which is why unmuting a player whose published volume is `0` leaves it
silent; the arrow-key handling described under `Controls` is a deliberate
exception layered on top, not what the command does.

`activateFromInteraction` is on both surfaces and is not a `PlayerController`
method, which is worth saying because it is where a reader looks for it first.
It starts a player that `loading="interaction"` has left dormant — nothing
fetched, no provider network request made — and `PlayerController` has no
concept of that dormancy: only the activation `Player.Root` runs has one.
Joining it to the handle is what lets an external control surface drive
activation through the ref it already holds, without the controller growing an
activation concern of its own. It returns `void` rather than a `CommandResult`,
because it starts a player rather than issuing a command; what became of the
activation is read from `state.activation` and `state.error`.

Calling it on a dormant root arms the player and queues one play, so the
provider loads and playback begins from that single call —
`Player.ActivationButton` is the bundled way to make that call, not the only one.
Where the activation is in its `error` state it is a retry instead: the provider
is discarded and the load re-armed. It refuses an error the state reports as
`recoverable: false`, exactly as `ActivationButton` does, so a direct call and a
click turn down the same errors.

Everything else is a silent no-op, which is the shape an external controller
that calls it unconditionally before `play()` needs: a root that is not
`loading="interaction"`, a `source` that was refused, the
`loading="interaction"` with autoplay pairing the library treats as a
configuration conflict, and a player that has already activated all leave it
doing nothing rather than restarting or throwing. Calling it moves the root to
`eligible` at once, but a provider is not attached yet, so a `play()` issued
straight after resolves `{ ok: false, reason: 'not-ready' }` and is dropped
rather than queued — nothing is replayed here either — so that pair costs
exactly one play once the provider attaches.

## Volume, muting and playback rate

Each playback preference is either yours to hold or the player's.
`muted`, `volume` and `playbackRate` are the controlled props: pass one and the
player is pinned to that value, and moving it is yours to do. `defaultMuted`,
`defaultVolume` and `defaultPlaybackRate` are the uncontrolled form — a
starting value the player then owns, which is what opening muted, or opening
quiet, costs when you have no reason to hold the state yourself.

| uncontrolled          | controlled     | starting value |
| --------------------- | -------------- | -------------- |
| `defaultMuted`        | `muted`        | `false`        |
| `defaultVolume`       | `volume`       | `1`            |
| `defaultPlaybackRate` | `playbackRate` | `1`            |

Each row is decided on its own, so a player can be controlled on one preference
and uncontrolled on another. Within a row the controlled prop wins outright
wherever it holds a value: the `default*` beside it is never consulted, and it
is not a fallback for a controlled prop that is momentarily `undefined`, since
an `undefined` there is the whole row going uncontrolled.

A `default*` is read on the first render and never again, the same as React's
own uncontrolled inputs. What it seeds is the first media that attaches; from
there the value the provider last confirmed is what carries forward, through a
source change and through a provider re-attach, rather than the default being
applied a second time. Handing a controlled prop back likewise leaves the
player on the value it currently holds rather than returning it to the default.
A starting volume is clamped into `0`–`1`. A volume that is not finite is not
applied at all, and neither is a playback rate unless it is finite and greater
than zero.

`onMutedChange`, `onVolumeChange` and `onPlaybackRateChange` report the value
the provider confirmed rather than the one that was asked for, which is why
they are worth reading even where you issued the change yourself. They fire
whatever moved the player — a bundled control, a `usePlayerActions` or
`PlayerHandle` command, the provider's own chrome under `controls`, the
platform moving the media by itself.

What they suppress is the echo: a change `Player.Root` issued to satisfy a
controlled prop is not reported back, so a controlled player is not called with
the value it was just handed. A starting value the provider agrees with is not
announced either. Neither rule is a guarantee that no callback ever arrives
unbidden, because both compare against what was asked for — a provider that
confirms something else answers with a genuine change. A controlled `volume`
outside `0`–`1` is the reachable case: it travels to the provider as given, and
the value that comes back is the clamped one.

That makes them the other half of a controlled player. A change arriving from
anywhere but the prop is reported and then reconciled back to the prop's value,
so a controlled player whose callback updates no state snaps its viewer back
every time they touch the control. Under the uncontrolled form the callback
observes only — the player keeps the new value with or without it. Each is read
through a ref as `Player.Root` renders, so an inline arrow function
re-subscribes nothing.

## Media Session

`Player.Root` binds itself to the browser's Media Session, so a player composed
from these primitives reaches the platform's own media surface — lock screen,
notification shade, hardware keys — without a consumer calling anything.
`mediaMetadata` is what it publishes there: an optional
`{ title, artist, album, artwork }`, where `artwork` is a list of
`{ src, sizes?, type? }`. Nothing is read off the source to fill it, so passing
none publishes none rather than a guess, and changing the prop on a mounted
player replaces what that player publishes. Where the browser exposes no
`navigator.mediaSession` there is nothing to bind and the prop does nothing.

That surface is shared by every player on the page, and the arbitration over
it — which root owns it, when ownership moves, and which of the platform's
actions are routed back into playback — belongs to `bindMediaSession` and is
documented under
[Media Session](https://github.com/pedrosousa13/playdeck/blob/main/packages/core/README.md#media-session)
in `@playdeck/core`. `Player.Root` makes that call for you, and `mediaMetadata`
is both its seed and its setter; what the platform shows is still whatever the
root owning the surface published last.

An artwork `src` is a consumer-supplied URL, so the allowlist can refuse one.
What that publishes is
[A URL prop the allowlist refused](https://github.com/pedrosousa13/playdeck/blob/main/packages/core/README.md#a-url-prop-the-allowlist-refused),
also in `@playdeck/core`.

## Exports

### Structure

`Root`, `Viewport`, `Media`, `Poster`, `PosterImage`, `ActivationButton`,
`LoadingIndicator`, `ErrorDisplay`, `Captions`, `Gestures`.

Each overlay renders only when its own state calls for it — nothing is drawn
disabled:

<!-- example:react-overlays -->

```tsx
import * as Player from '@playdeck/react';

// The overlay layers, in the order they stack inside a Viewport. Each renders
// only when its own state says it should: no disabled-looking placeholders.
export const Overlays = () => (
  <Player.Viewport>
    <Player.Poster>
      <Player.PosterImage alt="" src="/poster.jpg" />
    </Player.Poster>
    <Player.Media />
    {/* Deferred loading: the button activates the player on first interaction. */}
    <Player.ActivationButton aria-label="Play" />
    <Player.LoadingIndicator />
    <Player.Captions />
    <Player.Gestures
      seekOffset={10}
      onSeek={(direction, offset) => console.log(direction, offset)}
    />
    {/* `retry` is null when the error cannot be retried — absent, not
        disabled. */}
    <Player.ErrorDisplay>
      {({ error, retry }) => (
        <div role="alert">
          {error.message}
          {retry ? <button onClick={retry}>Retry</button> : null}
        </div>
      )}
    </Player.ErrorDisplay>
  </Player.Viewport>
);

// `Poster` accepts a URL string, an image-props object, or your own element.
// `normalizePoster` is the same resolution the primitive performs.
export const poster = Player.normalizePoster('/poster.jpg');
```

<!-- /example -->

### Controls

`PlayButton`, `MuteButton`, `VolumeSlider`, `SeekSlider`, `Time`,
`FullscreenButton`, `PipButton`, `AirPlayButton`, `CaptionsButton`, `Controls`.

#### Presentation and casting

`FullscreenButton`, `PipButton` and `AirPlayButton` each read one entry of
`state.capabilities` — `fullscreen`, `pictureInPicture` and `airPlay` — and
render only while that entry says `available`. An `unknown` entry renders
nothing either: a capability still being decided is not a reason to put a
control on screen and then withdraw it.

Driving those presentations without the buttons means doing that gate yourself.
The commands are on `PlayerHandle` and on `usePlayerActions`, as the request and
exit pairs `requestFullscreen`/`exitFullscreen` and
`requestPictureInPicture`/`exitPictureInPicture`. The built-in buttons choose
which half of a pair to send from `state.fullscreen` and
`state.pictureInPicture`, and that choice is exactly what you take over.
`showAirPlayPicker` has no exit twin and is not a toggle: it opens the
platform's own route picker, and which device the viewer picked — or whether
they picked one at all — is never reported back, which is why `AirPlayButton`
carries no state of its own.

Calling one past its gate is answered rather than thrown, and the
`CommandResult` says which gate it met. `not-ready` is a command that arrived
before a provider was attached and ready to take it. `unsupported` is the active
provider having no such command to give: an embed exposes only what its own SDK
offers, so some wire no picture-in-picture at all, and the AirPlay picker is
wired only by the adapters that drive a media element directly, and then only
where that element exposes the picker. `blocked` is a
permissions policy or a media-element attribute refusing it, and carries the
`PlayerError` that names which. So the capability answers whether to offer a
control, and the result answers what became of a command once it was issued.

#### Accessible names

Every interactive control ships a built-in English `aria-label`, and **an
`aria-label` you pass always wins over it**. The built-in is a fallback, never an
override, so `<Player.PlayButton aria-label="Reproducir" />` and
`<Player.SeekSlider aria-label="Buscar" />` do the same thing for the same
reason. Playdeck carries no message catalogue and no locale handling; this prop
is how you supply your own strings. (`Time` and `Controls` are not interactive
and carry no name of their own.)

**A button's visible text is separate, and you own that too.** The buttons fall
back to rendering their own English wording as their children, so naming a
button without also passing `children` leaves the two disagreeing — a
`<Player.PlayButton aria-label="Reproducir" />` reads "Reproducir" to a screen
reader and "Play" on screen. That is a WCAG 2.5.3 _Label in Name_ failure for
anyone driving the control by voice. Pass both, or pass an icon as `children`
and let the name stand alone.

Where a control's own label changes with its state — play/pause, mute/unmute,
captions on/off, and the fullscreen and picture-in-picture toggles — **one name
you supply holds in every state.** The library does not reassert its own wording
in one state and keep yours in the other: naming the control is yours from the
first prop onwards, so pick a name that reads correctly in both, or drive it
yourself from `usePlayerState`.

`SeekSlider` is the one control whose props are the wrapper `<div>`'s rather
than the interactive element's, because it renders buffered geometry around the
input. `aria-label` is the single exception, and is forwarded onto the inner
`<input type="range">` — the element that carries the slider role and the one a
screen reader announces. Everything else you pass stays on the wrapper, where
`className`, `style` and `data-*` belong.

`inputProps` is the escape hatch onto that inner input, for the props that have
nowhere else to go: `step`, `disabled`, `id`/`name`, `onChange`, its own
`style`, `data-*`. It is the more specific of the two, so
`inputProps['aria-label']` outranks a top-level `aria-label`, which outranks the
built-in `"Seek"`. Playdeck keeps ownership of the controlled attributes —
`value`, `min`, `max`, `type`, `aria-valuetext`, `aria-disabled` — so those
cannot be overridden. An `onChange` you pass is chained after the seek rather
than replacing it, and an `aria-describedby` you pass is composed with the
buffered-progress description rather than replacing it.

`Time` takes a `type` of `current` (the default), `duration` or `remaining`.
`remaining` counts down from the duration and carries a leading minus for as
long as any remainder is left — `-1:23`, and still `-0:00` through the last
second before the end. Only an exhausted remainder reads `0:00`. Each instance
carries `data-time-type`, so the three are styleable apart.

`data-state="untimed"` marks a `Time` on a source with no duration to measure
against — a live stream, or one whose duration has not arrived yet. It marks all
three types, `current` included, because it describes the source rather than the
instance. What differs is the element. `duration` and `remaining` have no time
to mark up there, so each becomes a `<span>` — keyed on the source being
untimed, not on the text coming out empty, so one given `children` is still a
`<span>` and still displays them. Given none it renders nothing: the library
draws no placeholder of its own, because a `0:00` there would state a
zero-length video rather than an unmeasured one. `current` still has an elapsed
time to show, so it stays a `<time>`. Pair the state with
`data-time-type` to hang a `LIVE` badge or an em dash off the right one — the
state alone also matches the running `current` beside it.

`Controls` is a focusable region that owns the media keyboard shortcuts: Space
and `k` toggle playback, `ArrowLeft`/`ArrowRight` seek 5s back and forward,
`j`/`PageDown` seek 10s back and `l`/`PageUp` 10s forward, `ArrowUp`/`ArrowDown`
move the volume by 0.05, and `m`, `f` and `c` toggle muted, fullscreen and
captions. Every binding except `togglePlayback` is gated on the capability its
command needs, and an unavailable one is inert — the key acts on nothing and
keeps none of it, so it is left to the page. `togglePlayback` is ungated,
because there is no playback capability to gate on: Space and `k` are taken on
every provider, subject only to the target rules below. The layer fires only
while focus is inside the region; `global` attaches the same map to the
document instead.

While the player is muted the volume arrows act on the muted zero the control
is showing rather than on the published volume behind it: `ArrowUp` unmutes and
restores that published level unchanged — stepping to 0.05 only where the
published volume is itself 0, which unmuting alone would leave silent — and
`ArrowDown` does nothing, because the player is already silent. `ArrowDown`
still keeps the key. The thumb moves to the restored level at once, while the
player is still muted, so the next press compounds on it: muted at 0.5,
`ArrowUp` `ArrowUp` lands on 0.55. Both arrows do step a change the player has
not answered yet, because that is what the thumb is showing: muted and dragged
to 0.3, `ArrowDown` moves to 0.25. `VolumeSlider`'s own pointer, `Home` and `End`
changes are unaffected: those start from the zero on screen, so moving one up
unmutes at the value the user chose.

The region owns those keys wherever focus sits inside it, a focused
`<input type="range">` included, so the arrows seek and adjust volume at the
same distances on `SeekSlider` and `VolumeSlider` as off them — see
[ADR-0005](https://github.com/pedrosousa13/playdeck/blob/main/docs/adr/0005-the-shortcut-layer-owns-its-keys-on-a-range-input.md).
Text entry (a text `<input>`, `<textarea>`, `<select>` or content-editable
region) still swallows every key, and a focused button, link or checkbox keeps
Space and `Enter` for itself.

`shortcuts` controls the layer. `shortcuts={false}` turns it off entirely — in
`global` mode no `document` listener is attached at all. An object is a partial
override map of action to a `KeyboardEvent.key` value, an array of them, or
`null` to suppress that one binding; every action it does not name keeps its
default, so moving one key never means restating the map. Both forms behave the
same in either scoping mode. WCAG 2.1.4 Character Key Shortcuts requires that
of `global` mode, whose keys are live wherever focus is on the page; the
region-scoped default conforms through the active-on-focus exception.

`shortcuts={{ seekBackward: null, seekForward: null }}` suppresses the two seek
bindings and hands the arrows back to whatever native control has focus.
`ShortcutAction` names the ten actions and `ShortcutBindings` is the map type.
Hoist the object or `useMemo` it: a fresh literal on every render re-attaches
the global listener.

### Menus

`SettingsMenu`, `SettingsMenuTrigger`, `SettingsMenuContent`, `MenuItem`,
`MenuRadioGroup`, `MenuRadioItem`, `CaptionsMenu`.

`SettingsMenu` and the menu parts are the building blocks for playback-rate and
quality menus, which have no dedicated primitive — the reference example
composes both from these.

<!-- example:react-menus -->

```tsx
import * as Player from '@playdeck/react';

// A playback-rate menu built from the menu parts. `SettingsMenu` owns the open
// state and returns focus to the trigger on every close path.
export const RateMenu = () => {
  const actions = Player.usePlayerActions();
  const rate = Player.usePlayerState((state) => state.playbackRate);

  return (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger aria-label="Settings" />
      <Player.SettingsMenuContent>
        <Player.MenuRadioGroup
          value={String(rate)}
          onValueChange={(value) => void actions.setPlaybackRate(Number(value))}
        >
          {[0.5, 1, 1.5, 2].map((option) => (
            <Player.MenuRadioItem key={option} value={String(option)}>
              {option}×
            </Player.MenuRadioItem>
          ))}
        </Player.MenuRadioGroup>
        <Player.MenuItem onSelect={() => void actions.seekTo(0)}>
          Restart
        </Player.MenuItem>
      </Player.SettingsMenuContent>
    </Player.SettingsMenu>
  );
};

// The caption track list, already wired to the player's own tracks.
export const Captions = () => <Player.CaptionsMenu />;
```

<!-- /example -->

### Hooks

`usePlayerState`, `usePlayerActions`, `useActiveCues`.

### Helpers and types

`normalizePoster` resolves the `PosterInput` union (`string`,
`ResponsivePoster`, or a custom element) into the `NormalizedPoster` shape
`Poster` renders — exported so a consumer building its own poster layer resolves
it the same way.

Every component has a matching props type (`RootProps`, `MediaProps`,
`SeekSliderProps`, `MenuItemProps`, …), plus `PlayerHandle`, `PlayerActions`,
`PlayerActivationProps`, `PosterInput`, `ResponsivePoster`, `NormalizedPoster`,
`ErrorDisplayRenderProps`, `ShortcutAction`, `ShortcutBindings`. The icons below
are the exception, and need no import: each takes `SVGProps<SVGSVGElement>`.

`PlayerHandle` is what a `ref` on `Player.Root` receives, and `PlayerActions` is
that same type with the read side (`getState`, `subscribe`, `on`) removed — it
is what `usePlayerActions` returns. Both are derived from the one action list
rather than written out twice, so a command reachable through the hook is
reachable through the ref and answers the same way.

### Icons

<!-- example:react-icons -->

```tsx
import {
  AirPlayIcon,
  CaptionsIcon,
  CheckIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  MutedIcon,
  PauseIcon,
  PipEnterIcon,
  PipExitIcon,
  PlayButton,
  PlayIcon,
  ReplayIcon,
  SeekBackwardIcon,
  SeekForwardIcon,
  SettingsIcon,
  VolumeHighIcon,
  VolumeLowIcon
} from '@playdeck/react';

// Every icon is an optional named export that tree-shakes out when unused, so
// importing one costs you only that one.
export const icons = [
  PlayIcon,
  PauseIcon,
  ReplayIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  MutedIcon,
  SeekForwardIcon,
  SeekBackwardIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  PipEnterIcon,
  PipExitIcon,
  AirPlayIcon,
  CaptionsIcon,
  SettingsIcon,
  CheckIcon
];

// Icons are decorative (`aria-hidden`), sized in `em`, and coloured by
// `currentColor` — a control passing one keeps its own accessible name.
export const CustomPlayButton = () => (
  <PlayButton>
    <PlayIcon />
  </PlayButton>
);
```

<!-- /example -->

## Styling

Every primitive exposes `data-playdeck-part` (its stable name), `data-state` (its
derived state) and, on provider-bound controls, `data-provider`. Style and query
against those rather than internal class names. Geometry a primitive sets on
itself is a default your `style` prop overrides; state-derived properties are
the primitive's own. The full contract is in the workbench docs under
[**Overview/Contract**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-contract--docs).

## Browser support

Chrome and Edge 99, Firefox 97, Safari and iOS Safari 15.4.

The floor comes from `theme.css`, which uses `@layer`; the built JavaScript needs
nothing above Safari 14.1. Importing the stylesheet is what raises the
requirement, so a headless consumer is bound only by the JavaScript floor.

`test/theme.test.ts` freezes the stylesheet's CSS feature inventory, so a newer
feature fails the build rather than silently moving this number.

## License

[MIT](LICENSE).
