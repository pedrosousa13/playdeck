import type { PlayerError } from '@playdeck/core';
import { usePlayer, usePlayerState } from './player-context.js';
import {
  useEffect,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ReactNode
} from 'react';

export type ActivationButtonProps = ComponentPropsWithRef<'button'>;

// #160: `margin: auto` is a no-op on the default path — with `inset: 0` and an
// auto width and height, CSS 2.1 §10.3.7 (inline axis) and §10.6.4 (block axis)
// both resolve auto margins to zero, so the unstyled overlay is still the
// full-bleed click target. It engages only once a stylesheet gives the box a
// fixed size, which four zero offsets over-constrain: without it the leftover
// space all falls to `right`/`bottom` and the box lands in the corner. Stating
// it here rather than in `theme.css` centres the box for any consumer
// stylesheet that sizes this part, not just the bundled theme.
const activationOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  margin: 'auto',
  zIndex: 30
};

export const ActivationButton = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: ActivationButtonProps) => {
  const { activateFromInteraction, loading } = usePlayer();
  const { activation, error } = usePlayerState((state) => ({
    activation: state.activation,
    error: state.error
  }));
  if (loading !== 'interaction' || activation === 'ready') return null;
  const isError = activation === 'error';
  const isLoading = activation === 'loading-provider';
  // Retryability is the state's to state, through `recoverable` (see
  // `PlayerError` in @playdeck/core), and is never re-derived from the error's
  // category here (#198): a notice that says nothing about retrying must not
  // disable this control. An activation error carrying no error record says
  // nothing either, so it stays retryable, as it always was.
  const canRetry = isError && error?.recoverable !== false;
  const isDisabled = isLoading || (isError && !canRetry);
  const label = ariaLabel ?? (canRetry ? 'Retry loading video' : 'Play video');
  return (
    <button
      {...props}
      aria-disabled={isDisabled || undefined}
      aria-label={label}
      data-playdeck-part="activation"
      data-state={activation}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !isDisabled) {
          activateFromInteraction();
        }
      }}
      style={{ ...activationOverlayStyle, ...style }}
      type="button"
    >
      {children ?? (canRetry ? 'Retry' : 'Play')}
    </button>
  );
};

export const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
};

// --- buffering/stall presentation (#35) -------------------------------------
// `state.buffering` is the raw provider signal (`waiting`, `bufferstart`,
// YouTube state 3), so it flaps: a short rebuffer under healthy adaptive
// bitrate would strobe the indicator. The policy debounces here rather than in
// core, so `state.buffering` stays truthful for analytics consumers and no
// timer lifecycle enters the core state machine. Full rationale:
// docs/superpowers/specs/2026-07-26-buffering-stall-policy-35-design.md
const BUFFERING_SHOW_DELAY_MS = 500;
// Once anything is shown it stays shown this long. A show delay alone does not
// stop flicker: a stall lasting 550ms would paint for 50ms, and that is the
// flicker. Applies to `loading-provider` too — a fast provider load strobes the
// indicator the same way a short rebuffer does.
const LOADING_MIN_VISIBLE_MS = 500;

type LoadingPresentation = 'loading-provider' | 'buffering' | null;

export const useLoadingPresentation = (): LoadingPresentation => {
  const { activation, buffering } = usePlayerState((state) => ({
    activation: state.activation,
    buffering: state.buffering
  }));
  const desired: LoadingPresentation =
    activation === 'error'
      ? null
      : activation === 'loading-provider'
        ? 'loading-provider'
        : buffering
          ? 'buffering'
          : null;
  const [shown, setShown] = useState<LoadingPresentation>(null);
  const [floorExpired, setFloorExpired] = useState(true);
  const visible = shown !== null;

  // Adjusted during render rather than from an effect. Every branch below is a
  // conclusion that follows directly from the state just read, so an effect
  // would only add a wasted commit — and `react-hooks/set-state-in-effect`
  // rightly rejects that shape. Each branch is guarded so it is a no-op once
  // applied, so this converges in one extra render pass, before paint.
  if (desired === null) {
    // A terminal error overrides the floor with no wait: it must not hold
    // "Buffering" on top of ErrorDisplay.
    if (visible && (floorExpired || activation === 'error')) {
      setShown(null);
      setFloorExpired(true);
    }
  } else if (visible && shown !== desired) {
    // Already on screen: swap the label with no delay. Hiding for 500ms across
    // `loading-provider` -> `buffering` would manufacture the very flicker the
    // delay exists to remove.
    setShown(desired);
  } else if (!visible && desired === 'loading-provider') {
    // Nothing is on screen yet, so there is nothing to flicker against.
    setShown('loading-provider');
    setFloorExpired(false);
  }

  // A stall is admitted only after it has run uninterrupted for the delay.
  // Cleanup runs before the next effect pass and on unmount, so a stall that
  // clears inside the window cancels rather than fires late.
  useEffect(() => {
    if (desired !== 'buffering' || visible) return;
    const timer = setTimeout(() => {
      setShown('buffering');
      setFloorExpired(false);
    }, BUFFERING_SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [desired, visible]);

  // Keyed on `visible`, not on `shown`, so a `loading-provider` -> `buffering`
  // label swap does not restart the floor: it bounds the visible period, not
  // the label.
  useEffect(() => {
    if (!visible || floorExpired) return;
    const timer = setTimeout(
      () => setFloorExpired(true),
      LOADING_MIN_VISIBLE_MS
    );
    return () => clearTimeout(timer);
  }, [visible, floorExpired]);

  return shown;
};

/**
 * Surfaces provider loading and mid-playback stalls as a polite live region.
 *
 * `data-state` is `loading-provider`, `buffering` or `idle`; both active states
 * share one full-bleed box, so styling the two differently is a CSS decision,
 * not a prop.
 *
 * Debounced (#35): a stall must persist 500ms before it is admitted, and once
 * admitted it is held 500ms, so a short rebuffer never strobes the indicator.
 * A provider load shows immediately — there is nothing on screen to flicker
 * against — but is held by the same 500ms floor. A terminal activation error
 * clears the indicator at once, overriding both timers. `state.buffering`
 * remains the raw, undebounced provider signal for consumers who want it.
 */
export type LoadingIndicatorProps = ComponentPropsWithRef<'div'>;

const loadingOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 30,
  pointerEvents: 'none'
};

const loadingHiddenStyle: CSSProperties = {
  ...visuallyHiddenStyle,
  pointerEvents: 'none'
};

export const LoadingIndicator = ({
  children,
  style,
  ...props
}: LoadingIndicatorProps) => {
  const active = useLoadingPresentation();
  // The live region stays mounted (empty when idle) so a screen reader
  // announces the buffering/loading transition. A region that mounts already
  // populated is typically not announced. It must not, however, occupy the
  // viewport while idle: a full-bleed `position: absolute; inset: 0` box outranks
  // any consumer content beneath z-index 30, and even empty and
  // `pointer-events: none`, that geometry alone makes automated color-contrast
  // checks unable to resolve a background for any text in the player (#32).
  // Visually hide it instead while idle, and only switch to the full-bleed
  // overlay once there is something to actually show above the composition.
  return (
    <div
      {...props}
      aria-live="polite"
      data-playdeck-part="loading-indicator"
      data-state={active ?? 'idle'}
      role="status"
      // The *branch* is state-derived and stays the primitive's; the contents
      // of each branch are static geometry, so `...style` wins inside both.
      style={
        active
          ? { ...loadingOverlayStyle, ...style }
          : { ...loadingHiddenStyle, ...style }
      }
    >
      {active
        ? (children ??
          (active === 'loading-provider' ? 'Loading video' : 'Buffering'))
        : null}
    </div>
  );
};

/**
 * Render-prop context handed to `ErrorDisplay` children. `retry` is `null`
 * when the current error is not recoverable, so custom renderers stay
 * capability-aware — a retry action is never offered where the error cannot be
 * retried.
 */
export type ErrorDisplayRenderProps = {
  readonly error: PlayerError;
  readonly retry: (() => void) | null;
};

export type ErrorDisplayProps = Omit<
  ComponentPropsWithRef<'div'>,
  'children'
> & {
  readonly children?: (context: ErrorDisplayRenderProps) => ReactNode;
};

const errorOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 40
};

export const ErrorDisplay = ({
  children,
  style,
  ...props
}: ErrorDisplayProps) => {
  const { error, provider } = usePlayerState((state) => ({
    error: state.error,
    provider: state.provider
  }));
  const { controller } = usePlayer();
  if (!error) return null;
  // `recoverable` is the state-level signal that a retry is worth offering (see
  // `PlayerError` in @playdeck/core), and `ActivationButton` reads the same one.
  // Absent — not disabled — when it does not hold (issue #34 capability rule).
  const retry = error.recoverable
    ? () => {
        void controller.retry();
      }
    : null;

  return (
    <div
      {...props}
      data-provider={provider ?? undefined}
      data-playdeck-part="error"
      data-state={error.category}
      role="alert"
      style={{ ...errorOverlayStyle, ...style }}
    >
      {children ? (
        children({ error, retry })
      ) : (
        <>
          <p data-playdeck-part="error-message">{error.message}</p>
          {retry && (
            <button
              data-playdeck-part="error-retry"
              onClick={retry}
              style={controlTargetStyle}
              type="button"
            >
              Retry
            </button>
          )}
        </>
      )}
    </div>
  );
};

export const controlTargetStyle: CSSProperties = {
  minWidth: 44,
  minHeight: 44
};
