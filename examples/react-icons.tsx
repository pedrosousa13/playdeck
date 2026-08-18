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
