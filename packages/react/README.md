# @reely/react

Headless, composable React 19 media-player primitives with one API across
native MP4/WebM, HLS, YouTube and Vimeo. No CSS is imported by the primitives,
and every control is capability-gated: a control whose command the active
provider cannot honour renders nothing rather than rendering disabled.

```sh
pnpm add @reely/react
```

React 19 is a peer dependency. Provider packages are pulled in as dependencies
but loaded lazily — a consumer playing only MP4 ships no YouTube, Vimeo or
hls.js code in its initial graph, and makes no provider network requests.

## Usage

```tsx
import * as Player from '@reely/react';

export const Clip = () => (
  <Player.Root source="https://example.com/clip.mp4">
    <Player.Viewport>
      <Player.Media />
      <Player.Poster src="/poster.jpg" />
      <Player.Captions />
      <Player.Controls>
        <Player.PlayButton />
        <Player.MuteButton />
        <Player.VolumeSlider />
        <Player.SeekSlider />
        <Player.Time />
        <Player.CaptionsMenu />
        <Player.FullscreenButton />
      </Player.Controls>
    </Player.Viewport>
  </Player.Root>
);
```

`source` takes the same input as `detectSource` — a URL string, or an explicit
`{ type: 'hls' | 'video' | 'youtube' | 'vimeo', ... }` object.

Optional stylesheet with the default look:

```ts
import '@reely/react/theme.css';
```

## Reading state and issuing commands

```tsx
const playback = Player.usePlayerState((state) => state.playback);
const actions = Player.usePlayerActions();
const cues = Player.useActiveCues();

if (await actions.whenReady()) await actions.setPlaybackRate(0.75);
```

`usePlayerState` takes a selector and re-renders only when the selected value
changes. `Player.Root` also accepts a `ref`, which receives a `PlayerHandle`
carrying the same commands plus `getState`, `subscribe` and `on`.

## Exports

### Structure

`Root`, `Viewport`, `Media`, `Poster`, `PosterImage`, `ActivationButton`,
`LoadingIndicator`, `ErrorDisplay`, `Captions`, `Gestures`.

### Controls

`PlayButton`, `MuteButton`, `VolumeSlider`, `SeekSlider`, `Time`,
`FullscreenButton`, `PipButton`, `AirPlayButton`, `CaptionsButton`, `Controls`.

### Menus

`SettingsMenu`, `SettingsMenuTrigger`, `SettingsMenuContent`, `MenuItem`,
`MenuRadioGroup`, `MenuRadioItem`, `CaptionsMenu`.

`SettingsMenu` and the menu parts are the building blocks for playback-rate and
quality menus, which have no dedicated primitive — the reference example
composes both from these.

### Hooks

`usePlayerState`, `usePlayerActions`, `useActiveCues`.

### Helpers and types

`normalizePoster` resolves the `PosterInput` union (`string`,
`ResponsivePoster`, or a custom element) into the `NormalizedPoster` shape
`Poster` renders — exported so a consumer building its own poster layer resolves
it the same way.

Every component has a matching props type (`RootProps`, `MediaProps`,
`SeekSliderProps`, …), plus `PlayerHandle`, `PlayerActions`,
`PlayerActivationProps`, `PosterInput`, `ResponsivePoster`, `NormalizedPoster`,
`ErrorDisplayRenderProps`.

## Styling

Every primitive exposes `data-reely-part` (its stable name), `data-state` (its
derived state) and, on provider-bound controls, `data-provider`. Style and query
against those rather than internal class names. Geometry a primitive sets on
itself is a default your `style` prop overrides; properties derived from player
state are the primitive's own. The full contract is in the workbench docs under
**Overview/Contract**.

## License

[MIT](LICENSE).
