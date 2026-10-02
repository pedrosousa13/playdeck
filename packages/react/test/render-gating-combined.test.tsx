// @vitest-environment happy-dom

// A provider's own poll can report `buffered`/`seekable` afresh on every
// tick, under a new array identity, whether or not either range actually
// moved -- YouTube's 250ms poll
// (`provider-youtube/src/time-updates.ts`) does this, and so does any
// provider's `progress` event. `render-gating.test.tsx` drives exactly one
// `PlayerState` field per emit (see its own `DRIVEN_FIELDS` comment), so it
// never exercises a patch shaped like a real tick -- one that repeats
// `buffered`'s content, or carries a real `currentTime` change alongside an
// unmoved `buffered`. This file drives that shape directly, against the two
// parts the issue measured: `SeekSlider` (reads `buffered`, `seekable` and
// `currentTime`) and `Time` (reads `currentTime` but neither range field).

import {
  act,
  cleanup,
  render,
  type RenderResult
} from '@testing-library/react';
import {
  createRef,
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactNode
} from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
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

// --- fixture plumbing, the same mock-adapter shape render-gating.test.tsx
// and controls.test.tsx use --

const ok = async (): Promise<CommandResult> => ({ ok: true });

const createMockAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: ok,
    pause: ok,
    seekTo: ok,
    seekBy: ok,
    mute: ok,
    unmute: ok,
    setVolume: ok
  };
  return {
    adapter,
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      listeners.forEach((listener) => listener(patch, event))
  };
};

type Fixture = RenderResult & {
  readonly controller: InternalControllerAccess[typeof INTERNAL_CONTROLLER];
  readonly emit: (patch: ProviderStatePatch, event?: ProviderEvent) => void;
};

const renderWithPlayer = (
  ui: ReactNode,
  initial?: ProviderStatePatch
): Fixture => {
  const handle = createRef<Player.PlayerHandle>();
  const utils = render(
    <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
      {ui}
    </Player.Root>
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
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      act(() => mock.emit(patch, event))
  };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- render counting, the same Profiler-based shape render-gating.test.tsx
// uses --

type Counts = Record<string, number>;

const makeCounter =
  (counts: Counts, name: string): ProfilerOnRenderCallback =>
  () => {
    counts[name] = (counts[name] ?? 0) + 1;
  };

const resetCounts = (counts: Counts): void => {
  for (const key of Object.keys(counts)) delete counts[key];
};

// --- fixture state ----------------------------------------------------------

const available: Availability = { status: 'available' };

// Every gate `SeekSlider` reads available, so it renders its full body rather
// than bailing out on `status !== 'available'`
// (`transport-controls.tsx`'s own gate above `SeekSlider`'s return).
const capabilities: PlayerCapabilities = {
  seek: available,
  setVolume: available,
  setPlaybackRate: available,
  selectQuality: available,
  selectQualityAuto: available,
  selectTextTrack: available,
  selectAudioTrack: available,
  chapters: available,
  liveEdge: available,
  fullscreen: available,
  pictureInPicture: available,
  airPlay: available,
  customControls: available,
  providerPoster: available,
  remotePlayback: available
};

const BASELINE_PATCH: ProviderStatePatch = {
  lifecycle: 'ready',
  activation: 'ready',
  provider: 'native',
  playback: 'paused',
  buffering: false,
  currentTime: 10,
  duration: 100,
  buffered: [{ start: 0, end: 20 }],
  seekable: [{ start: 0, end: 100 }],
  capabilities
};

const setup = (): { readonly fixture: Fixture; readonly counts: Counts } => {
  const counts: Counts = {};
  const fixture = renderWithPlayer(
    <div>
      <Profiler id="SeekSlider" onRender={makeCounter(counts, 'SeekSlider')}>
        <Player.SeekSlider />
      </Profiler>
      <Profiler id="Time" onRender={makeCounter(counts, 'Time')}>
        <Player.Time />
      </Profiler>
    </div>,
    BASELINE_PATCH
  );
  return { fixture, counts };
};

describe('combined provider updates do not re-render for identity-only range changes', () => {
  // The shape the issue measured directly: one real `buffered` change,
  // followed by 19 ticks that repeat the same span under a fresh array
  // identity, the way YouTube's 250ms poll reports `buffered` on every tick
  // regardless of whether it moved.
  test('a repeated buffered patch under a new identity moves SeekSlider once in 20 ticks, not once per tick', () => {
    const { fixture, counts } = setup();
    resetCounts(counts);

    fixture.emit({ buffered: [{ start: 0, end: 50 }] });
    for (let tick = 0; tick < 19; tick += 1) {
      fixture.emit({ buffered: [{ start: 0, end: 50 }] });
    }

    expect(counts['SeekSlider']).toBe(1);
    expect(counts['Time']).toBeUndefined();
  });

  // The same shape for `seekable`, mirroring the `buffered` case above --
  // both fields go through the same `#applyPatch` branch in
  // `player-controller.ts`.
  test('a repeated seekable patch under a new identity moves SeekSlider once in 20 ticks, not once per tick', () => {
    const { fixture, counts } = setup();
    resetCounts(counts);

    fixture.emit({ seekable: [{ start: 0, end: 150 }] });
    for (let tick = 0; tick < 19; tick += 1) {
      fixture.emit({ seekable: [{ start: 0, end: 150 }] });
    }

    expect(counts['SeekSlider']).toBe(1);
    expect(counts['Time']).toBeUndefined();
  });

  // A realistic combined tick: `currentTime` actually advances, and
  // `buffered` is reported again at its already-current span under a new
  // identity, the way one time-update tick from a real provider carries
  // both fields at once. `SeekSlider` and `Time` both read `currentTime`, so
  // both must still move for that real change -- this fix must not make a
  // real `currentTime` change go unseen, only an identity-only `buffered`
  // change.
  test('currentTime moving alongside an identity-only buffered repeat still re-renders both currentTime readers', () => {
    const { fixture, counts } = setup();
    resetCounts(counts);

    fixture.emit({ currentTime: 42, buffered: [{ start: 0, end: 20 }] });

    expect(counts['SeekSlider']).toBe(1);
    expect(counts['Time']).toBe(1);
  });

  // The tick after that one: `currentTime` repeats the same value and
  // `buffered` repeats the same span, each under yet another fresh
  // `buffered` identity. Nothing actually moved, so neither part should
  // render again.
  test('a tick that repeats both currentTime and buffered by value renders neither part again', () => {
    const { fixture, counts } = setup();
    resetCounts(counts);
    fixture.emit({ currentTime: 42, buffered: [{ start: 0, end: 20 }] });
    resetCounts(counts);

    fixture.emit({ currentTime: 42, buffered: [{ start: 0, end: 20 }] });

    expect(counts['SeekSlider']).toBeUndefined();
    expect(counts['Time']).toBeUndefined();
  });
});
