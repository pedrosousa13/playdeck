import { type TextTrack } from '@reely/core';
import { resolveCaptionToggle } from './captions.js';
import { CaptionsIcon, CheckIcon, SettingsIcon } from './icons.js';
import { controlTargetStyle } from './loading-error.js';
import { usePlayer, usePlayerState } from './player-context.js';
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

export { Captions, CaptionsButton } from './captions.js';

export type { CaptionsButtonProps, CaptionsProps } from './captions.js';

export {
  MuteButton,
  PlayButton,
  SeekSlider,
  Time,
  VolumeSlider
} from './transport-controls.js';

export type {
  MuteButtonProps,
  PlayButtonProps,
  SeekSliderProps,
  TimeProps,
  VolumeSliderProps
} from './transport-controls.js';

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
