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
