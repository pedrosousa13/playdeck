import { type TextTrack } from '@reely/core';
import { isNativeActivationTarget } from './controls.js';
import { CaptionsIcon, CheckIcon, SettingsIcon } from './icons.js';
import { controlTargetStyle } from './loading-error.js';
import { usePlayer, usePlayerState } from './player-context.js';
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

export {
  AirPlayButton,
  FullscreenButton,
  PipButton
} from './display-controls.js';

export type {
  AirPlayButtonProps,
  FullscreenButtonProps,
  PipButtonProps
} from './display-controls.js';

export { Controls } from './controls.js';

export type { ControlsProps } from './controls.js';

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
