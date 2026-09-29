import { CheckIcon, SettingsIcon } from './icons.js';
import { controlTargetStyle } from './loading-error.js';
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

type SettingsMenuContextValue = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly close: () => void;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly triggerId: string;
  readonly contentId: string;
  // Which item the open-autofocus effect below should land on. Set by
  // SettingsMenuTrigger immediately before every `setOpen(true)`, so it
  // carries no state across opens -- an ArrowUp open followed by Escape and
  // an ArrowDown open reads 'first' on the second open, not a leftover
  // 'last' from the one before it.
  readonly openFocusRef: RefObject<'first' | 'last'>;
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

export type SettingsMenuProps = ComponentPropsWithRef<'div'>;

export const SettingsMenu = ({
  children,
  ref,
  style,
  ...props
}: SettingsMenuProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openFocusRef = useRef<'first' | 'last'>('first');
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
    contentId: `${baseId}-content`,
    openFocusRef
  };
  // `...props` carries the consumer's `ref` too (React 19 treats it as a
  // plain prop), so this merges it with `rootRef` rather than letting the
  // internal `ref` below win by attaching last. The cleanup this returns
  // clears `rootRef` itself rather than trusting a second call with `null`:
  // if the consumer's own ref is a callback that returns a cleanup, React
  // runs only that cleanup on detach and never calls this function again.
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      const consumerCleanup = assignRef(ref, node);
      if (!node) return;
      return () => {
        rootRef.current = null;
        if (consumerCleanup) consumerCleanup();
        else assignRef(ref, null);
      };
    },
    [ref]
  );
  return (
    <SettingsMenuContext.Provider value={value}>
      <div
        {...props}
        data-playdeck-part="settings-menu-root"
        data-state={open ? 'open' : 'closed'}
        ref={setRootRef}
        style={{ position: 'relative', ...style }}
      >
        {children}
      </div>
    </SettingsMenuContext.Provider>
  );
};

export type SettingsMenuTriggerProps = ComponentPropsWithRef<'button'>;

export const SettingsMenuTrigger = ({
  children,
  onClick,
  onKeyDown,
  ref,
  style,
  ...props
}: SettingsMenuTriggerProps) => {
  const { open, setOpen, triggerRef, triggerId, contentId, openFocusRef } =
    useSettingsMenu();
  // Merges the consumer's `ref` (arriving through `...props` below) with
  // `triggerRef`, which `close()` reads from context to restore focus -- so a
  // stale `triggerRef` here would point `close()` at a detached button after
  // this trigger unmounts while `SettingsMenu` and `SettingsMenuContent`
  // stay mounted. See the `setRootRef` comment above for why the cleanup
  // below clears `triggerRef` itself rather than trusting a second call with
  // `null`.
  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      const consumerCleanup = assignRef(ref, node);
      if (!node) return;
      return () => {
        triggerRef.current = null;
        if (consumerCleanup) consumerCleanup();
        else assignRef(ref, null);
      };
    },
    [ref, triggerRef]
  );
  return (
    <button
      {...props}
      aria-controls={open ? contentId : undefined}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={props['aria-label'] ?? 'Settings'}
      data-playdeck-part="settings-menu-trigger"
      data-state={open ? 'open' : 'closed'}
      id={triggerId}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (!open) openFocusRef.current = 'first';
        setOpen(!open);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          // WAI-ARIA menu button pattern: ArrowUp opens onto the last item,
          // ArrowDown (and click/Enter/Space, above) onto the first.
          openFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
          setOpen(true);
        }
      }}
      ref={setTriggerRef}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? <SettingsIcon />}
    </button>
  );
};

export type SettingsMenuContentProps = ComponentPropsWithRef<'div'>;

export const SettingsMenuContent = ({
  children,
  onFocus,
  onKeyDown,
  ref,
  style,
  tabIndex,
  ...props
}: SettingsMenuContentProps) => {
  const { open, close, setOpen, rootRef, triggerId, contentId, openFocusRef } =
    useSettingsMenu();
  const contentRef = useRef<HTMLDivElement | null>(null);
  // The item roving focus currently sits on, tracked live off `onFocus`
  // below rather than recomputed from `document.activeElement` -- by the
  // time the removal-repair effect runs, the item's DOM node (and thus
  // `document.activeElement`) may already be gone, which is exactly the
  // case it exists to detect.
  const focusedItemRef = useRef<HTMLElement | null>(null);
  const focusedIndexRef = useRef(0);
  // Merges the consumer's `ref` (arriving through `...props` below) with
  // `contentRef`, which the autofocus effect below and the keyboard handlers
  // further below both need for roving focus -- see the `setRootRef` comment
  // above for why the cleanup below clears `contentRef` itself rather than
  // trusting a second call with `null`.
  const setContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      const consumerCleanup = assignRef(ref, node);
      if (!node) return;
      return () => {
        contentRef.current = null;
        if (consumerCleanup) consumerCleanup();
        else assignRef(ref, null);
      };
    },
    [ref]
  );

  // Autofocus the first item when the menu opens, or the last when
  // SettingsMenuTrigger's ArrowUp requested it (openFocusRef, set just
  // before the `setOpen(true)` that led here). Reset on close so a stale
  // reference from a prior open cycle can never satisfy the removal-repair
  // effect below.
  useEffect(() => {
    if (!open) {
      focusedItemRef.current = null;
      return;
    }
    const items = menuItems(contentRef.current);
    const target =
      openFocusRef.current === 'last' ? items[items.length - 1] : items[0];
    target?.focus();
  }, [open, openFocusRef]);

  // Safeguard for QualityMenu/AudioTrackMenu re-rendering with a shorter
  // item list while the menu is open: if the item that held focus is no
  // longer in the roving-focus list, the browser has already dropped focus
  // to <body> (its DOM node is gone), and nothing else would move it back --
  // Escape/arrow keys/Home/End are handled on this element, not <body>, so
  // the menu would be stuck open with no keyboard escape. Follows the
  // WAI-ARIA APG rearrangeable-listbox precedent: land on the item now at
  // the removed item's index, or the new last item if it was last, or close
  // the menu if none remain.
  //
  // Deliberately no dependency array: the item list can shrink from a
  // parent re-render for reasons this component has no prop to depend on
  // (QualityMenu/AudioTrackMenu build a new children tree every render
  // regardless of whether their list changed), so this re-checks the live
  // DOM after every commit rather than trying to name what changed.
  useEffect(() => {
    if (!open) return;
    const focused = focusedItemRef.current;
    if (!focused) return;
    const items = menuItems(contentRef.current);
    const index = items.indexOf(focused);
    if (index !== -1) {
      // Still there -- not what moved. Keep the tracked index current even
      // though no focus event fired: a re-render that inserts an item ahead
      // of the focused one shifts its index without ever refocusing it, and
      // this is the only other point that ever sees the new position.
      focusedIndexRef.current = index;
      return;
    }
    // The tracked item is gone, but that alone does not mean focus was
    // lost -- a click on the menu's own padding, or consumer code focusing
    // something outside the menu, both move focus deliberately while `open`
    // stays true, and onFocus below only knows to clear the tracked item for
    // the first of those (an outside focus target never fires it, since it
    // isn't a descendant of this element). The one thing that reliably means
    // "the browser dropped focus because the node disappeared" is
    // document.activeElement landing on <body>.
    if (
      document.activeElement !== document.body &&
      document.activeElement !== null
    ) {
      focusedItemRef.current = null; // stale -- stop tracking it
      return;
    }
    if (items.length === 0) {
      close(); // closes the menu and refocuses the trigger
      return;
    }
    items[Math.min(focusedIndexRef.current, items.length - 1)]?.focus();
  });

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
    // The content root is tabbable, so it is also a click target: landing on
    // the menu's padding focuses it and no item is current. That is "no item
    // yet", not index -1 — wrapping from -1 sends ArrowUp to the
    // second-to-last item.
    if (current === -1) {
      items[delta > 0 ? 0 : items.length - 1]?.focus();
      return;
    }
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      {...props}
      aria-labelledby={triggerId}
      data-playdeck-menu="open"
      data-playdeck-part="settings-menu"
      id={contentId}
      onFocus={(event) => {
        onFocus?.(event);
        const items = menuItems(contentRef.current);
        const index = items.indexOf(event.target as HTMLElement);
        if (index === -1) {
          // Focus landed on the root itself, not an item -- stop tracking,
          // so a later removal of whatever used to be focused finds nothing
          // to repair rather than stealing focus back from the root.
          focusedItemRef.current = null;
          return;
        }
        focusedItemRef.current = items[index] ?? null;
        focusedIndexRef.current = index;
      }}
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
      ref={setContentRef}
      role="menu"
      style={style}
      // Deliberately a default, not a fixed value: a bounded menu is a
      // scrollable region whose items are all `tabIndex={-1}`, so the root
      // has to be tabbable to satisfy `scrollable-region-focusable`, but a
      // consumer-supplied value — `-1` included — still wins, the same shape
      // `Player.Controls` uses.
      tabIndex={tabIndex ?? 0}
    >
      {children}
    </div>
  );
};

export type MenuItemProps = ComponentPropsWithRef<'button'> & {
  readonly onSelect?: () => void;
};

export const MenuItem = ({
  children,
  onClick,
  onSelect,
  style,
  ...props
}: MenuItemProps) => {
  const { close } = useSettingsMenu();
  return (
    <button
      {...props}
      data-playdeck-part="menu-item"
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

export type MenuRadioGroupProps = ComponentPropsWithRef<'div'> & {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
};

export const MenuRadioGroup = ({
  value,
  onValueChange,
  children,
  ...props
}: MenuRadioGroupProps) => (
  <MenuRadioContext.Provider value={{ value, onValueChange }}>
    <div {...props} data-playdeck-part="menu-radio-group" role="group">
      {children}
    </div>
  </MenuRadioContext.Provider>
);

export type MenuRadioItemProps = ComponentPropsWithRef<'button'> & {
  readonly value: string;
};

export const MenuRadioItem = ({
  value,
  children,
  onClick,
  style,
  ...props
}: MenuRadioItemProps) => {
  const { value: selected, onValueChange } = useMenuRadio();
  const { close } = useSettingsMenu();
  const checked = selected === value;
  return (
    <button
      {...props}
      aria-checked={checked}
      data-playdeck-part="menu-radio-item"
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
      <span aria-hidden data-playdeck-part="menu-radio-indicator">
        {checked ? <CheckIcon /> : null}
      </span>
      {children}
    </button>
  );
};
