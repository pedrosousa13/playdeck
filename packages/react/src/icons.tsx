import type { ReactElement, SVGProps } from 'react';

// One type for every icon rather than one alias each. Elsewhere in the package
// a component owns its own props type; this is the one departure, because the
// icons accept the same props and a name per icon would be a difference a
// reader has to check for and never finds (#478).
export type IconProps = SVGProps<SVGSVGElement>;

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

// A cog, not the old wavy-edged blob it replaces: that shape read as a puzzle
// piece at the 20px this trigger renders at, its teeth too shallow and too
// close together to separate at that size. This one is drawn from two clean
// primitives instead of one intricate outline -- eight identical rounded
// teeth, each the same rect rotated 45° around the centre, sunk one unit into
// a ring so the join is seamless, and the ring itself a hollow annulus (two
// same-winding circles, `evenodd` punching the hole) rather than a filled
// disc. Both read as distinct shapes well below 24px.
//
// The teeth are each rect's own rotated outline, written out as a path,
// rather than one rect with a `transform="rotate(...)"` attribute. Engines
// disagree on whether that attribute counts as a CSS `transform`:
// `getComputedStyle` reflects it on Firefox but not Chromium or WebKit, which
// made `e2e/site-landing.spec.ts`'s reduced-motion "settled" check -- opacity
// 1 and an identity transform on every element -- see this static cog as
// still mid-animation on Firefox alone. A path has no `transform` to disagree
// about on any engine.
const SETTINGS_ICON_TEETH = [
  'M11.5,1.6 L12.5,1.6 A1.1,1.1 0 0 1 13.6,2.7 L13.6,3.7 A1.1,1.1 0 0 1 12.5,4.8 L11.5,4.8 A1.1,1.1 0 0 1 10.4,3.7 L10.4,2.7 A1.1,1.1 0 0 1 11.5,1.6 Z',
  'M19.0004,4.2925 L19.7075,4.9996 A1.1,1.1 0 0 1 19.7075,6.5553 L19.0004,7.2624 A1.1,1.1 0 0 1 17.4447,7.2624 L16.7376,6.5553 A1.1,1.1 0 0 1 16.7376,4.9996 L17.4447,4.2925 A1.1,1.1 0 0 1 19.0004,4.2925 Z',
  'M22.4,11.5 L22.4,12.5 A1.1,1.1 0 0 1 21.3,13.6 L20.3,13.6 A1.1,1.1 0 0 1 19.2,12.5 L19.2,11.5 A1.1,1.1 0 0 1 20.3,10.4 L21.3,10.4 A1.1,1.1 0 0 1 22.4,11.5 Z',
  'M19.7075,19.0004 L19.0004,19.7075 A1.1,1.1 0 0 1 17.4447,19.7075 L16.7376,19.0004 A1.1,1.1 0 0 1 16.7376,17.4447 L17.4447,16.7376 A1.1,1.1 0 0 1 19.0004,16.7376 L19.7075,17.4447 A1.1,1.1 0 0 1 19.7075,19.0004 Z',
  'M12.5,22.4 L11.5,22.4 A1.1,1.1 0 0 1 10.4,21.3 L10.4,20.3 A1.1,1.1 0 0 1 11.5,19.2 L12.5,19.2 A1.1,1.1 0 0 1 13.6,20.3 L13.6,21.3 A1.1,1.1 0 0 1 12.5,22.4 Z',
  'M4.9996,19.7075 L4.2925,19.0004 A1.1,1.1 0 0 1 4.2925,17.4447 L4.9996,16.7376 A1.1,1.1 0 0 1 6.5553,16.7376 L7.2624,17.4447 A1.1,1.1 0 0 1 7.2624,19.0004 L6.5553,19.7075 A1.1,1.1 0 0 1 4.9996,19.7075 Z',
  'M1.6,12.5 L1.6,11.5 A1.1,1.1 0 0 1 2.7,10.4 L3.7,10.4 A1.1,1.1 0 0 1 4.8,11.5 L4.8,12.5 A1.1,1.1 0 0 1 3.7,13.6 L2.7,13.6 A1.1,1.1 0 0 1 1.6,12.5 Z',
  'M4.2925,4.9996 L4.9996,4.2925 A1.1,1.1 0 0 1 6.5553,4.2925 L7.2624,4.9996 A1.1,1.1 0 0 1 7.2624,6.5553 L6.5553,7.2624 A1.1,1.1 0 0 1 4.9996,7.2624 L4.2925,6.5553 A1.1,1.1 0 0 1 4.2925,4.9996 Z'
];

export const SettingsIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <g>
      {SETTINGS_ICON_TEETH.map((d, index) => (
        <path d={d} key={index} />
      ))}
    </g>
    <path
      d="M3.8,12 A8.2,8.2 0 1,0 20.2,12 A8.2,8.2 0 1,0 3.8,12 Z M6.8,12 A5.2,5.2 0 1,0 17.2,12 A5.2,5.2 0 1,0 6.8,12 Z"
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
