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
    '[role="menu"], [role="menubar"], [role="listbox"], [data-playdeck-menu="open"]'
  ) !== null;

const nativeActivationSelector = 'button, [role="button"], a[href], summary';

export const isNativeActivationTarget = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement &&
  // A range input isn't a Space/Enter activation target (see
  // `nonTextInputTypes` above, which keeps it out of `ownsActivationKeys`
  // deliberately) -- but it's still real control surface, so it's included
  // here rather than folded into the shared `nativeActivationSelector`.
  node.closest(`${nativeActivationSelector}, input[type="range"]`) !== null;

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

// WAI-ARIA APG composite-widget roles that answer the arrow keys with their
// own navigation. One list drives the check below, so a role that owns
// arrows outside the player is added or removed in one place. `menu`,
// `menubar` and `listbox` also silence the whole layer through
// `isInOpenMenu` above; they are named here too because this list answers a
// narrower question — "does this widget use arrows itself" — that stands on
// its own regardless of what else exempts it.
const arrowKeyRoles = [
  'radiogroup',
  'tablist',
  'slider',
  'spinbutton',
  'listbox',
  'menu',
  'menubar',
  'tree',
  'treegrid',
  'grid',
  'toolbar'
] as const;

const arrowKeyRoleSelector = arrowKeyRoles
  .map((role) => `[role="${role}"]`)
  .join(', ');

// Native `<input>` types that step or move on the arrow keys by themselves,
// outside any role above: a radio moves within its name group, a range
// steps its value.
const arrowKeyInputTypes = new Set<string>(['radio', 'range']);

const isArrowKey = (key: string): boolean =>
  key === 'ArrowUp' ||
  key === 'ArrowDown' ||
  key === 'ArrowLeft' ||
  key === 'ArrowRight';

// True for a target that answers arrow keys on its own — a native radio or
// range input, or anything inside one of the composite roles above. A
// `<select>` needs no entry here: `isTextEntryTarget` already silences the
// whole layer for one, arrows included, before this runs. Says nothing about
// whether the target sits inside this player; the caller checks that
// separately, against `arrowKeyOwnershipBoundary` below, so a slider or
// radiogroup the player itself renders keeps the layer's ownership of its
// arrows unchanged (ADR-0005).
const ownsArrowKeysTarget = (node: EventTarget | null): boolean => {
  if (!(node instanceof HTMLElement)) return false;
  if (node instanceof HTMLInputElement && arrowKeyInputTypes.has(node.type))
    return true;
  return node.closest(arrowKeyRoleSelector) !== null;
};

// What "outside the player" is checked against: `Player.Viewport`'s own DOM
// node -- the player's own bounding box (CONTEXT.md's "Viewport" entry) --
// when this region sits inside one, the same viewport part
// `useLiftAboveControls` (`captions.tsx`) already reaches through to find
// `Controls` from outside it. A consumer's own widget composed elsewhere in
// that box, a `SeekSlider` moved outside `Controls` included, is still part
// of this player and keeps the layer's ownership of its arrows, even though
// it sits outside this region's own DOM node. Falls back to the region
// itself where no viewport ancestor exists, which is the boundary this
// check used before a viewport was part of it.
const arrowKeyOwnershipBoundary = (
  region: HTMLElement | null
): HTMLElement | null =>
  region &&
  (region.closest<HTMLElement>('[data-playdeck-part="viewport"]') ?? region);

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
  const { controller, lastSelectedTextTrackId, volumeRequest } = usePlayer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hadFocusWithin = useRef(false);
  // Bumped on every focus into the region, so a blur's deferred check
  // (below) can tell whether a newer focus already reclaimed the flag by
  // the time it runs -- re-focusing inside the region must always win over
  // a stale blur's verdict.
  const focusVersion = useRef(0);
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
      // Arrow keys only, and only outside the player: a widget elsewhere on
      // the page that answers arrows itself keeps them, the same way the
      // region's own range inputs keep every other key while the layer
      // takes theirs (ADR-0005). Inside the player the layer still owns
      // every arrow, its own sliders included and a consumer's own widget
      // composed outside this region but still inside `Player.Viewport`
      // included, which is why this checks `arrowKeyOwnershipBoundary`
      // rather than this region's own containment.
      const boundary = arrowKeyOwnershipBoundary(containerRef.current);
      if (
        isArrowKey(event.key) &&
        target instanceof HTMLElement &&
        boundary &&
        !boundary.contains(target) &&
        ownsArrowKeysTarget(target)
      )
        return;
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
          // Tagged as `PlayButton` and the scrubber tag theirs: owning the keys
          // is what makes this a person seeking rather than an input stepping,
          // so it must not report itself as an API call (#186).
          void controller.seekByWithOrigin(seekSeconds[action], 'user');
          return;
        case 'volumeUp':
        case 'volumeDown': {
          if (volumeStatus !== 'available') return;
          event.preventDefault();
          // The volume the user last asked for while it is still outstanding,
          // and published state otherwise. Published state alone is a stale
          // base: it moves only on the media element's own `volumechange`, so
          // two presses inside one round trip would compute the same target and
          // the second would be a silent no-op (#271). Read straight off the
          // store rather than through a subscription, because this handler
          // needs the value as of the keypress and a subscribed one is only
          // ever as fresh as the last commit — a base that lags the press is
          // the whole of what this reads around. Nothing this region renders
          // shows the request either; `VolumeSlider` subscribes for that.
          //
          // The two sides are different spaces, which nothing else here says: a
          // request is the muted-adjusted volume the thumb shows, while the
          // fallback is the raw published one, which ignores `muted`. They can
          // only disagree while muted with no request outstanding, and that is
          // the one case an arrow must not step at all (#274): the thumb is on
          // the muted zero, so a step off the published volume moves from a
          // number nothing on screen shows, and a downward one lands above zero
          // and turns the sound back on where the user asked for less. `muted`
          // and `volume` are independent, so unmuting on its own restores the
          // published level and leaves `ArrowUp` nothing to step — except at a
          // published zero, which it would restore silently, so there it steps
          // as well. `ArrowDown` has nothing to do at all, and still owns its
          // key: the `preventDefault()` above is what keeps a focused range
          // input from stepping itself in place of the no-op (ADR-0005).
          const requested = volumeRequest.getRequested();
          if (muted && requested === null) {
            if (action === 'volumeDown') return;
            void controller.unmute();
            // The request records where the unmute is going, so the press after
            // it has a base. At a nonzero published volume it asks for the
            // level the player already holds: nothing moves, and the arrow
            // still only unmutes. Without it a second press inside the same
            // round trip would find `muted` still true and still no request,
            // arrive here again, and step nothing — the press lost inside one
            // round trip that #271 exists to prevent, on this path instead.
            // With it that press reads 0.5, steps to 0.55 through the path
            // below, and coalesces into the same chain as ever. A published
            // zero is the one value the request does move, because unmuting
            // alone would restore silence.
            volumeRequest.request(volume === 0 ? 0.05 : volume);
            return;
          }
          const delta = action === 'volumeUp' ? 0.05 : -0.05;
          const base = requested ?? volume;
          const next = Math.min(
            1,
            Math.max(0, Math.round((base + delta) * 100) / 100)
          );
          // Reachable only while muted with a request outstanding — a drag up
          // from the muted zero, or the branch above — where the thumb shows
          // the request instead of the zero and the unmute may not have been
          // answered yet. The request can be zero itself, from a drag up off
          // the muted zero and back down inside one drag, and `next > 0` is
          // what keeps the arrow off `unmute()` while the control is still
          // showing silence.
          if (muted && next > 0) void controller.unmute();
          // The same request `VolumeSlider` renders, so the presses coalesce
          // into one chain and the thumb shows every one of them.
          volumeRequest.request(next);
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
      volumeRequest,
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
  // re-stolen on the next unrelated render -- `hadFocusWithin` is what tells
  // the two apart, and `onBlur`'s deferred check below is what keeps it
  // correct regardless of how, or whether, the browser blurred the control
  // that left. `preventScroll` keeps a legitimate restore from scrolling the
  // page to the region -- the user's scroll position is not evidence the
  // region asked to be seen.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (hadFocusWithin.current && document.activeElement === document.body) {
      node.focus({ preventScroll: true });
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
      data-playdeck-part="controls"
      data-state={global ? 'global' : 'scoped'}
      onBlur={(event) => {
        onBlur?.(event);
        const next = event.relatedTarget as Node | null;
        if (next !== null) {
          if (containerRef.current && !containerRef.current.contains(next)) {
            hadFocusWithin.current = false;
          }
          return;
        }
        // A null relatedTarget is ambiguous, and browsers do not even agree
        // on whether it fires for the one case that must NOT clear the
        // flag. A Playwright probe of the bundled Chromium (149.0.7827.55)
        // and Firefox (151.0) on 2026-09-28 found: focusing a `<button>`
        // and then removing it fires `blur`/`focusout` on it with
        // `relatedTarget: null` in Chromium -- `isConnected` reads `true`
        // if read synchronously inside the listener, but `false` by the
        // time a microtask queued from that same listener runs, once the
        // removal has completed -- while Firefox fires no blur at all.
        // Focusing a `<button>` and then clicking a plain-text paragraph
        // elsewhere on the page fires the same `relatedTarget: null` blur
        // in both browsers, but leaves the button connected. Reading
        // `isConnected` synchronously here can therefore only ever see
        // Chromium's still-connected moment, so the check is deferred to a
        // microtask, by which point a real removal (already underway,
        // synchronously, in the same task as this blur) has finished.
        const blurred = event.target as Node;
        const focusVersionAtBlur = focusVersion.current;
        queueMicrotask(() => {
          // Bail if the region has unmounted, or if a newer focus already
          // reclaimed the flag before this check ran.
          if (!containerRef.current) return;
          if (focusVersion.current !== focusVersionAtBlur) return;
          if (blurred.isConnected) {
            hadFocusWithin.current = false;
          }
        });
      }}
      onFocus={(event) => {
        onFocus?.(event);
        hadFocusWithin.current = true;
        focusVersion.current += 1;
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!global) handleShortcut(event);
      }}
      ref={setRef}
      // Deliberately role="group", not "toolbar": the region owns media
      // shortcuts by default — see `shortcuts` for the map, which a consumer
      // can rebind or remove — rather than roving-tabindex toolbar navigation.
      // Native controls inside keep whatever keys the layer does not bind:
      // text entry keeps all of them, and a focused button or checkbox keeps
      // Space and Enter.
      role="group"
      style={style}
      tabIndex={tabIndex ?? 0}
    >
      {children}
    </div>
  );
};
