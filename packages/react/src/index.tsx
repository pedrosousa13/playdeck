// The primitives this entry exports are built on hooks, context and refs, so
// the client boundary is the package's to declare rather than the caller's to
// place: a bundler resolving this module into a server graph has nothing else
// to read it from, and what it reports without the directive names a React API
// such as `createContext` or `useSyncExternalStore` inside a file the caller
// cannot edit.
//
// The directive is the whole entry's, so it also crosses the icons and the
// handful of plain helpers beside them, which take no hook and would render on
// a server perfectly well. That is a cost accepted rather than one overlooked:
// splitting them off would mean a second entry point and a second thing for a
// consumer to know, to save shipping a few stateless SVG components to a client
// that is already loading the player they decorate. Core carries no directive
// for the opposite reason -- nothing there touches React at all, so a boundary
// would buy nothing and would stop server code calling in.
//
// It sits on the entry rather than on each module because that is what the
// build reads, and the bundle it produces carries the directive to the
// top of the chunk. That last part is a property of the build rather than of
// this file, so the directive is read back out of the packed tarball by
// scripts/verify-packaging.mjs, against the rule scripts/client-boundary.mjs
// holds: a build that stopped hoisting it fails there rather than in a
// consumer's app.
'use client';

export { Media, Viewport } from './viewport-media.js';

export type { MediaProps, ViewportProps } from './viewport-media.js';

export { normalizePoster, Poster, PosterImage } from './poster.js';

export type {
  NormalizedPoster,
  PosterImageProps,
  PosterInput,
  PosterProps,
  ResponsivePoster
} from './poster.js';

export {
  useActiveCues,
  usePlayerActions,
  usePlayerState
} from './player-context.js';

export type { PlayerActions, PlayerHandle } from './player-context.js';

export type {
  PlayerLoadingStrategy,
  PlayerMediaMount,
  PlayerPreload,
  PlayerProviderOptions
} from './use-activation.js';

// The bag `PlayerProviderOptions.wistia` holds, so a caller can name the type
// of a value it builds without depending on `@playdeck/provider-wistia` directly.
export type { WistiaProviderOptions } from '@playdeck/provider-wistia';

// The bag `PlayerProviderOptions.youtube` holds, so a caller can name the type
// of a value it builds without depending on `@playdeck/provider-youtube` directly.
export type { YouTubeProviderOptions } from '@playdeck/provider-youtube';

export { Root } from './root.js';

export type { PlayerActivationProps, RootProps } from './root.js';

export {
  ActivationButton,
  ErrorDisplay,
  LoadingIndicator
} from './loading-error.js';

export type {
  ActivationButtonProps,
  ErrorDisplayProps,
  ErrorDisplayRenderProps,
  LoadingIndicatorProps
} from './loading-error.js';

export { Captions, CaptionsButton, CaptionsMenu } from './captions.js';

export type {
  CaptionsButtonProps,
  CaptionsMenuProps,
  CaptionsProps
} from './captions.js';

export {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  SettingsMenu,
  SettingsMenuContent,
  SettingsMenuTrigger
} from './settings-menu.js';

export type {
  MenuItemProps,
  MenuRadioGroupProps,
  MenuRadioItemProps,
  SettingsMenuContentProps,
  SettingsMenuProps,
  SettingsMenuTriggerProps
} from './settings-menu.js';

export {
  MuteButton,
  PlayButton,
  SeekSlider,
  Time,
  VolumeSlider
} from './transport-controls.js';

export type {
  MuteButtonProps,
  PlayButtonProps,
  SeekSliderProps,
  TimeProps,
  VolumeSliderProps
} from './transport-controls.js';

export {
  AirPlayButton,
  FullscreenButton,
  PipButton
} from './display-controls.js';

export type {
  AirPlayButtonProps,
  FullscreenButtonProps,
  PipButtonProps
} from './display-controls.js';

export { Controls } from './controls.js';

export type {
  ControlsProps,
  ShortcutAction,
  ShortcutBindings
} from './controls.js';

export { Gestures } from './gestures.js';

export type { GesturesProps } from './gestures.js';

export * from './icons.js';
