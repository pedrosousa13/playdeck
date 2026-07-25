import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const Icon = ({
  children,
  'aria-hidden': ariaHidden,
  ...props
}: IconProps & { children: ReactElement | ReactElement[] }): ReactElement => (
  <svg
    aria-hidden={ariaHidden === false ? undefined : (ariaHidden ?? true)}
    fill="currentColor"
    height="1em"
    viewBox="0 0 24 24"
    width="1em"
    {...props}
  >
    {children}
  </svg>
);

export const PlayIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M8 5v14l11-7z" />
  </Icon>
);

export const PauseIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </Icon>
);

export const VolumeHighIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 10v4h4l5 4V6L7 10H3zm11-1.5v7a4 4 0 000-7zm0-3.2v2.1a7 7 0 010 12v2.1a9 9 0 000-16.3z" />
  </Icon>
);

export const VolumeLowIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 10v4h4l5 4V6L7 10H3zm11-1.5v7a4 4 0 000-7z" />
  </Icon>
);

export const MutedIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 10v4h4l5 4V6L7 10H3z" />
    <path
      d="M15 9l6 6m0-6l-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
  </Icon>
);

export const FullscreenEnterIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z" />
  </Icon>
);

export const FullscreenExitIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M7 7V4H5v5h5V7H7zm7-3v5h5V7h-3V4h-2zM5 15h5v5H8v-3H5v-2zm12 0h2v2h-3v3h-2v-5h3z" />
  </Icon>
);

export const PipEnterIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 5h18v14H3V5zm2 2v10h14V7H5zm6 3h6v5h-6v-5z" />
  </Icon>
);

export const PipExitIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 5h18v14H3V5zm2 2v10h14V7H5zm2 2h6v4H7V9z" />
  </Icon>
);

export const AirPlayIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 5h18v11h-4v-2h2V7H5v7h2v2H3V5z" />
    <path d="M12 13l5 6H7l5-6z" />
  </Icon>
);

export const SettingsIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z" />
    <path
      d="M10.5 2h3l.5 2.6a7.5 7.5 0 011.7 1l2.5-1 1.5 2.6-2 1.7a7.6 7.6 0 010 2l2 1.7-1.5 2.6-2.5-1a7.5 7.5 0 01-1.7 1L13.5 22h-3l-.5-2.6a7.5 7.5 0 01-1.7-1l-2.5 1L4.3 15.8l2-1.7a7.6 7.6 0 010-2l-2-1.7L5.8 7.8l2.5 1a7.5 7.5 0 011.7-1L10.5 2z"
      fillRule="evenodd"
    />
  </Icon>
);

export const CheckIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M9 16.2l-3.5-3.5L4 14.2 9 19 20 8l-1.4-1.4z" />
  </Icon>
);

export const SeekForwardIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M4 5l8 7-8 7V5zm9 0l8 7-8 7V5z" />
  </Icon>
);

export const SeekBackwardIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M20 5l-8 7 8 7V5zm-9 0l-8 7 8 7V5z" />
  </Icon>
);

export const ReplayIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 5V2L7 6l5 4V7a5 5 0 11-5 5H5a7 7 0 107-7z" />
  </Icon>
);

export const CaptionsIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6zm2 0v12h14V6H5z" />
    <path d="M9.5 9.5a2 2 0 00-2 2v1a2 2 0 002 2h.75a.75.75 0 000-1.5H9.5a.5.5 0 01-.5-.5v-1a.5.5 0 01.5-.5h.75a.75.75 0 000-1.5H9.5z" />
    <path d="M15.5 9.5a2 2 0 00-2 2v1a2 2 0 002 2h.75a.75.75 0 000-1.5h-.75a.5.5 0 01-.5-.5v-1a.5.5 0 01.5-.5h.75a.75.75 0 000-1.5h-.75z" />
  </Icon>
);
