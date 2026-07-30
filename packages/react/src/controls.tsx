import { resolveCaptionToggle } from './captions.js';
import { usePlayer, usePlayerState } from './player-context.js';
import { assignRef } from './viewport-media.js';
import {
  useCallback,
  useEffect,
  useRef,
  type ComponentPropsWithRef
} from 'react';

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

export const isNativeActivationTarget = (node: EventTarget | null): boolean =>
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
