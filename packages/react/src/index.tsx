import {
  type TextCue,
  type TextTrack,
  type TimeRange
} from '@reely/core';
import { CaptionsIcon, CheckIcon, SettingsIcon } from './icons.js';
import {
  controlTargetStyle,
  useLoadingPresentation,
  visuallyHiddenStyle
} from './loading-error.js';
import {
  useActiveCues,
  usePlayer,
  usePlayerState
} from './player-context.js';
import { assignRef } from './viewport-media.js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from 'react';

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
  PlayerPreload
} from './use-activation.js';

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

export type CaptionsProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  readonly renderCue?: (cue: TextCue) => ReactNode;
};

// User-themeable CSS custom properties consumed by the default cue text box
// below. Set these on `Player.Captions` (or an ancestor) to theme the
// overlay without overriding its structure:
//   --reely-caption-font-size  - cue text font size (default: 1.05rem)
//   --reely-caption-color      - cue text color (default: #fff)
//   --reely-caption-background - cue text box background (default: rgba(0, 0, 0, 0.75))
//   --reely-caption-edge       - cue text edge, a text-shadow value (default: none)
const captionsOverlayStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.3em',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.2em)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
  pointerEvents: 'none'
};

const captionCueBoxStyle: CSSProperties = {
  fontSize: 'var(--reely-caption-font-size, 1.05rem)',
  color: 'var(--reely-caption-color, #fff)',
  backgroundColor: 'var(--reely-caption-background, rgba(0, 0, 0, 0.75))',
  textShadow: 'var(--reely-caption-edge, none)',
  padding: '0.15em 0.4em',
  borderRadius: '0.2em'
};

// Strips a cue down to its public shape before handing it to consumer code
// (renderCue), so engine-only fields on a provider's cue objects never leak.
const normalizeCue = (cue: TextCue): TextCue => ({
  id: cue.id,
  startTime: cue.startTime,
  endTime: cue.endTime,
  text: cue.text
});

const isRenderableCue = (cue: TextCue): boolean =>
  typeof cue?.text === 'string' && cue.text.trim().length > 0;

const defaultCueRenderer = (cue: TextCue): ReactNode =>
  cue.text.split('\n').map((line, index) => (
    <div data-reely-part="caption-line" key={index}>
      {line}
    </div>
  ));

export const Captions = ({ renderCue, style, ...props }: CaptionsProps) => {
  const captionRendering = usePlayerState((state) => state.captionRendering);
  const cues = useActiveCues();
  if (captionRendering !== 'custom') return null;

  return (
    <div
      {...props}
      data-reely-part="captions"
      data-state="custom"
      style={{ ...captionsOverlayStyle, ...style }}
    >
      {cues.filter(isRenderableCue).map((cue, index) => {
        const normalized = normalizeCue(cue);
        return (
          <div
            data-reely-part="caption-cue"
            key={`${normalized.id ?? ''}:${normalized.startTime}:${normalized.endTime}:${index}`}
            style={renderCue ? undefined : captionCueBoxStyle}
          >
            {renderCue ? renderCue(normalized) : defaultCueRenderer(normalized)}
          </div>
        );
      })}
    </div>
  );
};

const formatTime = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
};

export type PlayButtonProps = ComponentPropsWithRef<'button'>;

export const PlayButton = ({
  children,
  onClick,
  style,
  ...props
}: PlayButtonProps) => {
  const { autoplay, playback, provider } = usePlayerState((state) => ({
    autoplay: state.autoplay,
    playback: state.playback,
    provider: state.provider
  }));
  const { controller } = usePlayer();
  const isPlaying = playback === 'playing';

  return (
    <button
      {...props}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      aria-pressed={isPlaying}
      data-autoplay-state={autoplay}
      data-provider={provider ?? undefined}
      data-reely-part="play-button"
      data-state={playback}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          void controller.togglePlaybackWithOrigin('user');
        }
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? (isPlaying ? 'Pause' : 'Play')}
    </button>
  );
};

export type MuteButtonProps = ComponentPropsWithRef<'button'>;

export const MuteButton = ({
  children,
  onClick,
  style,
  ...props
}: MuteButtonProps) => {
  const { muted, provider, status } = usePlayerState((state) => ({
    muted: state.muted,
    provider: state.provider,
    status: state.capabilities.setVolume.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={muted ? 'Unmute' : 'Mute'}
      aria-pressed={muted}
      data-provider={provider ?? undefined}
      data-reely-part="mute-button"
      data-state={muted ? 'muted' : 'unmuted'}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void controller.toggleMuted();
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? (muted ? 'Unmute' : 'Mute')}
    </button>
  );
};

export type VolumeSliderProps = ComponentPropsWithRef<'input'>;

export const VolumeSlider = ({
  'aria-label': ariaLabel,
  onChange,
  step,
  style,
  ...props
}: VolumeSliderProps) => {
  const { muted, provider, status, volume } = usePlayerState((state) => ({
    muted: state.muted,
    provider: state.provider,
    status: state.capabilities.setVolume.status,
    volume: state.volume
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;
  const value = muted ? 0 : volume;
  const percent = Math.round(value * 100);

  return (
    <input
      {...props}
      aria-label={ariaLabel ?? 'Volume'}
      aria-valuetext={`${percent}%`}
      data-provider={provider ?? undefined}
      data-reely-part="volume-slider"
      data-state={muted ? 'muted' : 'unmuted'}
      max={1}
      min={0}
      onChange={(event) => {
        onChange?.(event);
        if (event.defaultPrevented) return;
        const next = Number(event.currentTarget.value);
        if (!Number.isFinite(next)) return;
        if (muted && next > 0) void controller.unmute();
        void controller.setVolume(next);
      }}
      step={step ?? 0.05}
      style={{ ...controlTargetStyle, ...style }}
      type="range"
      value={value}
    />
  );
};

/**
 * `data-buffering` is `"true"` while a stall is admitted, on the same 500ms
 * schedule as `LoadingIndicator` (#35). It is a separate attribute from
 * `data-state`, which means "is there a seek window" and does not move during a
 * stall. The slider stays interactive: seeking away is how a user escapes one.
 */
export type SeekSliderProps = ComponentPropsWithRef<'div'> & {
  // Escape hatch onto the inner range control (aria-label, step, disabled,
  // id/name, data-*, onChange, style). The library keeps ownership of the
  // controlled attributes (value/min/max/type/aria-valuetext); consumer
  // onChange is chained after the seek.
  readonly inputProps?: ComponentPropsWithRef<'input'>;
};

// The scrubbable range: [0, duration] for VOD, or the seekable window extent
// for live DVR where duration is null but a moving window is present.
const seekWindow = (
  duration: number | null,
  seekable: ReadonlyArray<TimeRange>
): { readonly start: number; readonly end: number } | null => {
  if (typeof duration === 'number' && duration > 0) {
    return { start: 0, end: duration };
  }
  if (seekable.length === 0) return null;
  const start = Math.min(...seekable.map((range) => range.start));
  const end = Math.max(...seekable.map((range) => range.end));
  return end > start ? { start, end } : null;
};

export const SeekSlider = ({
  children,
  inputProps,
  style,
  ...props
}: SeekSliderProps) => {
  const { buffered, currentTime, duration, provider, seekable, status } =
    usePlayerState((state) => ({
      buffered: state.buffered,
      currentTime: state.currentTime,
      duration: state.duration,
      provider: state.provider,
      seekable: state.seekable,
      status: state.capabilities.seek.status
    }));
  const { controller } = usePlayer();
  const stalled = useLoadingPresentation() === 'buffering';
  if (status !== 'available') return null;
  const hasDuration = typeof duration === 'number' && duration > 0;
  const window = seekWindow(duration, seekable);
  const min = window ? window.start : 0;
  const max = window ? window.end : 0;
  const span = max - min;
  const value = window ? Math.min(Math.max(currentTime, min), max) : 0;

  return (
    <div
      {...props}
      data-buffering={stalled ? 'true' : 'false'}
      data-provider={provider ?? undefined}
      data-reely-part="seek-slider"
      data-state={window ? 'ready' : 'idle'}
      style={{ position: 'relative', minHeight: 44, ...style }}
    >
      <div aria-hidden="true" data-reely-part="seek-buffered">
        {window
          ? buffered.map((range, index) => (
              <div
                data-reely-part="seek-buffered-range"
                key={`${range.start}:${range.end}:${index}`}
                style={{
                  position: 'absolute',
                  left: `${(Math.max(range.start - min, 0) / span) * 100}%`,
                  width: `${((range.end - range.start) / span) * 100}%`
                }}
              />
            ))
          : null}
      </div>
      <input
        aria-label="Seek"
        step={1}
        {...inputProps}
        aria-valuetext={
          hasDuration
            ? `${formatTime(value)} of ${formatTime(duration)}`
            : formatTime(value)
        }
        data-reely-part="seek-slider-input"
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) void controller.seekTo(next);
          inputProps?.onChange?.(event);
        }}
        style={{ width: '100%', minHeight: 44, ...inputProps?.style }}
        type="range"
        value={value}
      />
      {children}
    </div>
  );
};

export type TimeProps = ComponentPropsWithRef<'time'> & {
  readonly type?: 'current' | 'duration' | 'remaining';
};

export const Time = ({ children, type = 'current', ...props }: TimeProps) => {
  const { currentTime, duration, provider } = usePlayerState((state) => ({
    currentTime: state.currentTime,
    duration: state.duration,
    provider: state.provider
  }));
  const hasDuration = typeof duration === 'number' && Number.isFinite(duration);
  const seconds =
    type === 'duration'
      ? hasDuration
        ? duration
        : 0
      : type === 'remaining'
        ? hasDuration
          ? Math.max(0, duration - currentTime)
          : 0
        : currentTime;
  const formatted = formatTime(seconds);
  const display =
    type === 'remaining' && seconds > 0 ? `-${formatted}` : formatted;

  return (
    <time
      {...props}
      dateTime={`PT${Math.max(0, Math.floor(seconds))}S`}
      data-provider={provider ?? undefined}
      data-reely-part="time"
      data-state={hasDuration ? 'timed' : 'untimed'}
      data-time-type={type}
    >
      {children ?? display}
    </time>
  );
};

export type FullscreenButtonProps = ComponentPropsWithRef<'button'>;

export const FullscreenButton = ({
  children,
  onClick,
  style,
  ...props
}: FullscreenButtonProps) => {
  const { fullscreen, provider, status } = usePlayerState((state) => ({
    fullscreen: state.fullscreen,
    provider: state.provider,
    status: state.capabilities.fullscreen.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      aria-pressed={fullscreen}
      data-provider={provider ?? undefined}
      data-reely-part="fullscreen-button"
      data-state={fullscreen ? 'active' : 'inline'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void (fullscreen
          ? controller.exitFullscreen()
          : controller.requestFullscreen());
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? (fullscreen ? 'Exit fullscreen' : 'Enter fullscreen')}
    </button>
  );
};

export type PipButtonProps = ComponentPropsWithRef<'button'>;

export const PipButton = ({
  children,
  onClick,
  style,
  ...props
}: PipButtonProps) => {
  const { pictureInPicture, provider, status } = usePlayerState((state) => ({
    pictureInPicture: state.pictureInPicture,
    provider: state.provider,
    status: state.capabilities.pictureInPicture.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={
        pictureInPicture
          ? 'Exit picture-in-picture'
          : 'Enter picture-in-picture'
      }
      aria-pressed={pictureInPicture}
      data-provider={provider ?? undefined}
      data-reely-part="pip-button"
      data-state={pictureInPicture ? 'active' : 'inline'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void (pictureInPicture
          ? controller.exitPictureInPicture()
          : controller.requestPictureInPicture());
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ??
        (pictureInPicture
          ? 'Exit picture-in-picture'
          : 'Enter picture-in-picture')}
    </button>
  );
};

export type AirPlayButtonProps = ComponentPropsWithRef<'button'>;

/**
 * Opens the platform AirPlay route picker. Gated on the `airPlay` capability,
 * so it renders nothing outside Safari/iOS where AirPlay does not exist.
 *
 * Unlike `FullscreenButton` and `PipButton` this is **not** a toggle. Which
 * device the user picked is never exposed, and Reely does not currently
 * surface an active-route flag either: WebKit's
 * `webkitCurrentPlaybackTargetIsWireless` is deliberately unplumbed (see
 * `provider-native`). So there is no state to render today — no `aria-pressed`,
 * one static label, no `data-state`.
 *
 * That last part is current behaviour, not a permanent guarantee: if the
 * wireless-route flag is ever surfaced, this control gains a state.
 */
export const AirPlayButton = ({
  children,
  onClick,
  style,
  ...props
}: AirPlayButtonProps) => {
  const { provider, status } = usePlayerState((state) => ({
    provider: state.provider,
    status: state.capabilities.airPlay.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label="AirPlay"
      data-provider={provider ?? undefined}
      data-reely-part="airplay-button"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void controller.showAirPlayPicker();
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? 'AirPlay'}
    </button>
  );
};

/**
 * Resolves what a captions toggle (button click or `C` shortcut) should do
 * next, given the current tracks/selection and the last non-null selection
 * remembered across toggles. Returns `null` to turn captions off, a track id
 * to turn them on, or `undefined` when there is nothing to select (no
 * remembered or first track) — the caller should no-op in that case.
 */
const resolveCaptionToggle = (
  textTracks: readonly TextTrack[],
  selectedId: string | null,
  rememberedId: string | null
): string | null | undefined => {
  if (selectedId !== null) return null;
  return textTracks.find((t) => t.id === rememberedId)?.id ?? textTracks[0]?.id;
};

export type CaptionsButtonProps = ComponentPropsWithRef<'button'>;

export const CaptionsButton = ({
  children,
  onClick,
  style,
  ...props
}: CaptionsButtonProps) => {
  const { provider, selectedId, status, textTracks } = usePlayerState(
    (state) => ({
      provider: state.provider,
      selectedId: state.selectedTextTrackId,
      status: state.capabilities.selectTextTrack.status,
      textTracks: state.textTracks
    })
  );
  const { controller, lastSelectedTextTrackId } = usePlayer();
  // One-time announcement: track the previously seen selection so the live
  // region text only changes (and is only announced) on an actual
  // transition, not on every unrelated re-render.
  const previousSelectedId = useRef<string | null>(selectedId);
  const announcement = useRef<string>('');
  /* eslint-disable react-hooks/refs -- computed synchronously per render so the announcement updates on the same render as the transition. */
  if (previousSelectedId.current !== selectedId) {
    const label = textTracks.find((t) => t.id === selectedId)?.label;
    announcement.current =
      selectedId !== null ? `${label ?? ''} captions on` : 'Captions off';
    previousSelectedId.current = selectedId;
  }
  const announcementText = announcement.current;
  /* eslint-enable react-hooks/refs */
  if (status !== 'available') return null;
  const on = selectedId !== null;

  return (
    <>
      <button
        {...props}
        aria-label={on ? 'Disable captions' : 'Enable captions'}
        aria-pressed={on}
        data-provider={provider ?? undefined}
        data-reely-part="captions-button"
        data-state={on ? 'on' : 'off'}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          const next = resolveCaptionToggle(
            textTracks,
            selectedId,
            lastSelectedTextTrackId.current
          );
          if (next !== undefined) void controller.selectTextTrack(next);
        }}
        style={{ ...controlTargetStyle, ...style }}
        type="button"
      >
        {children ?? <CaptionsIcon />}
      </button>
      {/* Announces only the control-change message ("<label> captions on" /
          "Captions off"); cue text must never enter a live region. */}
      <div
        aria-live="polite"
        data-reely-part="captions-announcer"
        style={visuallyHiddenStyle}
      >
        {announcementText}
      </div>
    </>
  );
};

type ShortcutEvent = {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly target: EventTarget | null;
  readonly defaultPrevented: boolean;
  readonly preventDefault: () => void;
};

const isEditableTarget = (node: EventTarget | null): boolean => {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    node.isContentEditable
  );
};

const isInOpenMenu = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement &&
  node.closest(
    '[role="menu"], [role="menubar"], [role="listbox"], [data-reely-menu="open"]'
  ) !== null;

const isNativeActivationTarget = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement &&
  node.closest('button, [role="button"], a[href], summary') !== null;

export type ControlsProps = ComponentPropsWithRef<'div'> & {
  /**
   * Attach the shortcut listener to the document instead of scoping it to
   * this region. Global shortcuts are opt-in; by default keys only fire while
   * focus is inside the controls region.
   */
  readonly global?: boolean;
};

export const Controls = ({
  'aria-label': ariaLabel,
  children,
  global = false,
  onBlur,
  onFocus,
  onKeyDown,
  ref,
  style,
  tabIndex,
  ...props
}: ControlsProps) => {
  const {
    fullscreen,
    fullscreenStatus,
    muted,
    pipStatus,
    provider,
    seekStatus,
    selectedTextTrackId,
    selectTextTrackStatus,
    textTracks,
    volume,
    volumeStatus
  } = usePlayerState((state) => ({
    fullscreen: state.fullscreen,
    fullscreenStatus: state.capabilities.fullscreen.status,
    muted: state.muted,
    pipStatus: state.capabilities.pictureInPicture.status,
    provider: state.provider,
    seekStatus: state.capabilities.seek.status,
    selectedTextTrackId: state.selectedTextTrackId,
    selectTextTrackStatus: state.capabilities.selectTextTrack.status,
    textTracks: state.textTracks,
    volume: state.volume,
    volumeStatus: state.capabilities.setVolume.status
  }));
  const { controller, lastSelectedTextTrackId } = usePlayer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hadFocusWithin = useRef(false);
  // Signature of the capabilities that gate whether a child control is
  // rendered. Focus restoration keys off changes here so it fires only on a
  // capability transition (a gated control appearing or disappearing) and
  // never on unrelated state ticks like currentTime.
  const gatedSignature = `${seekStatus}|${volumeStatus}|${fullscreenStatus}|${pipStatus}`;

  const handleShortcut = useCallback(
    (event: ShortcutEvent) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (isEditableTarget(target) || isInOpenMenu(target)) return;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          // Space natively activates a focused button; don't double-toggle.
          if (event.key === ' ' && isNativeActivationTarget(target)) return;
          event.preventDefault();
          void controller.togglePlaybackWithOrigin('user');
          return;
        case 'ArrowLeft':
          if (seekStatus !== 'available') return;
          event.preventDefault();
          void controller.seekBy(-5);
          return;
        case 'ArrowRight':
          if (seekStatus !== 'available') return;
          event.preventDefault();
          void controller.seekBy(5);
          return;
        case 'j':
        case 'J':
          if (seekStatus !== 'available') return;
          event.preventDefault();
          void controller.seekBy(-10);
          return;
        case 'l':
        case 'L':
          if (seekStatus !== 'available') return;
          event.preventDefault();
          void controller.seekBy(10);
          return;
        case 'ArrowUp':
        case 'ArrowDown': {
          if (volumeStatus !== 'available') return;
          event.preventDefault();
          const delta = event.key === 'ArrowUp' ? 0.05 : -0.05;
          const next = Math.min(
            1,
            Math.max(0, Math.round((volume + delta) * 100) / 100)
          );
          if (muted && next > 0) void controller.unmute();
          void controller.setVolume(next);
          return;
        }
        case 'm':
        case 'M':
          if (volumeStatus !== 'available') return;
          event.preventDefault();
          void controller.toggleMuted();
          return;
        case 'f':
        case 'F':
          if (fullscreenStatus !== 'available') return;
          event.preventDefault();
          void (fullscreen
            ? controller.exitFullscreen()
            : controller.requestFullscreen());
          return;
        case 'c':
        case 'C': {
          if (selectTextTrackStatus !== 'available') return;
          event.preventDefault();
          const next = resolveCaptionToggle(
            textTracks,
            selectedTextTrackId,
            lastSelectedTextTrackId.current
          );
          if (next !== undefined) void controller.selectTextTrack(next);
          return;
        }
        default:
          return;
      }
    },
    [
      controller,
      fullscreen,
      fullscreenStatus,
      lastSelectedTextTrackId,
      muted,
      seekStatus,
      selectedTextTrackId,
      selectTextTrackStatus,
      textTracks,
      volume,
      volumeStatus
    ]
  );

  useEffect(() => {
    if (!global) return;
    const listener = (event: KeyboardEvent): void => handleShortcut(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [global, handleShortcut]);

  // Keep focus inside the player region: when a capability-gated control
  // unmounts while focused, the browser drops focus to <body>. Restore it to
  // the region so keyboard users never lose their place. Scoping to
  // `gatedSignature` ensures this reacts only to a control appearing or
  // disappearing, so an outside click that drops focus to <body> is never
  // re-stolen on the next unrelated render.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (hadFocusWithin.current && document.activeElement === document.body) {
      node.focus();
    }
  }, [gatedSignature]);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  return (
    <div
      {...props}
      aria-label={ariaLabel ?? 'Video player controls'}
      data-provider={provider ?? undefined}
      data-reely-part="controls"
      data-state={global ? 'global' : 'scoped'}
      onBlur={(event) => {
        onBlur?.(event);
        const next = event.relatedTarget as Node | null;
        if (
          next &&
          containerRef.current &&
          !containerRef.current.contains(next)
        ) {
          hadFocusWithin.current = false;
        }
      }}
      onFocus={(event) => {
        onFocus?.(event);
        hadFocusWithin.current = true;
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!global) handleShortcut(event);
      }}
      ref={setRef}
      // Deliberately role="group", not "toolbar": the region owns media
      // shortcuts (Arrow keys seek/adjust volume, J/L/K/M/F, Space) rather
      // than roving-tabindex toolbar navigation. Native controls inside
      // (buttons, links, range inputs) keep their own key handling; the
      // shortcut handler skips those targets.
      role="group"
      style={style}
      tabIndex={tabIndex ?? 0}
    >
      {children}
    </div>
  );
};

type SettingsMenuContextValue = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly close: () => void;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly triggerId: string;
  readonly contentId: string;
};

const SettingsMenuContext = createContext<SettingsMenuContextValue | null>(
  null
);

const useSettingsMenu = (): SettingsMenuContextValue => {
  const ctx = useContext(SettingsMenuContext);
  if (!ctx) {
    throw new Error(
      'SettingsMenu components must be used within <SettingsMenu>'
    );
  }
  return ctx;
};

// Roving focus walks this list, so it must contain only items a user can
// actually land on. A consumer hiding an entry with CSS — a container query
// that folds a control into the menu at one width and back out at another, as
// the reference example does — leaves the element in the DOM, and `.focus()`
// on a `display: none` element silently does nothing: the wrap from the first
// item landed on it and ArrowUp and End became dead keys.
//
// The check is on the item itself, not its ancestors. `checkVisibility()`
// would cover both but is Chrome 105 / Firefox 125 / Safari 17.4, above the
// support floor these packages declare.
const menuItems = (root: HTMLElement | null): HTMLElement[] =>
  root
    ? Array.from(
        root.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemradio"]'
        )
      ).filter((el) => getComputedStyle(el).display !== 'none')
    : [];

export const SettingsMenu = ({
  children,
  style,
  ...props
}: ComponentPropsWithRef<'div'>) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const value: SettingsMenuContextValue = {
    open,
    setOpen,
    close,
    triggerRef,
    rootRef,
    triggerId: `${baseId}-trigger`,
    contentId: `${baseId}-content`
  };
  return (
    <SettingsMenuContext.Provider value={value}>
      <div
        {...props}
        data-reely-part="settings-menu-root"
        data-state={open ? 'open' : 'closed'}
        ref={rootRef}
        style={{ position: 'relative', ...style }}
      >
        {children}
      </div>
    </SettingsMenuContext.Provider>
  );
};

export const SettingsMenuTrigger = ({
  children,
  onClick,
  onKeyDown,
  style,
  ...props
}: ComponentPropsWithRef<'button'>) => {
  const { open, setOpen, triggerRef, triggerId, contentId } = useSettingsMenu();
  return (
    <button
      {...props}
      aria-controls={open ? contentId : undefined}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={props['aria-label'] ?? 'Settings'}
      data-reely-part="settings-menu-trigger"
      data-state={open ? 'open' : 'closed'}
      id={triggerId}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        setOpen(!open);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true); // Content autofocuses its first item on open
        }
      }}
      ref={triggerRef}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? <SettingsIcon />}
    </button>
  );
};

export const SettingsMenuContent = ({
  children,
  onKeyDown,
  style,
  ...props
}: ComponentPropsWithRef<'div'>) => {
  const { open, close, setOpen, rootRef, triggerId, contentId } =
    useSettingsMenu();
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Autofocus the first item when the menu opens.
  useEffect(() => {
    if (!open) return;
    menuItems(contentRef.current)[0]?.focus();
  }, [open]);

  // Close on outside pointerdown without stealing focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        // Deliberately setOpen(false), not close(): unlike Escape/select,
        // an outside pointerdown must not steal focus back to the trigger.
        // Mouse users clicking empty space may land focus on <body> —
        // this matches native menu behavior.
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, rootRef, setOpen]);

  if (!open) return null;

  const move = (delta: number): void => {
    const items = menuItems(contentRef.current);
    if (items.length === 0) return;
    const current = items.findIndex((el) => el === document.activeElement);
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      {...props}
      aria-labelledby={triggerId}
      data-reely-menu="open"
      data-reely-part="settings-menu"
      id={contentId}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        switch (event.key) {
          case 'Escape':
            event.preventDefault();
            close();
            return;
          case 'ArrowDown':
            event.preventDefault();
            move(1);
            return;
          case 'ArrowUp':
            event.preventDefault();
            move(-1);
            return;
          case 'Home': {
            event.preventDefault();
            menuItems(contentRef.current)[0]?.focus();
            return;
          }
          case 'End': {
            event.preventDefault();
            const items = menuItems(contentRef.current);
            items[items.length - 1]?.focus();
            return;
          }
          case 'Tab':
            setOpen(false); // let focus leave naturally
            return;
          default:
            return;
        }
      }}
      ref={contentRef}
      role="menu"
      style={style}
    >
      {children}
    </div>
  );
};

export const MenuItem = ({
  children,
  onClick,
  onSelect,
  style,
  ...props
}: ComponentPropsWithRef<'button'> & { readonly onSelect?: () => void }) => {
  const { close } = useSettingsMenu();
  return (
    <button
      {...props}
      data-reely-part="menu-item"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onSelect?.();
        close();
      }}
      role="menuitem"
      style={{ ...controlTargetStyle, ...style }}
      tabIndex={-1}
      type="button"
    >
      {children}
    </button>
  );
};

type MenuRadioContextValue = {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
};

const MenuRadioContext = createContext<MenuRadioContextValue | null>(null);

const useMenuRadio = (): MenuRadioContextValue => {
  const ctx = useContext(MenuRadioContext);
  if (!ctx) {
    throw new Error('MenuRadioItem must be used within <MenuRadioGroup>');
  }
  return ctx;
};

export const MenuRadioGroup = ({
  value,
  onValueChange,
  children,
  ...props
}: ComponentPropsWithRef<'div'> & {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}) => (
  <MenuRadioContext.Provider value={{ value, onValueChange }}>
    <div {...props} data-reely-part="menu-radio-group" role="group">
      {children}
    </div>
  </MenuRadioContext.Provider>
);

export const MenuRadioItem = ({
  value,
  children,
  onClick,
  style,
  ...props
}: ComponentPropsWithRef<'button'> & { readonly value: string }) => {
  const { value: selected, onValueChange } = useMenuRadio();
  const { close } = useSettingsMenu();
  const checked = selected === value;
  return (
    <button
      {...props}
      aria-checked={checked}
      data-reely-part="menu-radio-item"
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onValueChange(value);
        close();
      }}
      role="menuitemradio"
      style={{ ...controlTargetStyle, ...style }}
      tabIndex={-1}
      type="button"
    >
      <span aria-hidden data-reely-part="menu-radio-indicator">
        {checked ? <CheckIcon /> : null}
      </span>
      {children}
    </button>
  );
};

// Disambiguates tracks that share a label (e.g. two "English" tracks with
// different kinds) by appending the language, rather than always showing it.
const disambiguateTrackLabel = (
  track: TextTrack,
  tracks: readonly TextTrack[]
): string => {
  const sharesLabel =
    tracks.filter((candidate) => candidate.label === track.label).length > 1;
  if (!sharesLabel || !track.language) return track.label;
  return `${track.label} (${track.language})`;
};

export type CaptionsMenuProps = ComponentPropsWithRef<'div'>;

/**
 * Preset assembly over `SettingsMenu`/`MenuRadioGroup`: lists the current
 * text tracks plus an "Off" option. Pass children to fully customize the
 * trigger/content; omit them to get the default track list.
 */
export const CaptionsMenu = ({ children, ...props }: CaptionsMenuProps) => {
  const { selectedId, status, textTracks } = usePlayerState((state) => ({
    selectedId: state.selectedTextTrackId,
    status: state.capabilities.selectTextTrack.status,
    textTracks: state.textTracks
  }));
  const { controller } = usePlayer();
  if (status !== 'available' || textTracks.length === 0) return null;

  return (
    <SettingsMenu {...props}>
      {children ?? (
        <>
          <SettingsMenuTrigger aria-label="Captions">
            <CaptionsIcon />
          </SettingsMenuTrigger>
          <SettingsMenuContent>
            <MenuRadioGroup
              onValueChange={(value) => {
                void controller.selectTextTrack(value === '' ? null : value);
              }}
              value={selectedId ?? ''}
            >
              <MenuRadioItem value="">Off</MenuRadioItem>
              {textTracks.map((track) => (
                <MenuRadioItem key={track.id} value={track.id}>
                  {disambiguateTrackLabel(track, textTracks)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </SettingsMenuContent>
        </>
      )}
    </SettingsMenu>
  );
};

const DOUBLE_TAP_WINDOW_MS = 300;

/**
 * Full-bleed gesture layer (`position: absolute; inset: 0`) with no
 * z-index. It must be placed BEFORE (as an earlier sibling of)
 * interactive layers like `Controls`/`ActivationButton` so those paint
 * on top and stay clickable — placed after them, it will cover and
 * block them.
 */
export type GesturesProps = ComponentPropsWithRef<'div'> & {
  readonly doubleTapSeek?: boolean;
  readonly seekOffset?: number;
  readonly onToggleControls?: () => void;
  readonly onSeek?: (direction: 'forward' | 'backward', offset: number) => void;
};

export const Gestures = ({
  doubleTapSeek = true,
  seekOffset = 10,
  onToggleControls,
  onSeek,
  children,
  onPointerUp,
  style,
  ...props
}: GesturesProps) => {
  const { controller } = usePlayer();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingTap.current !== null) {
        clearTimeout(pendingTap.current);
        pendingTap.current = null;
      }
    };
  }, []);

  return (
    <div
      {...props}
      data-reely-part="gestures"
      onPointerUp={(event) => {
        onPointerUp?.(event);
        if (event.defaultPrevented) return;
        // Ignore taps that land on a real control inside the layer.
        if (isNativeActivationTarget(event.target)) return;

        if (pendingTap.current !== null) {
          // Second tap within the window.
          clearTimeout(pendingTap.current);
          pendingTap.current = null;
          if (!doubleTapSeek) {
            // No double-tap action to disambiguate against — a single toggle, not two.
            onToggleControls?.();
            return;
          }
          const node = layerRef.current;
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const forward = event.clientX - rect.left >= rect.width / 2;
          void controller.seekBy(forward ? seekOffset : -seekOffset);
          onSeek?.(forward ? 'forward' : 'backward', seekOffset);
          return;
        }
        // First tap → wait to see if a second arrives.
        pendingTap.current = setTimeout(() => {
          pendingTap.current = null;
          onToggleControls?.();
        }, DOUBLE_TAP_WINDOW_MS);
      }}
      ref={layerRef}
      style={{ position: 'absolute', inset: 0, ...style }}
    >
      {children}
    </div>
  );
};

export * from './icons.js';
