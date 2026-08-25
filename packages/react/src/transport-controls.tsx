import type { PlayerProvider, TimeRange } from '@playdeck/core';
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
  type ComponentPropsWithRef,
  type Ref
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

// How many digits sit after the point, including the ones `String` hides in
// exponent form (it switches to it below 1e-6).
const decimalPlaces = (value: number): number => {
  const text = String(value);
  const exponent = text.indexOf('e');
  const mantissa = exponent === -1 ? text : text.slice(0, exponent);
  const point = mantissa.indexOf('.');
  const digits = point === -1 ? 0 : mantissa.length - point - 1;
  if (exponent === -1) return digits;
  return Math.max(0, digits - Number(text.slice(exponent + 1)));
};

// The value a range input will actually keep, which is not always the value it
// is handed: the HTML value sanitisation algorithm clamps into `[min, max]` and
// then snaps to the nearest `step`, ties going to the higher.
//
// A controlled input handed a value it cannot keep desynchronises React's value
// tracker from the DOM — React's tracker records the string React assigned, the
// input records the string it kept — and React drops a change event whose new
// value equals what the tracker holds. The press behind that event then issues
// no command at all, while every other signal says it was seen: the thumb moves,
// the keydown fires, and only the media never arrives.
//
// Neither slider below can assume it is handed a step-valid value, because both
// render what the media publishes rather than what the user chose. Measured on
// the ~1s reference clip, back when the seek step was a fixed second and that
// window left the input two values it could keep: React assigned
// `0.505738182`, the input kept `1`, the tracker kept `0.505738182`, and `End`
// from there moved nothing and seeked nowhere on all three engines. The step is
// derived from the window now (#383), so that window is no longer the one that
// reaches this — a consumer step, a live window's own grid and the volume
// arrow chain drifting off 0.05 in floating point all still are. Snapping here
// is what keeps the string React assigns and the string the input keeps the
// same string.
//
// It renders only. Nothing downstream reads it: a command carries the value read
// back off the DOM, and the preview policy compares against what was requested.
const snapToStep = (
  value: number,
  min: number,
  max: number,
  step: number | string | undefined
): number => {
  const clamped = Math.min(Math.max(value, min), max);
  const size = typeof step === 'number' ? step : Number(step);
  // `step="any"` parses to `NaN`, which is the attribute asking for no grid at
  // all — the one case where any value is one the input can keep.
  if (!Number.isFinite(size) || size <= 0) return clamped;
  // Rebuilt from the step index rather than accumulated, and rounded to the
  // grid's own precision: `7 * 0.05` is `0.35000000000000003`, a step mismatch
  // of its own that would leave behind exactly the desync this exists to avoid.
  const places = Math.min(
    Math.max(decimalPlaces(size), decimalPlaces(min)),
    20
  );
  const on = (index: number): number =>
    Number((min + index * size).toFixed(places));
  const nearest = on(Math.round((clamped - min) / size));
  // A grid whose last stop falls short of the maximum stops there rather than
  // stepping past it, which is what the sanitisation algorithm does too.
  return nearest <= max ? nearest : on(Math.floor((max - min) / size));
};

// THE ACCESSIBLE-NAME RULE, for every control in this package and stated only
// here. A control destructures `aria-label` off its props and writes
// `ariaLabel ?? <its own>`, rather than leaving the name to the props spread.
// The shape is what `VolumeSlider` below and `ActivationButton` have always
// used, and the reason the others need it is that a literal written after a
// spread wins by React's later-wins rule: it discarded the consumer's name in
// silence, with nothing from the compiler and nothing at runtime.
//
// The fallback belongs INSIDE the state branch, not around it. A control whose
// wording changes with its state would otherwise reassert the library's word in
// one state and keep the consumer's in the other, and a name is owned or it is
// not — there is no coherent half of a name to own.
export type PlayButtonProps = ComponentPropsWithRef<'button'>;

export const PlayButton = ({
  'aria-label': ariaLabel,
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
      aria-label={ariaLabel ?? (isPlaying ? 'Pause' : 'Play')}
      aria-pressed={isPlaying}
      data-autoplay-state={autoplay}
      data-provider={provider ?? undefined}
      data-playdeck-part="play-button"
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
  'aria-label': ariaLabel,
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
      aria-label={ariaLabel ?? (muted ? 'Unmute' : 'Mute')}
      aria-pressed={muted}
      data-provider={provider ?? undefined}
      data-playdeck-part="mute-button"
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
  const grid = step ?? 0.05;
  // A request outranks the muted zero. Dragging up while muted unmutes, but
  // `muted` stays true until the player publishes the unmute, so rendering the
  // zero here would swallow that drag exactly as a lagging volume does.
  const value = snapToStep(requested ?? (muted ? 0 : volume), 0, 1, grid);
  // Read off the value the thumb is showing, so assistive technology is never
  // told something the sighted user is being shown the opposite of.
  const percent = Math.round(value * 100);

  return (
    <input
      {...props}
      aria-label={ariaLabel ?? 'Volume'}
      aria-valuetext={`${percent}%`}
      data-provider={provider ?? undefined}
      data-playdeck-part="volume-slider"
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
      step={grid}
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

// The step a window with nothing to divide falls back to, and the ceiling on
// the derived one: the second the control always rendered.
const DEFAULT_SEEK_STEP_SECONDS = 1;

// The step the seek input renders where a consumer supplies none. Twenty
// positions across the window, capped at the second it always was.
//
// The cap is what makes this free for ordinary content rather than a trade: on
// any window of twenty seconds or more `span / 20` is already at least a second,
// so every normal-length clip renders bit-for-bit the grid it rendered before,
// and pointer scrubbing on it cannot have been coarsened. Only a window short
// enough for a whole second to be coarse gets a finer one — the ~1s clip the
// reference example uses had two positions and now has twenty, which is what
// makes a `Home` or `End` press from mid-clip a position the input can move to
// and so an event at all (#383).
//
// Twenty and not a hundred, because the divisor is also the ceiling on how tight
// the echo tolerance below can get, and that is the side with something to lose.
// A hundred would take every clip under 100s off the half-second bound the
// tolerance has always had — a 20s clip down to 0.1s, the reference clip to
// 0.005s — which is under the reporting precision the tolerance exists to
// absorb, so a *correct* seek would routinely read as unanswered and hold the
// preview for the whole `ECHO_DEADLINE_MS`. Twenty confines that to windows
// under twenty seconds, where a whole-second step was the worse of the two
// failures anyway, and leaves every ordinary clip on exactly the numbers it had.
//
// A span of zero or of `NaN` divides to nothing an input can hold and falls back
// to the second. An infinite span — what a live HLS source publishes for its
// duration — reaches the same second by the cap instead: `Infinity / 20` is
// `Infinity`, and `Math.min` takes the second. Same answer, different route, and
// the right one either way: an unbounded window has no extent to divide.
const seekStep = (span: number): number => {
  const derived = Math.min(DEFAULT_SEEK_STEP_SECONDS, span / 20);
  return Number.isFinite(derived) && derived > 0
    ? derived
    : DEFAULT_SEEK_STEP_SECONDS;
};

// A seek can land on the nearest keyframe rather than the exact time asked
// for, and the iframe providers report time back quantised over an
// asynchronous bridge, so a reported time this close to the previewed one
// counts as the provider having answered. It stays under the step the control
// is actually rendering deliberately: a wider tolerance would read the time
// from *before* a single native step as an answer to it and snap the thumb back
// before the media had moved at all. A seek that lands further out than this is
// released by the deadline below instead.
//
// Half the effective step, and not a constant. It was a fixed half-second while
// the step was a fixed second, and this comment used to decline to derive it on
// the grounds that doing so "would cost more machinery than a fine-scrub step
// is worth" — the machinery being that the window has to be measured before the
// preview hook is called rather than after. That trade is taken now the step is
// derived too: a constant stated against a step that moves is a bound that
// stops holding, and on the ~1s window it covered half of everything, so a seek
// that landed visibly wrong read as an answer to one that asked for somewhere
// else. It is unchanged wherever the step is: a clip of twenty seconds or more
// still steps by one and still tolerates half of it, which is what the divisor
// above was chosen to guarantee.
//
// The effective step is the consumer's where `inputProps.step` supplies one,
// which is the case the old comment named as a known residual and this closes:
// a consumer step finer than the tolerance no longer moves the preview less
// than the tolerance. `step="any"` parses to `NaN` — no grid at all, so there
// is no step to halve — and keeps the default's own half-second.
//
// It is passed to `requestAnswered` rather than living inside it: this bound is
// a property of time and of how providers report it, and no other quantity a
// control asks for shares it.
const seekEchoTolerance = (step: number | string): number => {
  const size = typeof step === 'number' ? step : Number(step);
  return (
    (Number.isFinite(size) && size > 0 ? size : DEFAULT_SEEK_STEP_SECONDS) / 2
  );
};

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
  provider: PlayerProvider | null,
  tolerance: number
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
      // Origin-tagged, as `PlayButton` tags its own command: every change that
      // reaches here is a person scrubbing, and the `'provider'` the adapter
      // stamps the resulting `seeking`/`seeked` with says only who reported it
      // (#186). Not every seek from this control comes through here — ADR-0005
      // gives the arrow keys to the shortcut layer, which prevents the input's
      // default and tags its own seek `'user'` from there.
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
        tolerance
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

// `aria-label` is the one prop this component accepts at the wrapper level and
// renders somewhere else, and that asymmetry is deliberate. Everything else a
// consumer writes at the top level describes the box — layout, classes, data
// hooks — and belongs on it. A name does not: the wrapper carries no role, so a
// name there reaches nothing, while the inner input is what assistive
// technology focuses and announces. Writing the obvious thing therefore used to
// type-check, do nothing observable, and leave the control still announcing the
// built-in English (#437). It is relocated and not copied, because the same
// name on both elements is one of them saying it twice.
//
// The name and nothing else. `inputProps` remains the route for every other
// input-level prop; generalising the relocation would turn "which element does
// this prop land on" into a per-prop rule a consumer has to memorise.
export const SeekSlider = ({
  'aria-label': ariaLabel,
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
  const min = window ? window.start : 0;
  const max = window ? window.end : 0;
  const span = max - min;
  // The step the input will actually be rendered with, since `inputProps`
  // overrides the derived default and the value has to be snapped to whichever
  // grid wins. Measured here, above the hook and above the capability gate,
  // because the echo tolerance is derived from it and the hook has to be called
  // unconditionally and in a stable order.
  const grid = inputProps?.step ?? seekStep(span);
  const { preview, seek } = useSeekPreview(
    window !== null,
    currentTime,
    provider,
    seekEchoTolerance(grid)
  );
  if (status !== 'available') return null;
  const hasDuration = typeof duration === 'number' && duration > 0;
  // A held preview is clamped like media time is: the window it was asked
  // against can have moved on before the seek was answered.
  const value = window ? snapToStep(preview ?? currentTime, min, max, grid) : 0;
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
      data-playdeck-part="seek-slider"
      data-state={window ? 'ready' : 'idle'}
      style={{ position: 'relative', minHeight: 44, ...style }}
    >
      <div aria-hidden="true" data-playdeck-part="seek-buffered">
        {window
          ? buffered.map((range, index) => (
              <div
                data-playdeck-part="seek-buffered-range"
                key={`${range.start}:${range.end}:${index}`}
                style={{
                  position: 'absolute',
                  left: `${(Math.max(range.start - min, 0) / span) * 100}%`,
                  width: `${((range.end - range.start) / span) * 100}%`
                }}
              />
            ))
          : null}
        {/* The played span, after the loaded ranges so it paints over them. An
            element rather than the input's own filled part, because the theme
            has to turn the native range widget off to stop it painting over
            this layer (#415), and turning it off takes `accent-color` with it
            on Blink and WebKit, which offer no pseudo-element for a range's
            filled part to draw it back. Sized like
            the ranges beside it: positioned here, painted by CSS, `aria-hidden`
            with the rest of the geometry — `seek-buffered-description` is what
            reaches assistive technology. */}
        {window ? (
          <div
            data-playdeck-part="seek-progress"
            style={{
              position: 'absolute',
              left: 0,
              width: `${((value - min) / span) * 100}%`
            }}
          />
        ) : null}
      </div>
      <input
        // Above the spread, so `inputProps['aria-label']` still outranks both:
        // it names the element it is written for, which is more specific than a
        // name written at the wrapper. Precedence is inputProps, then the
        // top-level prop, then the built-in.
        aria-label={ariaLabel ?? 'Seek'}
        {...inputProps}
        step={grid}
        aria-describedby={describedBy}
        aria-disabled={window ? undefined : true}
        aria-valuetext={
          window
            ? hasDuration
              ? `${formatTime(value)} of ${formatTime(duration)}`
              : formatTime(value)
            : 'Unavailable'
        }
        data-playdeck-part="seek-slider-input"
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
          data-playdeck-part="seek-buffered-description"
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

// `ref` is widened past `HTMLTimeElement` because the element is not fixed: the
// untimed branch below renders a `<span>`, so a ref declared as a `<time>` was
// handed something that is not one. TypeScript could not catch it —
// `HTMLSpanElement` declares no member `HTMLElement` does not, so
// `HTMLTimeElement` is structurally assignable to it and the swap type-checked
// silently while `ref.current.dateTime` read `undefined` at runtime. The
// declared surface has to be honest about what it hands back, on #356's
// reasoning. Nothing a consumer writes breaks: property covariance and
// parameter bivariance keep both `useRef<HTMLTimeElement>(null)` and
// `(el: HTMLTimeElement | null) => void` assignable. What goes is `.dateTime`
// autocomplete off the ref — the one member this component does not guarantee.
export type TimeProps = Omit<ComponentPropsWithRef<'time'>, 'ref'> & {
  readonly ref?: Ref<HTMLElement>;
  readonly type?: 'current' | 'duration' | 'remaining';
};

export const Time = ({
  children,
  ref,
  type = 'current',
  ...props
}: TimeProps) => {
  const { currentTime, duration, provider } = usePlayerState((state) => ({
    currentTime: state.currentTime,
    duration: state.duration,
    provider: state.provider
  }));
  const hasDuration = typeof duration === 'number' && Number.isFinite(duration);
  // `null` for a total this source does not have — a live stream, or one whose
  // duration has not arrived. `0` was the defect (#248): `formatTime(0)` renders
  // `0:00`, and a viewer reads a zero-length video rather than an untimed one.
  // `current` never reaches it, because `currentTime` means the same thing on a
  // live source as on a VOD one, so a `current` instance is always the `<time>`
  // below.
  const seconds =
    type === 'duration'
      ? hasDuration
        ? duration
        : null
      : type === 'remaining'
        ? hasDuration
          ? Math.max(0, duration - currentTime)
          : null
        : currentTime;

  // Not a `<time>`: there is no time here to mark up. Keeping the element and
  // emptying it would leave a `<time>` with neither a `datetime` nor parseable
  // time-string content, which its own rule forbids, and the `PT0S` that would
  // make it conformant is the same zero-duration claim the text just stopped
  // making. ADR-0002 rules that an unknown measurement removes the published
  // property rather than publishing a zero or an empty value; that ADR governs a
  // CSS custom property rather than an element, but it is the shape this file
  // already keeps for something it has not measured — `bufferedShare` returns
  // `null` rather than `0`, and `SeekSlider` then leaves the
  // `seek-buffered-description` element out instead of rendering an empty one.
  //
  // Every hook is repeated onto the `<span>`, because they are the whole
  // affordance: `data-state="untimed"` is what a consumer hangs a `LIVE` badge,
  // an em dash or an elapsed-time fallback off, in their own layout rather than
  // one this library materialises inside their design. The known cost is a
  // consumer selector written `time[data-playdeck-part="time"]`, which stops
  // matching in this state — the part attribute is the documented hook, not the
  // tag name.
  if (seconds === null) {
    // The library owns `datetime` in both states. The `<time>` below writes its
    // own after the spread and so always outranked a consumer's, but a `<span>`
    // writes none, so an unstripped `dateTime` prop would reach the DOM here and
    // restate — in the form a machine parses — the zero-duration claim the text
    // has just stopped making.
    const untimedProps = { ...props };
    delete untimedProps.dateTime;

    return (
      <span
        {...untimedProps}
        ref={ref}
        data-provider={provider ?? undefined}
        data-playdeck-part="time"
        data-state="untimed"
        data-time-type={type}
      >
        {children}
      </span>
    );
  }

  const formatted = formatTime(seconds);
  const display =
    type === 'remaining' && seconds > 0 ? `-${formatted}` : formatted;

  return (
    <time
      {...props}
      // Narrowed back for this branch only. `Ref<HTMLElement>` is a declaration
      // about what a holder may rely on, not about what arrives: here the
      // element is a `<time>`, so an `HTMLTimeElement` is what the ref receives.
      // The cast writes a subtype into a wider slot, which is the safe
      // direction; TypeScript refuses it only because a ref object is mutable.
      ref={ref as Ref<HTMLTimeElement>}
      dateTime={`PT${Math.max(0, Math.floor(seconds))}S`}
      data-provider={provider ?? undefined}
      data-playdeck-part="time"
      data-state={hasDuration ? 'timed' : 'untimed'}
      data-time-type={type}
    >
      {children ?? display}
    </time>
  );
};
