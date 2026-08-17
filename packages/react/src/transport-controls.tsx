import type { PlayerProvider, TimeRange } from '@reely/core';
import {
  controlTargetStyle,
  useLoadingPresentation,
  visuallyHiddenStyle
} from './loading-error.js';
import {
  createCommandChain,
  requestAnswered,
  ECHO_DEADLINE_MS
} from './optimistic-request.js';
import { usePlayer, usePlayerState } from './player-context.js';
import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithRef
} from 'react';

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
  const { controller, volumeRequest } = usePlayer();
  // The volume the user last asked for, held over the round trip and released
  // when the player publishes a volume that answers it. Player-scoped, because
  // the `Controls` shortcut layer computes its next value from the same
  // request and this primitive is optional (#271); the store owns the whole of
  // that policy, and this primitive only renders what it holds.
  const requested = useSyncExternalStore(
    volumeRequest.subscribe,
    volumeRequest.getRequested,
    volumeRequest.getRequested
  );
  if (status !== 'available') return null;
  // A request outranks the muted zero. Dragging up while muted unmutes, but
  // `muted` stays true until the player publishes the unmute, so rendering the
  // zero here would swallow that drag exactly as a lagging volume does.
  const value = requested ?? (muted ? 0 : volume);
  // Read off the value the thumb is showing, so assistive technology is never
  // told something the sighted user is being shown the opposite of.
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
        volumeRequest.request(next);
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
  // controlled attributes (value/min/max/type/aria-valuetext/aria-disabled);
  // consumer onChange is chained after the seek, and a consumer
  // aria-describedby is composed with the buffered description, not replaced.
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

// How much of the seek window has loaded: the union of the buffered ranges
// clamped to it, as a percentage of it. A share and not a "loaded through
// <time>", which a gap would make name an unreachable time; window-relative,
// so a live DVR window starting past zero measures as a VOD one does. Nothing
// left after the clamp is `null` — unmeasured is absent, not zero (ADR-0002);
// a wholly covered window is 100; everything between is 1-99, so no sliver
// rounds away and no near-complete buffer rounds to done.
const bufferedShare = (
  buffered: ReadonlyArray<TimeRange>,
  window: { readonly start: number; readonly end: number }
): number | null => {
  const span = window.end - window.start;
  if (buffered.length === 0 || span <= 0) return null;
  const ranges = buffered
    .map((range) => ({
      start: Math.max(range.start, window.start),
      end: Math.min(range.end, window.end)
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);
  let covered = 0;
  let reached = window.start;
  for (const range of ranges) {
    covered += Math.max(range.end - Math.max(range.start, reached), 0);
    reached = Math.max(reached, range.end);
  }
  if (covered <= 0) return null;
  if (covered >= span) return 100;
  return Math.min(99, Math.max(1, Math.round((covered / span) * 100)));
};

// A seek can land on the nearest keyframe rather than the exact time asked
// for, and the iframe providers report time back quantised over an
// asynchronous bridge, so a reported time this close to the previewed one
// counts as the provider having answered. It stays under the control's default
// one-second step deliberately: a wider tolerance would read the time from
// *before* a single arrow press as an answer to it and snap the thumb back
// before the media had moved at all. A seek that lands further out than this
// is released by the deadline below instead.
//
// That bound is stated against the default step, and `inputProps.step` is a
// documented escape hatch. A consumer step below this tolerance moves the
// preview less than the tolerance on a single arrow press, so the time from
// before the press reads as already-arrived and the thumb reverts as soon as
// the command settles. Deriving the tolerance from the effective step would
// cost more machinery than a fine-scrub step is worth.
//
// It is passed to `requestAnswered` rather than living inside it: this bound is
// a property of time and of how providers report it, and no other quantity a
// control asks for shares it.
const SEEK_ECHO_TOLERANCE_SECONDS = 0.5;

type SeekRequest = {
  readonly value: number;
  readonly provider: PlayerProvider | null;
};

// The position the user last asked for, held until the media answers for it.
// The parts of that policy no scope has an opinion about — coalescing, the
// command timeout, generation invalidation, and the rule for reading a reported
// value as an answer — are `createCommandChain` and `requestAnswered`. This is
// the seek binding onto them: it keeps the held position in the control's own
// React state, releases it during render, and times it out in an effect.
const useSeekPreview = (
  hasWindow: boolean,
  currentTime: number,
  provider: PlayerProvider | null
): {
  readonly preview: number | null;
  readonly seek: (time: number) => void;
} => {
  const { controller } = usePlayer();
  // The requested position, with the provider kind it was asked of — a kind,
  // not the adapter, so a source swap within one kind does not show up here.
  // The chain generation below is what covers that case.
  const [requested, setRequested] = useState<SeekRequest | null>(null);
  // The chain coalesces and `settling` renders, and the two are not one fact
  // written twice. A drag's change events all land in the same tick, before
  // React has re-rendered, so every one of them would still read `settling` as
  // false and issue its own command: only the chain's own flag is read soon
  // enough to supersede. The state exists so the render knows the chain is
  // outstanding — and so that draining the chain schedules React work, which is
  // the only thing that re-reads a time the provider published *before* it
  // answered the command that asked for it.
  const [settling, setSettling] = useState(false);
  const [chain] = useState(() =>
    createCommandChain<number>({
      // `seekTo` never rejects: the controller catches a throwing adapter into
      // an `ok: false` result. `Root` makes exactly one controller and keeps it
      // for its lifetime, so the one captured here stays this player's.
      //
      // Origin-tagged, as `PlayButton` tags its own command: every change on
      // this control is a person scrubbing, and the `'provider'` the adapter
      // stamps the resulting `seeking`/`seeked` with says only who reported it
      // (#186).
      command: (time) => controller.seekToWithOrigin(time, 'user'),
      onDrained: (ok) => {
        setSettling(false);
        // A failed seek has no reported time coming, so it reconciles at once.
        if (!ok) setRequested(null);
      }
    })
  );
  // A chain is aimed at whatever media was loaded when it started. Replacing
  // the provider, or losing the seek window — which is how a swap to another
  // source of the same kind shows up — invalidates every position still queued
  // in it.
  useEffect(() => {
    chain.invalidate();
  }, [chain, hasWindow, provider]);

  const seek = (time: number): void => {
    setRequested({ value: time, provider });
    setSettling(true);
    chain.send(time);
  };

  // Reconciliation reads the reported time and never `PlayerState.seeking`:
  // only the native and Vimeo adapters ever publish that flag, and the
  // providers whose lag this preview exists for are exactly the ones that
  // never do.
  const release =
    requested !== null &&
    (requested.provider !== provider ||
      // The window can slide past a held preview, or vanish under it (DVR).
      !hasWindow ||
      requestAnswered({
        published: currentTime,
        requested: requested.value,
        settling,
        tolerance: SEEK_ECHO_TOLERANCE_SECONDS
      }));
  // Adjusted during render, the way React documents state that has to follow
  // its inputs: conditional and convergent, so the extra render is discarded
  // before it commits. Computed rather than remembered, so a render attempt
  // React throws away costs nothing: the next attempt recomputes the same
  // answer from the same committed state and releases again. An effect is not
  // the alternative it looks like — `react-hooks/set-state-in-effect` rejects a
  // synchronous `setState` in an effect body, and releasing a render later
  // would show the previewed position for one frame after the media had
  // already answered for it. It clears rather than merely stopping being read,
  // because a playhead running on past an answered preview would otherwise
  // leave the tolerance again and re-hold it.
  if (release) setRequested(null);
  const preview = release ? null : (requested?.value ?? null);

  // Armed once the command chain drains, and deliberately not re-armed by a
  // moving `currentTime`: playback reports several times a second, which would
  // push the deadline out forever. It stays in an effect with a cleanup so that
  // only a commit can arm or disarm it, and no discarded render can cancel the
  // backstop for a release that never happened.
  useEffect(() => {
    if (requested === null || settling) return;
    const timer = setTimeout(() => setRequested(null), ECHO_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [requested, settling]);

  return { preview, seek };
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
  const stalled = useLoadingPresentation() === 'buffering';
  const descriptionId = useId();
  const window = seekWindow(duration, seekable);
  const { preview, seek } = useSeekPreview(
    window !== null,
    currentTime,
    provider
  );
  if (status !== 'available') return null;
  const hasDuration = typeof duration === 'number' && duration > 0;
  const min = window ? window.start : 0;
  const max = window ? window.end : 0;
  const span = max - min;
  // A held preview is clamped like media time is: the window it was asked
  // against can have moved on before the seek was answered.
  const value = window
    ? Math.min(Math.max(preview ?? currentTime, min), max)
    : 0;
  // The geometry below is `aria-hidden`, so this description is the extent's
  // only route to assistive technology (#189) — read on demand, never a live
  // region, because `buffered` moves many times a second.
  const share = window ? bufferedShare(buffered, window) : null;
  const suppliedDescribedBy = inputProps?.['aria-describedby'];
  const describedBy =
    share === null
      ? suppliedDescribedBy
      : suppliedDescribedBy
        ? `${suppliedDescribedBy} ${descriptionId}`
        : descriptionId;

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
        aria-describedby={describedBy}
        aria-disabled={window ? undefined : true}
        aria-valuetext={
          window
            ? hasDuration
              ? `${formatTime(value)} of ${formatTime(duration)}`
              : formatTime(value)
            : 'Unavailable'
        }
        data-reely-part="seek-slider-input"
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (window && Number.isFinite(next)) seek(next);
          inputProps?.onChange?.(event);
        }}
        style={{ width: '100%', minHeight: 44, ...inputProps?.style }}
        type="range"
        value={value}
      />
      {share === null ? null : (
        <span
          data-reely-part="seek-buffered-description"
          id={descriptionId}
          style={visuallyHiddenStyle}
        >
          {share}% loaded
        </span>
      )}
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
