import { isNativeActivationTarget } from './controls.js';
import { usePlayer, usePlayerState } from './player-context.js';
import { assignRef } from './viewport-media.js';
import {
  useCallback,
  useEffect,
  useRef,
  type ComponentPropsWithRef
} from 'react';

const DOUBLE_TAP_WINDOW_MS = 300;

/**
 * Full-bleed gesture layer (`position: absolute; inset: 0`) with no
 * z-index. Place it BEFORE (as an earlier sibling of) interactive layers
 * like `Controls`/`ActivationButton` — but tree order alone only decides
 * paint order among *positioned* siblings. A positioned, `z-index: auto`
 * sibling paints above non-positioned in-flow content regardless of where
 * either sits in the tree, so a later sibling stays clickable only if it is
 * itself positioned. `ActivationButton` already positions itself inline;
 * neither shipped stylesheet (`theme.css`, `docked.css`) positions
 * `controls`, so a composition that pairs this layer with one of them must
 * position the bar itself. `[data-playdeck-part="controls"] { position:
 * relative; }` is the general fix — it satisfies the rule without moving
 * the bar from where the stylesheet laid it out. A composition that
 * overlays the bar on the picture, the way theme.css's own look does,
 * already positions it absolutely (e.g. `position: absolute; inset: auto 0
 * 0 0`), which satisfies the same rule. Skip both and this layer covers the
 * unpositioned bar and swallows its clicks, even placed first.
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
  onPointerDown,
  onPointerUp,
  ref,
  style,
  ...props
}: GesturesProps) => {
  const { controller } = usePlayer();
  const seekStatus = usePlayerState((state) => state.capabilities.seek.status);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the primary pointer is currently down, and whether a second
  // (non-primary) pointer joined while it was. Both clear on the primary
  // pointer's own lift and again on the next primary press, so a stray
  // primary `pointerup` with no preceding `pointerdown` on this layer (a
  // press that started outside it, or a pointer captured elsewhere) never
  // inherits a record from an earlier gesture. A `pointercancel` on the
  // primary leaves both stuck until then, which the next primary press
  // resets, so no separate handling for it is needed.
  const primaryPointerDown = useRef(false);
  const multiTouchDuringPrimary = useRef(false);
  // `...props` carries the consumer's `ref` too (React 19 treats it as a
  // plain prop), so this merges it with `layerRef` rather than letting the
  // internal `ref` below win by attaching last. The cleanup this returns
  // clears `layerRef` itself rather than trusting a second call with `null`:
  // if the consumer's own ref is a callback that returns a cleanup, React
  // runs only that cleanup on detach and never calls this function again.
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      layerRef.current = node;
      const consumerCleanup = assignRef(ref, node);
      if (!node) return;
      return () => {
        layerRef.current = null;
        if (consumerCleanup) consumerCleanup();
        else assignRef(ref, null);
      };
    },
    [ref]
  );

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
      data-playdeck-part="gestures"
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented) return;
        if (event.isPrimary) {
          // A fresh primary press starts a new gesture: clear whatever a
          // previous gesture (or an uncancelled one) left behind.
          primaryPointerDown.current = true;
          multiTouchDuringPrimary.current = false;
          return;
        }
        if (primaryPointerDown.current) {
          multiTouchDuringPrimary.current = true;
        }
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        if (event.defaultPrevented) return;
        // Consumed here rather than left for the next primary `pointerdown`
        // to clear: a primary `pointerup` can arrive with no preceding
        // primary `pointerdown` on this layer (a press that started outside
        // it, or a pointer captured elsewhere), and that lift must not
        // inherit a record left by an earlier gesture.
        let joinedByASecondPointer = false;
        if (event.isPrimary) {
          joinedByASecondPointer = multiTouchDuringPrimary.current;
          primaryPointerDown.current = false;
          multiTouchDuringPrimary.current = false;
        }
        // Ignore a second (or later) touch point in a multi-touch gesture,
        // and a non-primary mouse button (e.g. a right-click): neither is a
        // tap, and letting either fall through would both misread a pinch
        // as a double-tap seek and let a right-click toggle controls. A
        // plain `return` here leaves any pending first tap exactly as it
        // was, so an ignored event in between two real taps cannot reset or
        // consume the pending-tap state.
        if (!event.isPrimary || event.button !== 0) return;
        // Ignore taps that land on a real control inside the layer.
        if (isNativeActivationTarget(event.target)) return;
        // A second pointer joined while this primary pointer was down: this
        // primary pointer's lift is the end of that multi-touch gesture, not
        // a tap. Leave any pending single tap from an earlier, genuine tap
        // untouched, the same way the other ignored-event cases above do.
        if (joinedByASecondPointer) return;

        if (pendingTap.current !== null) {
          // Second tap within the window.
          clearTimeout(pendingTap.current);
          pendingTap.current = null;
          if (!doubleTapSeek) {
            // No double-tap action to disambiguate against — a single toggle, not two.
            onToggleControls?.();
            return;
          }
          // Seeking isn't available (e.g. a live source with no DVR
          // window): the tap is consumed as a double tap either way, but a
          // double tap that can't seek does nothing rather than falling
          // back to the single-tap toggle -- it was never a single tap, and
          // toggling controls in response to two taps that landed on the
          // video would surprise a person who has learned this gesture
          // means "seek" everywhere else it works.
          if (seekStatus !== 'available') return;
          const node = layerRef.current;
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const forward = event.clientX - rect.left >= rect.width / 2;
          // A double tap is a person seeking, so the seek carries `'user'` the
          // way the scrubber's and the shortcut layer's do (#186).
          void controller.seekByWithOrigin(
            forward ? seekOffset : -seekOffset,
            'user'
          );
          onSeek?.(forward ? 'forward' : 'backward', seekOffset);
          return;
        }
        // First tap → wait to see if a second arrives.
        pendingTap.current = setTimeout(() => {
          pendingTap.current = null;
          onToggleControls?.();
        }, DOUBLE_TAP_WINDOW_MS);
      }}
      ref={setRef}
      style={{ position: 'absolute', inset: 0, ...style }}
    >
      {children}
    </div>
  );
};
