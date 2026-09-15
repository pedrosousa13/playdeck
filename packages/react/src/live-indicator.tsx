import { controlTargetStyle } from './loading-error.js';
import { usePlayerState } from './player-context.js';
import type { ComponentPropsWithRef } from 'react';

export type LiveIndicatorProps = ComponentPropsWithRef<'button'>;

/**
 * A `live` part reporting live playback state, derived from `PlayerState.live`
 * (`PlayerLiveState`, `@playdeck/core`). `data-state` is `"at-edge"` while the
 * viewer is at the live edge and `"behind-edge"` once they have fallen behind
 * it. Renders nothing when `state.live` is `null` -- not live, or liveness not
 * yet known (that type's own comment). `PlayerLiveState` carries `isLive: true`
 * whenever it is non-null (`deriveLiveState`, `packages/core/src/live-state.ts`
 * returns `null` for every non-live case instead), so those are the only two
 * reachable states.
 *
 * Structurally a `<button type="button">`, and `disabled`: seeking to the live
 * edge is issue #180's, not built yet, so a press here would do nothing today.
 * `disabled` is what keeps it genuinely non-interactive -- out of the tab
 * order, announced unavailable -- rather than `aria-disabled`, which would
 * leave it focusable. That is current behaviour rather than a permanent
 * guarantee: if live-edge seeking is ever wired onto this control, it gains
 * an `onClick` and sheds `disabled`.
 */
export const LiveIndicator = ({
  'aria-label': ariaLabel,
  children,
  style,
  ...props
}: LiveIndicatorProps) => {
  const live = usePlayerState((state) => state.live);
  if (live === null) return null;

  return (
    <button
      {...props}
      aria-label={ariaLabel ?? 'Live'}
      data-playdeck-part="live"
      data-state={live.atLiveEdge ? 'at-edge' : 'behind-edge'}
      disabled
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? 'Live'}
    </button>
  );
};
