import type {
  CommandResult,
  PlayerController,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  ProviderStatePatch
} from '@playdeck/core';
import { Root, type PlayerHandle, type RootProps } from '@playdeck/react';
import { act, cleanup, render } from '@testing-library/react';
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type RefObject
} from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnalyticsEvents,
  type BehaviourPluginEvent
} from '../../../examples/react-behaviour-plugin';

// Never fetched, for the same reason `mock-player.contract.test.ts` gives:
// `loading="interaction"` never commits it, so nothing here issues a request.
const source: RootProps['source'] = {
  type: 'video',
  sources: [
    { src: 'https://provider.invalid/mock-video.mp4', mimeType: 'video/mp4' }
  ]
};

/**
 * A provider adapter whose state is driven entirely by the test — no timers,
 * no media element. `seekTo` confirms with a `seeking` event rather than a
 * bare patch, because `PlayerController` only ever reads `seekOrigin` off its
 * own pending-origin record (set by the `seekToWithOrigin` call that issued
 * the command, consumed against a matching event) and never off a patch an
 * adapter supplied directly — an adapter reporting one nobody asked for reads
 * as `'provider'` regardless of what the patch says, which is exactly what
 * `PlayerState.seekOrigin`'s own comment (`packages/core/src/types.ts`)
 * promises.
 */
const createScriptableAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  const ok = async (): Promise<CommandResult> => ({ ok: true });
  const emit = (patch: ProviderStatePatch, event?: ProviderEvent) => {
    listeners.forEach((listener) => listener(patch, event));
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
    play: ok,
    pause: ok,
    seekTo: async (time) => {
      emit(
        { seeking: true, currentTime: time },
        { type: 'seeking', detail: { currentTime: time }, origin: 'provider' }
      );
      return { ok: true };
    },
    mute: ok,
    unmute: ok,
    setVolume: ok,
    setPlaybackRate: ok
  };
  return { adapter, emit };
};

/**
 * Mounts a real `Player.Root` around `AnalyticsEvents`, wires a scriptable
 * adapter into it the same way `.storybook/mock-player.tsx` reaches the
 * controller — through the one hatch `packages/react/src/internal-controller.ts`
 * documents (`Symbol.for('playdeck.internal.controller')`), spelled out here
 * rather than imported for the same reason that file gives: the hatch has one
 * name, and grepping the string finds every reader of it.
 *
 * `onEvent` is `(event) => setEvents((prior) => [...prior, event])` —
 * `setState`, not a closure pushing into an array outside React — because
 * that is what a consumer who wants to *show* the events, the workbench
 * story among them, actually writes. It hands `AnalyticsEvents` a new
 * function every render this harness makes, which is deliberate: the
 * component must derive every emitted event from the player state that
 * changed, never from a prop reference changing, and a harness that kept
 * `onEvent` stable could not tell the two apart.
 */
const stageAnalyticsEvents = (): {
  readonly emit: (patch: ProviderStatePatch, event?: ProviderEvent) => void;
  readonly controller: PlayerController;
  readonly events: () => readonly BehaviourPluginEvent[];
} => {
  const staged: {
    emit?: (patch: ProviderStatePatch, event?: ProviderEvent) => void;
    controller?: PlayerController;
    events?: readonly BehaviourPluginEvent[];
  } = {};
  const Harness = () => {
    const ref = useRef<PlayerHandle>(null);
    const [events, setEvents] = useState<readonly BehaviourPluginEvent[]>([]);
    staged.events = events;
    useEffect(() => {
      const controller = (
        ref.current as unknown as Record<symbol, PlayerController> | null
      )?.[Symbol.for('playdeck.internal.controller')];
      if (!controller) return;
      const { adapter, emit } = createScriptableAdapter();
      controller.setProvider(adapter);
      staged.emit = emit;
      staged.controller = controller;
      return () => controller.setProvider(undefined);
    }, []);
    return createElement(Root, {
      children: createElement(AnalyticsEvents, {
        onEvent: (event) => setEvents((prior) => [...prior, event])
      }),
      loading: 'interaction',
      ref,
      source
    } satisfies RootProps & { readonly ref: RefObject<PlayerHandle | null> });
  };
  render(createElement(Harness));
  return {
    emit: (patch, event) => staged.emit!(patch, event),
    get controller() {
      return staged.controller!;
    },
    events: () => staged.events!
  };
};

describe('AnalyticsEvents (react-behaviour-plugin example)', () => {
  afterEach(cleanup);

  it('emits the mapped sequence for a scripted playback, and only once per transition', async () => {
    const { emit, controller, events } = stageAnalyticsEvents();

    // Settling into a ready, paused player is not itself a transition — a
    // player starts paused, so there is nothing to have transitioned from.
    await act(async () => {
      emit({ lifecycle: 'ready', activation: 'ready', playback: 'paused' });
    });
    expect(events()).toEqual([]);

    await act(async () => {
      emit({ playback: 'playing' });
    });
    await act(async () => {
      emit({ playback: 'paused' });
    });
    // Tagged `'user'` the way `Player.SeekSlider` tags a scrub — a viewer
    // acted, not the untagged `'api'` `seekTo` on `PlayerActions` defaults to.
    await act(async () => {
      await controller.seekToWithOrigin(4, 'user');
    });
    await act(async () => {
      emit({ seeking: false, currentTime: 4 });
    });
    await act(async () => {
      emit({ playback: 'ended' });
    });
    await act(async () => {
      emit({
        lifecycle: 'error',
        activation: 'error',
        error: {
          category: 'network',
          fatal: true,
          recoverable: true,
          message: 'The media element could not load the source.'
        }
      });
    });

    expect(events()).toEqual([
      { type: 'play' },
      { type: 'pause' },
      { type: 'seek', origin: 'user' },
      { type: 'ended' },
      {
        type: 'error',
        message: 'The media element could not load the source.'
      }
    ] satisfies BehaviourPluginEvent[]);
  });
});
