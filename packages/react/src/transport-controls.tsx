import type { TimeRange } from '@reely/core';
import { controlTargetStyle, useLoadingPresentation } from './loading-error.js';
import { usePlayer, usePlayerState } from './player-context.js';
import type { ComponentPropsWithRef } from 'react';

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
  // `duration` readouts do not select `currentTime`. The selected object is
  // shallow-compared, so pulling a field that moves on every `timeupdate` would
  // re-render a readout whose text changes once per source — several times a
  // second, for nothing. The other two types genuinely track the playhead.
  const { currentTime, duration, provider } = usePlayerState((state) => ({
    currentTime: type === 'duration' ? 0 : state.currentTime,
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
