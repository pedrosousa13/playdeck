import { isNativeActivationTarget } from './controls.js';
import { usePlayer } from './player-context.js';
import { useEffect, useRef, type ComponentPropsWithRef } from 'react';

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
      data-playdeck-part="gestures"
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
      ref={layerRef}
      style={{ position: 'absolute', inset: 0, ...style }}
    >
      {children}
    </div>
  );
};
