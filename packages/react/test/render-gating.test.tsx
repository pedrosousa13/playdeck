// @vitest-environment happy-dom

// #651: every part's `usePlayerState` selector is a promise that it re-renders
// for the `PlayerState` fields it names and none other. Nothing enforced that
// promise, so a selector could widen in silence and nobody watching render
// counts would know which field, or which part, was responsible. This test
// mounts every exported part, drives each `PlayerState` field through the
// controller one at a time, and fails by name when a part re-renders for a
// field outside what it declares.
//
// THE TABLE BELOW IS THE POINT. It is a hand-written statement of intent, not
// a thing derived from the selectors under test -- see the block comment
// above `PART_TABLE`. Deriving it from the selector (e.g. by proxying the
// state object and recording which keys a selector reads) would make the
// table widen in lockstep with a widened selector, and the assertion could
// then never fail. That is the exact shape `docs/agents/demonstrated-red.md`
// names: an assertion that reads the same whether or not the bug is there.

import {
  act,
  cleanup,
  fireEvent,
  render,
  type RenderResult
} from '@testing-library/react';
import {
  createElement,
  createRef,
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactElement,
  type ReactNode
} from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  PlayerState,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  ProviderStatePatch
} from '@playdeck/core';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';

// --- fixture plumbing, the same mock-adapter shape controls.test.tsx uses --

const ok = async (): Promise<CommandResult> => ({ ok: true });

const createMockAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  const spies = {
    play: vi.fn(ok),
    pause: vi.fn(ok),
    seekTo: vi.fn(ok),
    seekBy: vi.fn(ok),
    mute: vi.fn(ok),
    unmute: vi.fn(ok),
    setVolume: vi.fn(ok),
    requestFullscreen: vi.fn(ok),
    exitFullscreen: vi.fn(ok),
    requestPictureInPicture: vi.fn(ok),
    exitPictureInPicture: vi.fn(ok),
    showAirPlayPicker: vi.fn(ok),
    selectTextTrack: vi.fn(ok)
  };
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...spies
  };
  return {
    adapter,
    spies,
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      listeners.forEach((listener) => listener(patch, event))
  };
};

type Fixture = RenderResult & {
  readonly controller: InternalControllerAccess[typeof INTERNAL_CONTROLLER];
  readonly spies: ReturnType<typeof createMockAdapter>['spies'];
  readonly emit: (patch: ProviderStatePatch, event?: ProviderEvent) => void;
};

// Mounts `ui` inside a real `Player.Root` with no provider attached yet --
// used only by the `refusedCommand` case below, which needs a window where no
// provider exists at all (see that field's comment).
const renderUnattached = (ui: ReactNode): Fixture => {
  const handle = createRef<Player.PlayerHandle>();
  const utils = render(
    createElement(Player.Root, {
      children: ui,
      loading: 'interaction',
      ref: handle,
      source: '/tracer.mp4'
    })
  );
  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  return {
    ...utils,
    controller,
    spies: createMockAdapter().spies,
    emit: () => {
      throw new Error('renderUnattached has no provider to emit through.');
    }
  };
};

const renderWithPlayer = (
  ui: ReactNode,
  initial?: ProviderStatePatch
): Fixture => {
  const handle = createRef<Player.PlayerHandle>();
  const utils = render(
    createElement(Player.Root, {
      children: ui,
      loading: 'interaction',
      ref: handle,
      source: '/tracer.mp4'
    })
  );
  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  const mock = createMockAdapter();
  act(() => {
    controller.setProvider(mock.adapter);
    mock.emit({
      lifecycle: 'ready',
      activation: 'ready',
      provider: 'native',
      ...initial
    });
  });
  return {
    ...utils,
    controller,
    spies: mock.spies,
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      act(() => mock.emit(patch, event))
  };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- render counting -------------------------------------------------------

// One shared counter bag for the whole mounted tree. Reset between steps
// rather than recreated, because the parts stay mounted for the run.
type Counts = Record<string, number>;

const makeCounter = (
  counts: Counts,
  name: string
): ProfilerOnRenderCallback => {
  return () => {
    counts[name] = (counts[name] ?? 0) + 1;
  };
};

// Wraps one part in its own `Profiler`, so `onRender` fires exactly when that
// part's own subtree commits a render -- never merely because some ancestor
// (the fixture, `Player.Root`) re-rendered. `Root` memoizes the context value
// it hands down (`player-context.ts`'s `value` in `root.tsx`), so a re-render
// of `Root` that leaves that value unchanged does not itself re-invoke a
// child function component: React bails at the point where the same element
// reference reaches an unchanged subtree. That is what makes counting real:
// a part's own render only happens because ITS OWN subscription (a
// `usePlayerState` selector, or `usePosterState`'s context) decided it had to.
const probe = (
  counts: Counts,
  name: string,
  node: ReactElement
): ReactElement =>
  createElement(
    Profiler,
    { id: name, onRender: makeCounter(counts, name) },
    node
  );

const resetCounts = (counts: Counts): void => {
  for (const key of Object.keys(counts)) delete counts[key];
};

// Whether `controller.getState()` actually moved the field a drive was
// supposed to move -- the thing `assertOnlyDeclaredPartsMoved` alone cannot
// tell: a part that reads a field the drive never actually changed records
// the same zero re-renders as a part that never reads the field at all. A
// structural compare for the array/object-valued fields (`buffered`,
// `capabilities`, `live`, ...), `Object.is` for everything else.
const fieldsDiffer = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return false;
  if (
    typeof left === 'object' &&
    left !== null &&
    typeof right === 'object' &&
    right !== null
  ) {
    return JSON.stringify(left) !== JSON.stringify(right);
  }
  return true;
};

// Fails, naming the field, when a drive left `PlayerController`'s own
// snapshot unchanged. This is exactly how the `autoplay` case in
// `DRIVEN_FIELDS`'s comment was caught the first time: by noticing a part
// that demonstrably reads the field showed zero re-renders, which is a claim
// nobody should have to verify by eye every time this file changes.
const expectFieldMoved = (
  field: keyof PlayerState,
  before: unknown,
  after: unknown
): void => {
  if (!fieldsDiffer(before, after)) {
    throw new Error(
      `Driving PlayerState.${field} left controller.getState().${field} ` +
        `unchanged (still ${JSON.stringify(before)}). The drive was inert -- ` +
        'a raw emit() patch the controller ignores or derives (see the ' +
        'comment above DRIVEN_FIELDS) needs a real controller-API drive ' +
        'instead, the way refusedPlay/refusedCommand/autoplay get one. Every ' +
        'render count this field produced while inert proves nothing.'
    );
  }
};

// Demonstrated red (docs/agents/demonstrated-red.md): this check is itself
// an assertion, and one with no unfixed code to revert to -- there is no
// commit where it did not exist to run it against. The fallback there is a
// deliberate mutation the check is supposed to catch, named as such. Setting
// `DRIVEN_VALUE.playbackRate` to `1` -- equal to `BASELINE_PATCH.playbackRate`,
// so the drive could not possibly move the field -- and running the suite
// produced:
//
//   Error: Driving PlayerState.playbackRate left
//   controller.getState().playbackRate unchanged (still 1). The drive was
//   inert -- a raw emit() patch the controller ignores or derives (see the
//   comment above DRIVEN_FIELDS) needs a real controller-API drive instead,
//   the way refusedPlay/refusedCommand/autoplay get one. Every render count
//   this field produced while inert proves nothing.
//
//   Test Files  1 failed (1)
//        Tests  1 failed | 6 passed (7)
//
// Reverting `DRIVEN_VALUE.playbackRate` to `1.5` returned:
//
//   Test Files  1 passed (1)
//        Tests  7 passed (7)

// --- the declared table -----------------------------------------------------
//
// One entry per exported part (icons, types, hooks and `Root` excluded --
// see PART_NAMES below). `fields` is the hand-written, independent statement
// of every `PlayerState` field the part's own selector (or a hook it calls
// that itself calls `usePlayerState`/`usePosterState`) reads. `mount` builds
// the part, wrapped in whatever ancestor it needs to actually render its own
// body rather than bailing out before it -- `SettingsMenuContent`, `MenuItem`
// and `MenuRadioItem` all return `null` while their menu is closed, and
// `null` is still a render, but a *closed* menu never mounts them into the
// tree at all, so there is nothing for a `Profiler` to wrap.
type PartEntry = {
  readonly fields: ReadonlySet<keyof PlayerState>;
  readonly mount: (
    track: (name: string, node: ReactElement) => ReactElement
  ) => ReactElement;
};

const bare =
  (Component: (props: object) => ReactElement | null) =>
  (track: (name: string, node: ReactElement) => ReactElement) =>
    track(Component.name, createElement(Component));

const PART_TABLE: Record<string, PartEntry> = {
  PlayButton: {
    fields: new Set(['autoplay', 'playback', 'provider']),
    mount: bare(Player.PlayButton)
  },
  MuteButton: {
    fields: new Set(['muted', 'provider', 'capabilities']),
    mount: bare(Player.MuteButton)
  },
  VolumeSlider: {
    fields: new Set(['muted', 'provider', 'capabilities', 'volume']),
    mount: bare(Player.VolumeSlider)
  },
  // Reads its own six fields, plus `activation` and `buffering` transitively
  // through `useLoadingPresentation()` (`loading-error.tsx`), the same hook
  // `LoadingIndicator` calls directly -- `data-buffering` is this control's
  // own read of the same debounced stall signal. Eight fields, recorded here
  // rather than treated as a defect: this is the "legitimately reads many
  // fields" case the issue's third criterion asks for.
  SeekSlider: {
    fields: new Set([
      'buffered',
      'currentTime',
      'duration',
      'provider',
      'seekable',
      'capabilities',
      'activation',
      'buffering'
    ]),
    mount: bare(Player.SeekSlider)
  },
  Time: {
    fields: new Set(['currentTime', 'duration', 'provider']),
    mount: bare(Player.Time)
  },
  FullscreenButton: {
    fields: new Set(['fullscreen', 'provider', 'capabilities']),
    mount: bare(Player.FullscreenButton)
  },
  PipButton: {
    fields: new Set(['pictureInPicture', 'provider', 'capabilities']),
    mount: bare(Player.PipButton)
  },
  AirPlayButton: {
    fields: new Set(['provider', 'capabilities']),
    mount: bare(Player.AirPlayButton)
  },
  ActivationButton: {
    fields: new Set(['activation', 'error']),
    mount: bare(Player.ActivationButton)
  },
  // `useLoadingPresentation()` directly -- see `SeekSlider` above.
  LoadingIndicator: {
    fields: new Set(['activation', 'buffering']),
    mount: bare(Player.LoadingIndicator)
  },
  ErrorDisplay: {
    fields: new Set(['error', 'lifecycle', 'provider']),
    mount: bare(Player.ErrorDisplay)
  },
  // Cues come through `useActiveCues()`'s own `subscribeCues` channel, which
  // is not a `PlayerState` field and which this fixture's mock adapter never
  // drives (it declares no `subscribeCues`) -- `captionRendering` is the only
  // `PlayerState` field this part reads.
  Captions: {
    fields: new Set(['captionRendering']),
    mount: bare(Player.Captions)
  },
  CaptionsButton: {
    fields: new Set([
      'provider',
      'selectedTextTrackId',
      'capabilities',
      'textTracks'
    ]),
    mount: bare(Player.CaptionsButton)
  },
  CaptionsMenu: {
    fields: new Set(['selectedTextTrackId', 'capabilities', 'textTracks']),
    mount: bare(Player.CaptionsMenu)
  },
  // `quality` is read for the auto row's own label ("Auto (1080p)"), not for
  // the selection check -- that is `selectedQualityId`. See the comment above
  // `PlayerState.qualities` in types.ts.
  QualityMenu: {
    fields: new Set([
      'selectedQualityId',
      'quality',
      'qualities',
      'capabilities'
    ]),
    mount: bare(Player.QualityMenu)
  },
  // `playbackRate` marks the active rung; `capabilities` gates on
  // `setPlaybackRate.status`.
  PlaybackRateMenu: {
    fields: new Set(['playbackRate', 'capabilities']),
    mount: bare(Player.PlaybackRateMenu)
  },
  // `chapters` lists the rungs; `currentTime` (via the derived current
  // chapter, never read raw) marks the active one; `capabilities` gates on
  // `chapters.status`.
  ChaptersMenu: {
    fields: new Set(['chapters', 'currentTime', 'capabilities']),
    mount: bare(Player.ChaptersMenu)
  },
  // `audioTracks` lists the rungs and carries each one's own `active`, so
  // there is no sibling selection field to add (see the comment above
  // `activeId` in audio-tracks.tsx); `capabilities` gates on
  // `selectAudioTrack.status`. Declaring the field here only guards against a
  // later selector widening onto something else -- that `AudioTrackMenu`
  // actually reads `audioTracks` today is proven by
  // `test/audio-tracks.test.tsx`, not by this table entry.
  AudioTrackMenu: {
    fields: new Set(['audioTracks', 'capabilities']),
    mount: bare(Player.AudioTrackMenu)
  },
  // Reads seven fields through one selector -- the shortcut layer has to know
  // every capability gate a bound key might act through, plus the values a
  // couple of those actions need (`muted`, `volume`, `selectedTextTrackId`,
  // `textTracks`) to decide what to do. Recorded, per the issue's third
  // criterion, rather than narrowed: none of the seven is read for its own
  // sake, each backs one shortcut action.
  Controls: {
    fields: new Set([
      'fullscreen',
      'muted',
      'provider',
      'selectedTextTrackId',
      'textTracks',
      'volume',
      'capabilities'
    ]),
    mount: bare(Player.Controls)
  },
  // No `usePlayerState` call at all -- only `usePlayer()` for the controller.
  Gestures: {
    fields: new Set(),
    mount: bare(Player.Gestures)
  },
  // The whole `SettingsMenu` family is local `useState` (open/closed, roving
  // focus) and reads no `PlayerState` field whatsoever. `SettingsMenuContent`,
  // `MenuItem` and `MenuRadioItem` all sit behind "menu is open", so the mount
  // recipe below opens it before the counted parts ever mount.
  SettingsMenu: {
    fields: new Set(),
    mount: bare(Player.SettingsMenu)
  },
  SettingsMenuTrigger: {
    fields: new Set(),
    mount: (track) =>
      track(
        'SettingsMenuTrigger',
        createElement(
          Player.SettingsMenu,
          null,
          createElement(Player.SettingsMenuTrigger)
        )
      )
  },
  // Mount recipe: a real `SettingsMenu` with its trigger clicked open in
  // `setupSettingsMenuFamily` below, so `SettingsMenuContent`, `MenuItem` and
  // `MenuRadioItem` actually mount rather than being the `null` a closed menu
  // renders for each of them.
  SettingsMenuContent: {
    fields: new Set(),
    mount: () => {
      throw new Error('mounted by setupSettingsMenuFamily');
    }
  },
  MenuItem: {
    fields: new Set(),
    mount: () => {
      throw new Error('mounted by setupSettingsMenuFamily');
    }
  },
  MenuRadioGroup: {
    fields: new Set(),
    mount: () => {
      throw new Error('mounted by setupSettingsMenuFamily');
    }
  },
  MenuRadioItem: {
    fields: new Set(),
    mount: () => {
      throw new Error('mounted by setupSettingsMenuFamily');
    }
  },
  // Reads no `PlayerState` field directly -- `usePosterState()` is
  // `PosterContext`, computed inside `Root` from `state.playback` and
  // `state.providerPosterUrl` only (`root.tsx`'s `posterState`/
  // `providerPosterUrl` subscription, written unconditionally on every tick
  // but only committing a state change, and so only re-rendering `Poster`,
  // when one of those two values actually differs).
  Poster: {
    fields: new Set(['playback', 'providerPosterUrl']),
    mount: bare(Player.Poster)
  },
  // No `usePlayerState`, no `usePosterState` -- only `useContext(PlayerContext)`
  // for the controller, to report a refused URL.
  PosterImage: {
    fields: new Set(),
    mount: bare(Player.PosterImage)
  },
  Viewport: {
    fields: new Set(),
    mount: bare(Player.Viewport)
  },
  Media: {
    fields: new Set(),
    mount: bare(Player.Media)
  }
};

// Parts excluded from the automatic enumeration below, and why -- anything
// exported that is NOT here and NOT in this list is a part with no table
// entry, and `describe.each` over the enumeration fails it by name (see
// "every exported part has a table entry" below).
//
// `Root` is the fixture itself, not a part mounted inside one: nothing else
// in this package can be mounted without a `Player.Root` around it, `Root`
// cannot be mounted a second time inside its own tree, and it is not gated by
// a `usePlayerState` selector at all -- it drives its own re-renders off
// `controller.subscribe` directly, which is the mechanism this test exists to
// check parts against, not a part exhibiting it.
const EXCLUDED_EXPORTS = new Set(['Root']);

// --- automatic enumeration of exported parts --------------------------------

const isIcon = (name: string): boolean => name.endsWith('Icon');
const isComponentName = (name: string): boolean => /^[A-Z]/.test(name);

const exportedPartNames = (): readonly string[] =>
  Object.keys(Player)
    .filter((name) => isComponentName(name) && !isIcon(name))
    .filter((name) => !EXCLUDED_EXPORTS.has(name))
    .sort();

// --- PlayerState fields, and a canonical two-value pair for each -----------
//
// `refusedPlay`, `refusedCommand`, `autoplay`, `seekOrigin` and
// `autoplayRecovered` are excluded from this list on purpose: none of the
// five is settable through a raw provider patch, in a way this file's own
// `expectFieldMoved` check catches (it caught two of them: `autoplay` in the
// first version of this table, `seekOrigin` in the second, once a real
// `controller.getState()` comparison existed to notice).
//
// `refusedPlay`/`refusedCommand` are overwritten on every single patch from
// the controller's own internal record (`this.#refusedPlay ?? null` /
// `this.#refusedCommand ?? null`); `autoplayRecovered` is computed from
// `#autoplayRecoveryPending` and the autoplay transition, never from
// `patch.autoplayRecovered`. `autoplay` and `seekOrigin` are the two that are
// easy to miss, because most of `#applyPatch`'s field handling passes a
// patch value straight through:
//
// - A provider's own patch reaches `#applyPatch` with `acceptAutoplay: false`
//   (`player-controller.ts`'s provider-subscribe handler, the one call site,
//   passes `false` as the second argument), and with that flag false
//   `nextAutoplay` falls to `this.#state.autoplay`, ignoring `patch.autoplay`
//   entirely. `emit({ autoplay: 'attempting' })` therefore does nothing --
//   caught only by actually running it: the first version of this table
//   drove `autoplay` the same way as every other field, and the run showed
//   zero re-renders for a field `PlayButton` demonstrably reads.
// - The SAME provider-subscribe handler overwrites `patch.seekOrigin` with
//   `confirmedSeekOrigin` before the patch ever reaches `#applyPatch`:
//   `{ ...patch, seekOrigin: confirmedSeekOrigin, error: ... }`.
//   `confirmedSeekOrigin` comes from `#consumePendingOrigin('seek', ...)`,
//   which returns a value only when a real seek command
//   (`seekToWithOrigin`/`seekByWithOrigin`) left a pending record AND the
//   patch arrives alongside a `'seeking'`/`'seeked'` event (`isSeekEvent`).
//   `mock.emit(patch)` in this file never passes an event, so
//   `confirmedSeekOrigin` is always `undefined`, `patch.seekOrigin` is always
//   overwritten to `undefined`, and `emit({ seekOrigin: 'user' })` is a
//   silent no-op regardless of what `#applyPatch`'s own seekOrigin formula
//   would otherwise do with it. Caught by `expectFieldMoved`, not by eye this
//   time -- which is the entire reason that check exists.
//
// `refusedPlay`, `refusedCommand`, `autoplay` and `seekOrigin` are each still
// driven, through the controller rather than through a raw patch, by a
// dedicated test below the main field loop. `autoplayRecovered` is not:
// producing it for real means configuring `'audible-then-muted'` autoplay, an
// audible attempt the provider refuses as `'blocked'`, and a muted retry that
// then succeeds -- a real, but multi-step, provider-command sequence, not the
// one extra call the other four needed. No exported part reads this field
// (confirmed by reading every part's selector, `PART_TABLE` above), so
// nothing is left unguarded by leaving it undriven: every part's declared set
// is checked against it vacuously, the same way every part's declared set is
// checked against a field it never touches at all.
const DRIVEN_FIELDS = [
  'lifecycle',
  'activation',
  'playback',
  'buffering',
  'seeking',
  'currentTime',
  'duration',
  'buffered',
  'seekable',
  'live',
  'muted',
  'volume',
  'playbackRate',
  'fullscreen',
  'pictureInPicture',
  'provider',
  'hlsEngine',
  'quality',
  'qualities',
  'selectedQualityId',
  'capabilities',
  'error',
  'textTracks',
  'audioTracks',
  'chapters',
  'selectedTextTrackId',
  'captionRendering',
  'providerPosterUrl',
  'commandsReady'
] as const satisfies readonly (keyof PlayerState)[];

// `refusedPlay`, `refusedCommand`, `autoplay`, `seekOrigin` and
// `autoplayRecovered` are excluded from `DRIVEN_FIELDS` above but are NOT
// left undriven: each gets its own test below that drives it through the
// real controller API that actually sets it (a refused `play()`,
// `configureAutoplay()`, a pre-attach command, a real seek command paired
// with a seek event, or a full 'audible-then-muted' recovery sequence), and
// checks the same `expectFieldMoved`/`assertOnlyDeclaredPartsMoved` pair
// against it. Named here so the exhaustiveness check below can account for
// them without re-deriving the list from the tests themselves.
const DEDICATED_DRIVE_FIELDS = [
  'refusedPlay',
  'refusedCommand',
  'autoplay',
  'seekOrigin',
  'autoplayRecovered'
] as const satisfies readonly (keyof PlayerState)[];

// Empty, currently: every `PlayerState` field turned out driveable, either
// directly (`DRIVEN_FIELDS`) or through a dedicated real-controller test
// (`DEDICATED_DRIVE_FIELDS`) -- `autoplayRecovered` looked like the one
// exception (it needs a full 'audible-then-muted' recovery: an audible
// attempt the provider refuses as `'blocked'`, a muted retry that
// succeeds, then the provider reporting playback actually started), but
// the mock adapter can produce that sequence for real by controlling what
// `play()` and `mute()` resolve with, so it moved to
// `DEDICATED_DRIVE_FIELDS` instead of staying here on the assumption that
// it couldn't be done.
//
// Kept, rather than deleted along with its no-longer-needed entry: the
// exhaustiveness check below still reads it, so a future field that
// genuinely cannot be driven -- name it here, with the reason, and the
// check accounts for it without this file silently saying nothing about a
// field a part might come to depend on.
const EXCLUDED_FIELDS: Partial<Record<keyof PlayerState, string>> = {};

// The complete `PlayerState` field list, restated here as a `Record` rather
// than a plain array so TypeScript itself enforces completeness: a literal
// assigned to `Record<keyof PlayerState, true>` errors on a missing key AND
// on an extra one, so this cannot silently drift from the real type the way
// a hand-maintained array could. `Object.keys(...)` below is what turns it
// into the runtime list the exhaustiveness test compares against.
const ALL_PLAYER_STATE_FIELDS: Record<keyof PlayerState, true> = {
  lifecycle: true,
  activation: true,
  playback: true,
  buffering: true,
  seeking: true,
  seekOrigin: true,
  currentTime: true,
  duration: true,
  buffered: true,
  seekable: true,
  live: true,
  muted: true,
  volume: true,
  playbackRate: true,
  fullscreen: true,
  pictureInPicture: true,
  autoplay: true,
  autoplayRecovered: true,
  refusedPlay: true,
  refusedCommand: true,
  provider: true,
  hlsEngine: true,
  quality: true,
  qualities: true,
  selectedQualityId: true,
  capabilities: true,
  error: true,
  textTracks: true,
  audioTracks: true,
  chapters: true,
  selectedTextTrackId: true,
  captionRendering: true,
  providerPosterUrl: true,
  commandsReady: true
};

const available: Availability = { status: 'available' };
const unavailable: Availability = {
  status: 'unavailable',
  reason: 'provider'
};

const baselineCapabilities: PlayerCapabilities = {
  seek: available,
  setVolume: available,
  setPlaybackRate: available,
  selectQuality: available,
  selectQualityAuto: available,
  selectTextTrack: available,
  selectAudioTrack: available,
  chapters: available,
  fullscreen: available,
  pictureInPicture: available,
  airPlay: available,
  customControls: available,
  providerPoster: available
};

const drivenCapabilities: PlayerCapabilities = {
  seek: unavailable,
  setVolume: unavailable,
  setPlaybackRate: unavailable,
  selectQuality: unavailable,
  selectQualityAuto: unavailable,
  selectTextTrack: unavailable,
  selectAudioTrack: unavailable,
  chapters: unavailable,
  fullscreen: unavailable,
  pictureInPicture: unavailable,
  airPlay: unavailable,
  customControls: unavailable,
  providerPoster: unavailable
};

const baselineTextTrack = Object.freeze({
  id: 'en',
  label: 'English',
  language: 'en',
  kind: 'subtitles' as const,
  readiness: 'loaded' as const
});

const drivenTextTrack = Object.freeze({
  id: 'fr',
  label: 'French',
  language: 'fr',
  kind: 'subtitles' as const,
  readiness: 'loaded' as const
});

const baselineAudioTrack = Object.freeze({
  id: 'en',
  label: 'English',
  language: 'en',
  active: true
});

const drivenAudioTrack = Object.freeze({
  id: 'fr',
  label: 'French',
  language: 'fr',
  active: true
});

// Two chapters, both present at baseline, spanning both the baseline and
// driven `currentTime` (10 and 42 respectively -- see `DRIVEN_VALUE` below):
// `ChaptersMenu` derives the current chapter from `currentTime`, and driving
// `currentTime` alone (baseline's own two-chapter list is otherwise
// untouched by that drive) has to move the derived chapter across the 0/20
// boundary below for that declaration to prove anything.
const baselineChapter = Object.freeze({
  id: 'c1',
  title: 'Intro',
  startTime: 0,
  endTime: 20
});

const drivenChapter = Object.freeze({
  id: 'c2',
  title: 'Part two',
  startTime: 20,
  endTime: null
});

const baselineQuality = Object.freeze({
  id: '1080p',
  height: 1080,
  width: 1920,
  bitrate: 5_000_000
});

const drivenQuality = Object.freeze({
  id: '720p',
  height: 720,
  width: 1280,
  bitrate: 2_500_000
});

// The full state every field driver starts from -- every field named
// explicitly, so a driver that patches only its own field can never inherit a
// stray value some earlier driver left behind. `seeking: true` is part of the
// baseline for the `seeking` driver's own sake.
//
// `autoplay` and `seekOrigin` are deliberately NOT here, even though both are
// `PlayerState` fields: both are silently overwritten by the
// provider-subscribe wrapper before `#applyPatch` ever sees them (see the
// comment above `DRIVEN_FIELDS`), so a literal here would assert nothing
// about what actually lands in `PlayerState` -- it would just be the value
// `#applyPatch`'s own fallback happens to produce regardless of what is
// written here, which is the exact confusion this file exists to avoid
// reintroducing. Both are reset to a known value inside their own dedicated
// tests instead, the same place they are driven.
const BASELINE_PATCH: ProviderStatePatch = {
  lifecycle: 'ready',
  activation: 'ready',
  playback: 'paused',
  buffering: false,
  seeking: true,
  currentTime: 10,
  duration: 100,
  buffered: [{ start: 0, end: 20 }],
  seekable: [{ start: 0, end: 100 }],
  live: null,
  muted: false,
  volume: 0.5,
  playbackRate: 1,
  fullscreen: false,
  pictureInPicture: false,
  provider: 'native',
  hlsEngine: null,
  quality: baselineQuality,
  qualities: [baselineQuality],
  selectedQualityId: null,
  capabilities: baselineCapabilities,
  error: null,
  textTracks: [baselineTextTrack],
  audioTracks: [baselineAudioTrack],
  // Both chapters present at baseline -- see the comment above
  // `baselineChapter`/`drivenChapter` for why a currentTime-only drive
  // needs both already in the list.
  chapters: [baselineChapter, drivenChapter],
  selectedTextTrackId: null,
  captionRendering: 'custom',
  providerPosterUrl: null,
  commandsReady: true
};

// The one differing value per field, applied as a small patch on top of an
// already-settled `BASELINE_PATCH` -- every field this patch does not name
// stays exactly the reference it already held (`#applyPatch` falls back to
// `this.#state.<field>` for every key a patch omits), so this is the whole of
// what changes.
const DRIVEN_VALUE: {
  [K in (typeof DRIVEN_FIELDS)[number]]: ProviderStatePatch[K];
} = {
  lifecycle: 'error',
  activation: 'error',
  playback: 'playing',
  buffering: true,
  seeking: false,
  currentTime: 42,
  duration: 200,
  buffered: [{ start: 0, end: 50 }],
  seekable: [{ start: 0, end: 200 }],
  live: { isLive: true, atLiveEdge: true },
  muted: true,
  volume: 0.9,
  playbackRate: 1.5,
  fullscreen: true,
  pictureInPicture: true,
  provider: 'hls',
  hlsEngine: 'hls.js',
  quality: drivenQuality,
  qualities: [drivenQuality],
  selectedQualityId: '720p',
  capabilities: drivenCapabilities,
  error: {
    category: 'source',
    fatal: true,
    recoverable: true,
    message: 'boom'
  },
  textTracks: [drivenTextTrack],
  audioTracks: [drivenAudioTrack],
  chapters: [drivenChapter],
  selectedTextTrackId: 'en',
  captionRendering: 'native',
  providerPosterUrl: 'https://example.test/poster.jpg',
  commandsReady: false
};

// --- the mounted tree --------------------------------------------------------

const setupAllParts = (): {
  readonly fixture: Fixture;
  readonly counts: Counts;
} => {
  const counts: Counts = {};
  const track = (name: string, node: ReactElement): ReactElement =>
    probe(counts, name, node);

  const standalone = exportedPartNames().filter(
    (name) =>
      name !== 'SettingsMenuContent' &&
      name !== 'MenuItem' &&
      name !== 'MenuRadioGroup' &&
      name !== 'MenuRadioItem'
  );

  const tree = createElement(
    'div',
    null,
    ...standalone.map((name) => {
      const entry = PART_TABLE[name];
      if (!entry) {
        throw new Error(
          `render-gating.test.tsx has no PART_TABLE entry for exported part "${name}". ` +
            'Add one: the field set it is allowed to re-render for, and a mount ' +
            'recipe if it cannot be mounted bare.'
        );
      }
      return createElement('div', { key: name }, entry.mount(track));
    }),
    // The settings-menu family that needs its menu open to mount at all --
    // see `SettingsMenuContent`/`MenuItem`/`MenuRadioGroup`/`MenuRadioItem`'s
    // table comments.
    createElement(
      Player.SettingsMenu,
      { key: 'settings-menu-family' },
      createElement(Player.SettingsMenuTrigger, { key: 'trigger' }),
      track(
        'SettingsMenuContent',
        createElement(
          Player.SettingsMenuContent,
          { key: 'content' },
          track('MenuItem', createElement(Player.MenuItem, null, 'Item')),
          track(
            'MenuRadioGroup',
            createElement(
              Player.MenuRadioGroup,
              { value: 'a', onValueChange: () => {} },
              track(
                'MenuRadioItem',
                createElement(Player.MenuRadioItem, { value: 'a' }, 'A')
              )
            )
          )
        )
      )
    )
  );

  const fixture = renderWithPlayer(tree, BASELINE_PATCH);

  // Open the settings menu so `SettingsMenuContent`, `MenuItem`,
  // `MenuRadioGroup` and `MenuRadioItem` actually mount -- closed,
  // `SettingsMenuContent` returns `null` and none of its children are in the
  // tree at all.
  const trigger = fixture.container.querySelector(
    '[data-playdeck-part="settings-menu-trigger"]'
  );
  if (!(trigger instanceof HTMLElement)) {
    throw new Error('Settings menu trigger did not render.');
  }
  act(() => {
    fireEvent.click(trigger);
  });

  return { fixture, counts };
};

// Asserts that every part NOT declaring `field` (or one of `alsoMoved`) in
// its table entry did not re-render between the two count snapshots. A
// declaring part is not required to have re-rendered (its own selected
// sub-value may not have moved for this particular driven value), only
// permitted to.
//
// `alsoMoved` exists for drives that cannot move `field` alone: producing
// `autoplayRecovered` for real requires the same patch to move `autoplay`
// to `'started'` too (`#applyPatch`'s own formula fills `autoplayRecovered`
// from `#autoplayRecoveryPending` at exactly that transition, and at no
// other point) -- so a part like `PlayButton`, which declares `autoplay`
// but not `autoplayRecovered`, legitimately re-renders on that drive for a
// field it DOES declare, and `alsoMoved` is what tells this function that
// re-render is accounted for rather than a second, unrelated offender.
const assertOnlyDeclaredPartsMoved = (
  field: keyof PlayerState,
  before: Counts,
  after: Counts,
  alsoMoved: readonly (keyof PlayerState)[] = []
): void => {
  const offenders: string[] = [];
  for (const name of Object.keys(PART_TABLE)) {
    const entry = PART_TABLE[name]!;
    if (entry.fields.has(field)) continue;
    if (alsoMoved.some((other) => entry.fields.has(other))) continue;
    const delta = (after[name] ?? 0) - (before[name] ?? 0);
    if (delta > 0) {
      offenders.push(`${name} (+${delta} render${delta === 1 ? '' : 's'})`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Changing PlayerState.${field} re-rendered ${offenders.length} part(s) ` +
        `that do not declare it in PART_TABLE: ${offenders.join(', ')}.`
    );
  }
};

// Demonstrated red (docs/agents/demonstrated-red.md), from two selectors
// widened on two different parts, one by a second party running this
// exact test file against their own mutation:
//
// Widening `FullscreenButton`'s selector in
// `packages/react/src/display-controls.tsx` to also select
// `duration: state.duration` produced:
//
//   Error: Changing PlayerState.duration re-rendered 1 part(s) that do not
//   declare it in PART_TABLE: FullscreenButton (+1 render).
//
//   Test Files  1 failed (1)
//        Tests  1 failed | 6 passed (7)
//
// Reverting that selector returned:
//
//   Test Files  1 passed (1)
//        Tests  7 passed (7)
//
// Separately, widening `MuteButton`'s selector in the same file to also
// select `currentTime: state.currentTime` -- read into a real
// `data-current-time` attribute, so it is a genuine extra read and not dead
// code an unused-variable lint would have caught for an unrelated reason --
// produced:
//
//   Error: Changing PlayerState.currentTime re-rendered 1 part(s) that do
//   not declare it in PART_TABLE: MuteButton (+1 render).
//
//   Test Files  1 failed (1)
//        Tests  1 failed | 6 passed (7)
//
// Reverting that selector returned the suite to the same green:
//
//   Test Files  1 passed (1)
//        Tests  7 passed (7)

describe('render gating (#651)', () => {
  test('every exported part has a PART_TABLE entry', () => {
    const missing = exportedPartNames().filter((name) => !PART_TABLE[name]);
    expect(missing).toEqual([]);
  });

  // Every `PlayerState` field is accounted for exactly once: driven directly
  // in the loop below, driven through a dedicated real-controller test, or
  // named in `EXCLUDED_FIELDS` with a reason. A field in none of the three
  // is a field this suite silently says nothing about; a field in more than
  // one would mean the categories drifted apart from each other. Either way
  // this is where that shows up, rather than as a gap nobody notices.
  test('every PlayerState field is driven, dedicated-driven, or named as excluded -- exactly once', () => {
    const categorized = [
      ...DRIVEN_FIELDS,
      ...DEDICATED_DRIVE_FIELDS,
      ...(Object.keys(EXCLUDED_FIELDS) as (keyof PlayerState)[])
    ];
    const duplicates = categorized.filter(
      (field, index) => categorized.indexOf(field) !== index
    );
    expect(duplicates).toEqual([]);
    expect([...categorized].sort()).toEqual(
      Object.keys(ALL_PLAYER_STATE_FIELDS).sort()
    );
  });

  // The issue's last criterion asks for the first run's per-part render
  // counts, recorded. Printed rather than hand-copied, so the table quoted
  // in the PR body is reproducible:
  //
  //   PLAYDECK_RENDER_COUNTS=1 npx vitest run \
  //     packages/react/test/render-gating.test.tsx \
  //     -t "mounts every part" --disable-console-intercept
  //
  // `--disable-console-intercept` is not optional and is why the flag is
  // spelled out here rather than left to the reader: this repo's vitest run
  // swallows `console.log` entirely by default -- a bare test logging a
  // marker prints nothing at all -- so the command without it produces an
  // empty transcript and looks like the table was never generated.
  test('mounts every part and drives every PlayerState field without an undeclared re-render', () => {
    const { fixture, counts } = setupAllParts();

    const firstRunCounts: Record<string, Counts> = {};

    for (const field of DRIVEN_FIELDS) {
      // Re-settle every field to its baseline value, so a change left behind
      // by the previous field's driven value can never leak into this one.
      fixture.emit(BASELINE_PATCH);
      resetCounts(counts);
      const before = fixture.controller.getState()[field];

      fixture.emit({ [field]: DRIVEN_VALUE[field] } as ProviderStatePatch);

      // The gap a real bug hid in: a field the controller ignores or derives
      // (`autoplay` did, silently) produces the same zero re-renders as a
      // field genuinely read by nothing. This is what tells the two apart.
      expectFieldMoved(field, before, fixture.controller.getState()[field]);

      firstRunCounts[field] = { ...counts };
      assertOnlyDeclaredPartsMoved(field, {}, counts);
    }

    if (process.env.PLAYDECK_RENDER_COUNTS) {
      console.log(JSON.stringify(firstRunCounts, null, 2));
    }
  });

  // `refusedPlay` is controller-derived (see `#applyPatch`'s
  // `refusedPlay: this.#refusedPlay ?? null`) and is set only by a play
  // command a provider actually turns down, never by a raw provider patch.
  // Driven here through a real refused `play()` against the shared fixture's
  // already-attached provider, which -- unlike detaching the provider (the
  // only way to drive `refusedCommand`, see below) -- changes nothing else in
  // `PlayerState`: the follow-up publish is `#applyPatch({})`, an empty
  // patch, so every other field falls back to `this.#state.<field>` and keeps
  // its exact prior reference.
  test('driving refusedPlay through a real refused play() re-renders no part outside its declared set', async () => {
    const { fixture, counts } = setupAllParts();
    fixture.emit(BASELINE_PATCH);
    resetCounts(counts);
    const before = fixture.controller.getState().refusedPlay;

    fixture.spies.play.mockResolvedValueOnce({
      ok: false,
      reason: 'provider-error'
    });
    await act(async () => {
      await fixture.controller.play();
    });

    expectFieldMoved(
      'refusedPlay',
      before,
      fixture.controller.getState().refusedPlay
    );
    assertOnlyDeclaredPartsMoved('refusedPlay', {}, counts);
  });

  // `autoplay` is controller-derived for the same shape of reason:
  // `#applyPatch` ignores `patch.autoplay` whenever it is called with
  // `acceptAutoplay: false`, which is every call a provider's own patch
  // reaches (see the comment above `DRIVEN_FIELDS`). Driven here through a
  // real `configureAutoplay('audible', {})` against the shared fixture's
  // already-attached, already-ready provider -- the one path that calls
  // `#applyPatch({ autoplay: 'attempting' })` directly, with the default
  // `acceptAutoplay: true`. `play()` is left hanging (never resolves) so the
  // attempt never proceeds past `'attempting'` into a `playback` patch of its
  // own, which would no longer be an isolated change to this one field.
  test('driving autoplay through configureAutoplay re-renders no part outside its declared set', async () => {
    const { fixture, counts } = setupAllParts();
    fixture.emit(BASELINE_PATCH);
    // `setProvider`'s `attach()` -> `load()` -> `#loadedGeneration = generation`
    // chain runs over microtasks (`player-controller.ts`'s `void
    // Promise.resolve(attachResult).then(...)`), and `#synchronizeAutoplay`
    // declines to attempt until `#loadedGeneration` matches. Flushed here so
    // `configureAutoplay` below actually reaches the attempt instead of
    // silently declining it.
    await act(async () => {});
    resetCounts(counts);
    const before = fixture.controller.getState().autoplay;

    fixture.spies.play.mockImplementationOnce(
      () => new Promise<CommandResult>(() => {})
    );
    act(() => {
      fixture.controller.configureAutoplay('audible', {});
    });

    expectFieldMoved(
      'autoplay',
      before,
      fixture.controller.getState().autoplay
    );
    assertOnlyDeclaredPartsMoved('autoplay', {}, counts);
  });

  // `autoplayRecovered` is controller-derived like `autoplay`, but it is not
  // in `EXCLUDED_FIELDS`: the full 'audible-then-muted' recovery sequence
  // this needs (an audible attempt the provider refuses as `'blocked'`, a
  // muted retry that succeeds, and the provider then reporting the muted
  // playback actually started) is entirely reachable with the mock adapter
  // -- controlling what `play()` and `mute()` resolve with is all it takes.
  //
  // `#playWithOrigin` publishes nothing on a successful retry (see the
  // comment at its own return) -- a real provider adapter reports the muted
  // playback started with its own `playback: 'playing'` patch, the same way
  // it always reports `playing`, and that is the one patch
  // `#applyPatch` actually reads for the `'started'` transition
  // (`patch.playback === 'playing' && state.autoplay === 'attempting'`,
  // true regardless of `acceptAutoplay`) and for filling
  // `autoplayRecovered` from `#autoplayRecoveryPending`. So this drive ends
  // the same way a real provider's recovery would: by reporting play.
  //
  // Two fields move in that one final patch, not one: `autoplay` goes from
  // `'attempting'` to `'started'` in the very same `#applyPatch` call that
  // fills `autoplayRecovered`, because the formula for the second reads the
  // just-computed value of the first (see the comment above
  // `assertOnlyDeclaredPartsMoved`). `PlayButton` declares `autoplay` and
  // legitimately re-renders on it; `assertOnlyDeclaredPartsMoved` is told
  // about that expected second mover through `alsoMoved` rather than
  // reading it as an undeclared one.
  //
  // `playback` itself is moved to `'playing'` once, before the count reset,
  // so the confirming patch at the end -- which has to repeat
  // `playback: 'playing'` to satisfy `#applyPatch`'s own condition for the
  // `'started'` transition -- does not ALSO read as a `playback` change to
  // every part that declares that: `playback` itself stays the same value
  // across the reset, only `autoplay` and `autoplayRecovered` actually move.
  test('driving autoplayRecovered through a real audible-then-muted recovery re-renders no part outside its declared set', async () => {
    const { fixture, counts } = setupAllParts();
    fixture.emit(BASELINE_PATCH);
    // Flushes `setProvider`'s attach -> load microtask chain, the same wait
    // the `autoplay` test above needs before `configureAutoplay` can reach
    // an actual attempt.
    await act(async () => {});
    fixture.emit({ playback: 'playing' });
    resetCounts(counts);
    const before = fixture.controller.getState().autoplayRecovered;

    fixture.spies.play
      .mockResolvedValueOnce({ ok: false, reason: 'blocked' })
      .mockResolvedValueOnce({ ok: true });
    fixture.spies.mute.mockResolvedValueOnce({ ok: true });

    act(() => {
      fixture.controller.configureAutoplay('audible-then-muted', {});
    });
    // Drains the chain of awaits inside the controller: the refused audible
    // play, the mute, and the muted retry.
    for (let drain = 0; drain < 5; drain += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    fixture.emit({ playback: 'playing' });

    expectFieldMoved(
      'autoplayRecovered',
      before,
      fixture.controller.getState().autoplayRecovered
    );
    assertOnlyDeclaredPartsMoved('autoplayRecovered', {}, counts, ['autoplay']);
  });

  // `seekOrigin` is controller-derived for the same reason `autoplay` is,
  // by a different route: the provider-subscribe handler overwrites
  // `patch.seekOrigin` with `confirmedSeekOrigin` before `#applyPatch` ever
  // sees it, and `confirmedSeekOrigin` comes from `#consumePendingOrigin`,
  // which needs both a pending record from a real seek command
  // (`seekToWithOrigin`) AND a `'seeking'`/`'seeked'` event alongside the
  // patch -- `mock.emit(patch)` with no event, which is every other emit in
  // this file, always produces `undefined` for it (see the comment above
  // `DRIVEN_FIELDS`). Driven here by actually issuing the command and then
  // reporting a `'seeking'` event alongside the patch, the way a real
  // provider adapter would after that command reached it.
  test('driving seekOrigin through a real user seek re-renders no part outside its declared set', async () => {
    const { fixture, counts } = setupAllParts();
    fixture.emit(BASELINE_PATCH);
    resetCounts(counts);
    const before = fixture.controller.getState().seekOrigin;

    act(() => {
      void fixture.controller.seekToWithOrigin(10, 'user');
    });
    // An otherwise-empty patch, deliberately: only the event's type and the
    // pending record the command above left behind decide `seekOrigin`
    // (see the comment above this test), so anything else in the patch
    // would only risk moving a field this test is not about.
    fixture.emit(
      {},
      { type: 'seeking', detail: { currentTime: 10 }, origin: 'provider' }
    );

    expectFieldMoved(
      'seekOrigin',
      before,
      fixture.controller.getState().seekOrigin
    );
    assertOnlyDeclaredPartsMoved('seekOrigin', {}, counts);

    // Lets the outstanding seekTo() command settle so it cannot resolve
    // during, and leak a render into, a later test.
    await act(async () => {});
  });

  // `refusedCommand` is likewise controller-derived, and the only way to
  // produce it is a command issued while no provider is attached at all
  // (`#refuseCommand`'s every call site guards on `!provider`) -- detaching
  // the shared fixture's live provider would rebuild the whole of
  // `PlayerState` from `createInitialPlayerState()` (`setProvider`'s own
  // branch for `provider: undefined`), which cannot be isolated to one
  // field. So this mounts a second, separate tree with no provider attached
  // at all, and checks the same rule against it: no part outside the
  // (empty, for every part) declared set for `refusedCommand` re-renders.
  test('driving refusedCommand pre-attach re-renders no part outside its declared set', () => {
    const counts: Counts = {};
    const track = (name: string, node: ReactElement): ReactElement =>
      probe(counts, name, node);

    const standalone = exportedPartNames().filter(
      (name) =>
        name !== 'SettingsMenuContent' &&
        name !== 'MenuItem' &&
        name !== 'MenuRadioGroup' &&
        name !== 'MenuRadioItem'
    );
    const tree = createElement(
      'div',
      null,
      ...standalone.map((name) =>
        createElement('div', { key: name }, PART_TABLE[name]!.mount(track))
      )
    );
    const fixture = renderUnattached(tree);
    resetCounts(counts);
    const before = fixture.controller.getState().refusedCommand;

    act(() => {
      void fixture.controller.mute();
    });

    expectFieldMoved(
      'refusedCommand',
      before,
      fixture.controller.getState().refusedCommand
    );
    assertOnlyDeclaredPartsMoved('refusedCommand', {}, counts);
  });
});
