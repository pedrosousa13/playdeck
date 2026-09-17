import { controlTargetStyle } from './loading-error.js';
import { usePlayer, usePlayerState } from './player-context.js';
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
 * Where `capabilities.liveEdge` is `available`, this is the button: pressing
 * it issues `PlayerController.seekToLiveEdge()`, following the same
 * consumer-`onClick`/`preventDefault` contract every other command-issuing
 * part in this package uses (see `PlayButton`, above `PlayButtonProps`).
 *
 * Where it is not `available`, the part stays mounted as a non-interactive
 * LIVE badge instead of vanishing -- a deliberate, named exception to the
 * uniform rule this package otherwise holds without exception (stated in
 * `packages/react/README.md`, beside its capability-gating rule, and in
 * `CONTEXT.md`'s **Availability** entry): "a control whose command the active
 * provider cannot honour renders nothing rather than rendering disabled."
 * `LiveIndicator` is an indicator, not a control: it reports a property of
 * the stream (that it is live, and whether the viewer is at its edge), it
 * does not offer a command of its own. Being live is true whether or not a
 * seek-to-edge command exists on the active provider, and hiding the badge
 * because a *different* capability (`liveEdge`) is unavailable would suppress
 * something true. `disabled` (never `aria-disabled`) is what keeps it
 * genuinely non-interactive in that state -- out of the tab order, announced
 * unavailable. A future reader who finds a capability-gated part that does
 * not use the uniform gate should find this paragraph beside it, not read it
 * as drift and "fix" it.
 *
 * The `disabled` badge is not a stand-in for a feature that is missing: the
 * two behaviours coexist. `available` gets the `onClick` and sheds
 * `disabled`; `unavailable` keeps `disabled` permanently, for the reason
 * above.
 */
export const LiveIndicator = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: LiveIndicatorProps) => {
  const { live, status } = usePlayerState((state) => ({
    live: state.live,
    status: state.capabilities.liveEdge.status
  }));
  const { controller } = usePlayer();
  if (live === null) return null;
  const seekable = status === 'available';

  return (
    <button
      {...props}
      aria-label={ariaLabel ?? 'Live'}
      data-playdeck-part="live"
      data-state={live.atLiveEdge ? 'at-edge' : 'behind-edge'}
      disabled={!seekable}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !seekable) return;
        void controller.seekToLiveEdge();
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? 'Live'}
    </button>
  );
};
