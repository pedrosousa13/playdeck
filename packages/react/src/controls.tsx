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

// `<input>` types that act on Space or Enter instead of taking text: these
// submit, toggle, or open a picker. They are conceded those two keys below
// exactly as a <button> is, and a CSS `button` selector matches <button> only,
// so each one has to be named.
const activationInputTypes = [
  'button',
  'submit',
  'reset',
  'image',
  'checkbox',
  'radio',
  'color',
  'file'
] as const;

// `<input>` types that take no text. The two lists ask different questions —
// this one whether a keystroke is being typed, the one above whether Space and
// Enter belong to the control — and they differ deliberately by `range` alone,
// the one type that is neither: it takes no text, and it answers arrows rather
// than Space, which is precisely the key group the layer owns on it. Every
// other type — including an unknown or absent one — counts as text entry,
// which fails safe: protecting text entry is the point of the rule.
const nonTextInputTypes = new Set<string>([...activationInputTypes, 'range']);

// Classified by what the control does with a keystroke, not by tag name, so a
// focused range input (a seek or volume slider) no longer swallows the whole
// map. Text entry swallows every key: nothing typed can mean a shortcut.
const isTextEntryTarget = (node: EventTarget | null): boolean => {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (node instanceof HTMLInputElement)
    return !nonTextInputTypes.has(node.type);
  const tag = node.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT';
};

const isInOpenMenu = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement &&
  node.closest(
    '[role="menu"], [role="menubar"], [role="listbox"], [data-reely-menu="open"]'
  ) !== null;

const nativeActivationSelector = 'button, [role="button"], a[href], summary';

export const isNativeActivationTarget = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement &&
  node.closest(nativeActivationSelector) !== null;

const activationInputSelector = activationInputTypes
  .map((type) => `input[type="${type}"]`)
  .join(', ');

// Space and Enter belong to the focused control on these targets — a checkbox
// toggles on Space, a submit input activates on either, exactly as a button
// does. While focus is on one, a binding on either key is inert; every other
// bound key still fires.
const ownsActivationKeys = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement &&
  node.closest(`${nativeActivationSelector}, ${activationInputSelector}`) !==
    null;

// Every action the layer knows, and — because one key can reach two of them —
// the order a key resolves in: the first match here wins, whatever order a
// consumer wrote their bindings object in. The union below is derived from
// this list, so an action cannot exist without a place in the order.
const shortcutActions = [
  'togglePlayback',
  'seekBackward',
  'seekForward',
  'seekBackwardLarge',
  'seekForwardLarge',
  'volumeUp',
  'volumeDown',
  'toggleMuted',
  'toggleFullscreen',
  'toggleCaptions'
] as const;

export type ShortcutAction = (typeof shortcutActions)[number];

export type ShortcutBindings = {
  readonly [action in ShortcutAction]?: string | readonly string[] | null;
};

const defaultBindings: {
  readonly [action in ShortcutAction]: readonly string[];
} = {
  togglePlayback: [' ', 'k'],
  seekBackward: ['ArrowLeft'],
  seekForward: ['ArrowRight'],
  seekBackwardLarge: ['j', 'PageDown'],
  seekForwardLarge: ['l', 'PageUp'],
  volumeUp: ['ArrowUp'],
  volumeDown: ['ArrowDown'],
  toggleMuted: ['m'],
  toggleFullscreen: ['f'],
  toggleCaptions: ['c']
};

const seekSeconds = {
  seekBackward: -5,
  seekForward: 5,
  seekBackwardLarge: -10,
  seekForwardLarge: 10
} as const;

// Case-insensitive while both sides are a single character, so one bound `k`
// still answers `K` without a consumer listing both.
const keyMatches = (bound: string, key: string): boolean =>
  bound.length === 1 && key.length === 1
    ? bound.toLowerCase() === key.toLowerCase()
    : bound === key;

const boundKeys = (
  bindings: ShortcutBindings | undefined,
  action: ShortcutAction
): readonly string[] => {
  const bound = bindings?.[action];
  // An action a consumer does not name keeps its default; `null` suppresses.
  if (bound === undefined) return defaultBindings[action];
  if (bound === null) return [];
  return typeof bound === 'string' ? [bound] : bound;
};

const resolveShortcutAction = (
  bindings: ShortcutBindings | undefined,
  key: string
): ShortcutAction | null =>
  shortcutActions.find((action) =>
    boundKeys(bindings, action).some((bound) => keyMatches(bound, key))
  ) ?? null;

export type ControlsProps = ComponentPropsWithRef<'div'> & {
  /**
   * Attach the shortcut listener to the document instead of scoping it to
   * this region. Global shortcuts are opt-in; by default keys only fire while
   * focus is inside the controls region.
   */
  readonly global?: boolean;
  /**
   * Key bindings for the shortcut layer. Omitted, the default map applies.
   * `false` turns the layer off entirely — in global mode no document
   * listener is attached at all. An object overrides individual actions
   * (`null` suppresses one); every action it does not name keeps its default.
   *
   * A key is a `KeyboardEvent.key` value — `' '`, `'k'`, `'ArrowLeft'`,
   * `'PageUp'` — and a single-character key matches either case, so `'k'`
   * answers `K` too. The defaults, which an override replaces rather than
   * adds to:
   *
   * - `togglePlayback`: `' '`, `'k'`
   * - `seekBackward` / `seekForward`: `'ArrowLeft'` / `'ArrowRight'` (5s)
   * - `seekBackwardLarge`: `'j'`, `'PageDown'` (10s back)
   * - `seekForwardLarge`: `'l'`, `'PageUp'` (10s forward)
   * - `volumeUp` / `volumeDown`: `'ArrowUp'` / `'ArrowDown'` (0.05)
   * - `toggleMuted`: `'m'`
   * - `toggleFullscreen`: `'f'`
   * - `toggleCaptions`: `'c'`
   *
   * Hoist this object or `useMemo` it: a fresh literal on every render
   * re-attaches the global listener.
   */
  readonly shortcuts?: false | ShortcutBindings;
};

export const Controls = ({
  'aria-label': ariaLabel,
  children,
  global = false,
  onBlur,
  onFocus,
  onKeyDown,
  ref,
  shortcuts,
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
      if (shortcuts === false) return;
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (isTextEntryTarget(target) || isInOpenMenu(target)) return;
      const action = resolveShortcutAction(shortcuts, event.key);
      if (action === null) return;
      if (
        (event.key === ' ' || event.key === 'Enter') &&
        ownsActivationKeys(target)
      )
        return;

      switch (action) {
        case 'togglePlayback':
          event.preventDefault();
          void controller.togglePlaybackWithOrigin('user');
          return;
        case 'seekBackward':
        case 'seekForward':
        case 'seekBackwardLarge':
        case 'seekForwardLarge':
          if (seekStatus !== 'available') return;
          // The layer owns the seek keys everywhere in the region: preventing
          // the default keeps a focused range input's own stepping out of it,
          // so the distance travelled never depends on where focus sits. That
          // also means a consumer `step` and `onChange` on `SeekSlider`'s
          // input no longer see arrow presses; `shortcuts={{ seekBackward:
          // null, seekForward: null }}` hands the arrows back to the input.
          event.preventDefault();
          void controller.seekBy(seekSeconds[action]);
          return;
        case 'volumeUp':
        case 'volumeDown': {
          if (volumeStatus !== 'available') return;
          event.preventDefault();
          const delta = action === 'volumeUp' ? 0.05 : -0.05;
          const next = Math.min(
            1,
            Math.max(0, Math.round((volume + delta) * 100) / 100)
          );
          if (muted && next > 0) void controller.unmute();
          void controller.setVolume(next);
          return;
        }
        case 'toggleMuted':
          if (volumeStatus !== 'available') return;
          event.preventDefault();
          void controller.toggleMuted();
          return;
        case 'toggleFullscreen':
          if (fullscreenStatus !== 'available') return;
          event.preventDefault();
          void (fullscreen
            ? controller.exitFullscreen()
            : controller.requestFullscreen());
          return;
        case 'toggleCaptions': {
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
      shortcuts,
      textTracks,
      volume,
      volumeStatus
    ]
  );

  useEffect(() => {
    if (!global || shortcuts === false) return;
    const listener = (event: KeyboardEvent): void => handleShortcut(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [global, handleShortcut, shortcuts]);

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
      // shortcuts by default — see `shortcuts` for the map, which a consumer
      // can rebind or remove — rather than roving-tabindex toolbar
      // navigation. Native controls inside keep
      // whatever keys the layer does not bind — text entry keeps all of them,
      // and a focused button or checkbox keeps Space and Enter.
      role="group"
      style={style}
      tabIndex={tabIndex ?? 0}
    >
      {children}
    </div>
  );
};
