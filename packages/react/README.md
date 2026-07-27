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

<!-- example:react-composition -->

```tsx
import * as Player from '@reely/react';

export const Clip = () => (
  <Player.Root source="https://example.com/clip.mp4">
    <Player.Viewport>
      <Player.Media />
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
`{ type: 'hls' | 'video' | 'youtube' | 'vimeo', ... }` object.

Optional stylesheet with the default look:

<!-- example:ignore one import line; the theme.css subpath export and its presence in the tarball are gated by test/theme.test.ts -->

```ts
import '@reely/react/theme.css';
```

## Reading state and issuing commands

<!-- example:react-hooks -->

```tsx
import * as Player from '@reely/react';

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

## Exports

### Structure

`Root`, `Viewport`, `Media`, `Poster`, `PosterImage`, `ActivationButton`,
`LoadingIndicator`, `ErrorDisplay`, `Captions`, `Gestures`.

Each overlay renders only when its own state calls for it — nothing is drawn
disabled:

<!-- example:react-overlays -->

```tsx
import * as Player from '@reely/react';

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
    {/* `retry` is null when the provider offers no recovery — absent, not
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

### Menus

`SettingsMenu`, `SettingsMenuTrigger`, `SettingsMenuContent`, `MenuItem`,
`MenuRadioGroup`, `MenuRadioItem`, `CaptionsMenu`.

`SettingsMenu` and the menu parts are the building blocks for playback-rate and
quality menus, which have no dedicated primitive — the reference example
composes both from these.

<!-- example:react-menus -->

```tsx
import * as Player from '@reely/react';

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
`SeekSliderProps`, …), plus `PlayerHandle`, `PlayerActions`,
`PlayerActivationProps`, `PosterInput`, `ResponsivePoster`, `NormalizedPoster`,
`ErrorDisplayRenderProps`.

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
} from '@reely/react';

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

Every primitive exposes `data-reely-part` (its stable name), `data-state` (its
derived state) and, on provider-bound controls, `data-provider`. Style and query
against those rather than internal class names. Geometry a primitive sets on
itself is a default your `style` prop overrides; properties derived from player
state are the primitive's own. The full contract is in the workbench docs under
**Overview/Contract**.

## Browser support

Chrome and Edge 99, Firefox 97, Safari and iOS Safari 15.4.

The floor comes from `theme.css`, which uses `@layer`; the built JavaScript needs
nothing above Safari 14.1. Importing the stylesheet is what raises the
requirement, so a headless consumer is bound only by the JavaScript floor.

`test/theme.test.ts` freezes the stylesheet's CSS feature inventory, so a newer
feature fails the build rather than silently moving this number.

## License

[MIT](LICENSE).
