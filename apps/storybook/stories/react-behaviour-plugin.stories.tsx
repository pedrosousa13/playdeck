import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  PlayerController,
  PlayerErrorCategory,
  ProviderAdapter,
  ProviderEvent,
  ProviderStatePatch
} from '@playdeck/core';
import { createInitialPlayerState } from '@playdeck/core';
import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import {
  AnalyticsEvents,
  type BehaviourPluginEvent
} from '../../../examples/react-behaviour-plugin';

/*
 * Stages `examples/react-behaviour-plugin.tsx` live: `AnalyticsEvents` sits
 * beside a real `Player.PlayButton` and prints every mapped event as it
 * arrives, so the mapping the `Overview/Behaviour plugins` guide describes is
 * checkable by eye rather than taken on faith.
 *
 * Composes its own `Player.Root` and its own provider instead of the shared
 * mock decorator (`real-playback` opts a story out of it): `.storybook/mock-
 * player.tsx`'s `seekTo` mock patches `currentTime` alone and never reports a
 * seek in flight, which would leave the one event this page exists to
 * demonstrate unreachable. `real-playback` carries `!test` alongside it, the
 * way `supplied-provider.stories.tsx` and `archetype-course.stories.tsx`'s own
 * `RealRecording` do — `real-playback.contract.test.ts` fails any story file
 * tagged one without the other — so this fixture carries no `play` function
 * of its own (a human drives every button by hand in the workbench) and is
 * instead driven by `e2e/behaviour-plugin-analytics.spec.ts`, this repo's
 * proof for AC2 the way `e2e/supplied-provider.spec.ts` is
 * `SuppliedProviderFixture`'s — a `play` function here would race that
 * spec's own clicks, since Storybook runs one as soon as a story mounts with
 * no way for an external driver to wait it out first.
 *
 * Play and pause go through the real command `Player.PlayButton` issues
 * (`togglePlaybackWithOrigin('user')`). Seek goes through
 * `seekToWithOrigin`, the same method every seek primitive in this package
 * calls (`chapters.tsx`, `controls.tsx`, `gestures.tsx`,
 * `transport-controls.tsx`) — reached here through the one hatch
 * `packages/react/src/internal-controller.ts` documents
 * (`Symbol.for('playdeck.internal.controller')`), because `seekToWithOrigin`
 * is not on `PlayerActions`/`PlayerHandle`. `Ended` and `Error` have no such
 * path without real media loaded and failing, so those two buttons call the
 * adapter directly; both are labelled "(simulated)" so nobody reads the
 * button as a real command a consumer could issue.
 */
const available: Availability = { status: 'available' };

// Never fetched, for the same reason `.storybook/mock-player.tsx` gives:
// `loading="interaction"` never commits it, and this adapter attaches
// directly through the internal hatch below rather than through source
// detection. `.invalid` (RFC 2606) is what keeps a description of this
// non-source from doubling as an unrefused network path (#331).
const source: Player.RootProps['source'] = {
  type: 'video',
  sources: [
    { src: 'https://provider.invalid/mock-video.mp4', mimeType: 'video/mp4' }
  ]
};

const createDemoAdapter = () => {
  const listeners = new Set<
    (patch: ProviderStatePatch, event?: ProviderEvent) => void
  >();
  const emit = (patch: ProviderStatePatch, event?: ProviderEvent) => {
    listeners.forEach((listener) => listener(patch, event));
  };
  const ok = async (): Promise<CommandResult> => ({ ok: true });
  const capabilities: PlayerCapabilities = {
    ...createInitialPlayerState().capabilities,
    seek: available
  };
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {
      emit({
        lifecycle: 'ready',
        activation: 'ready',
        playback: 'paused',
        duration: 30,
        currentTime: 0,
        capabilities,
        commandsReady: true
      });
    },
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: async () => {
      emit({ playback: 'playing' });
      return { ok: true };
    },
    pause: async () => {
      emit({ playback: 'paused' });
      return { ok: true };
    },
    seekTo: async (time) => {
      emit(
        { seeking: true, currentTime: time },
        { type: 'seeking', detail: { currentTime: time }, origin: 'provider' }
      );
      // A real provider settles `seeking` back to `false` only once real
      // media has caught up, never in the same tick it started -- the two
      // never batch into one update there. Emitting the settle synchronously
      // right behind the start would do exactly that here (React folds two
      // same-tick updates into the render that reflects only the second),
      // which would hide the started half from anything reading player state,
      // this example included. `setTimeout` is what keeps them apart.
      setTimeout(() => emit({ seeking: false }), 0);
      return { ok: true };
    },
    mute: ok,
    unmute: ok,
    setVolume: ok,
    setPlaybackRate: ok
  };
  return {
    adapter,
    finish: () => emit({ playback: 'ended' }),
    fail: () => {
      const category: PlayerErrorCategory = 'network';
      emit({
        lifecycle: 'error',
        activation: 'error',
        error: {
          category,
          fatal: true,
          recoverable: true,
          message: 'The media element could not load the source.'
        }
      });
    }
  };
};

const eventText = (event: BehaviourPluginEvent): string => {
  switch (event.type) {
    case 'seek':
      return `seek (${event.origin})`;
    case 'error':
      return `error: ${event.message}`;
    default:
      return event.type;
  }
};

const AnalyticsEventsDemo = () => {
  const ref = useRef<Player.PlayerHandle>(null);
  const demo = useRef<ReturnType<typeof createDemoAdapter> | undefined>(
    undefined
  );
  const [events, setEvents] = useState<readonly BehaviourPluginEvent[]>([]);

  useEffect(() => {
    const controller = (
      ref.current as unknown as Record<symbol, PlayerController> | null
    )?.[Symbol.for('playdeck.internal.controller')];
    if (!controller) return;
    demo.current = createDemoAdapter();
    controller.setProvider(demo.current.adapter);
    return () => controller.setProvider(undefined);
  }, []);

  const seekToTen = () => {
    const controller = (
      ref.current as unknown as Record<symbol, PlayerController> | null
    )?.[Symbol.for('playdeck.internal.controller')];
    void controller?.seekToWithOrigin(10, 'user');
  };

  return (
    <Player.Root loading="interaction" ref={ref} source={source}>
      <AnalyticsEvents
        onEvent={(event) => setEvents((prior) => [...prior, event])}
      />
      <Player.Viewport
        style={{ width: 480, background: '#0b0e13', padding: '1rem' }}
      >
        <Player.PlayButton />
        <button onClick={seekToTen} type="button">
          Seek to 10s
        </button>
        <button onClick={() => demo.current?.finish()} type="button">
          Finish (simulated)
        </button>
        <button onClick={() => demo.current?.fail()} type="button">
          Fail (simulated)
        </button>
        <ul aria-label="Mapped events">
          {events.map((event, index) => (
            // An append-only log: index is stable for every entry already rendered.
            <li key={index}>{eventText(event)}</li>
          ))}
        </ul>
      </Player.Viewport>
    </Player.Root>
  );
};

const meta = {
  title: 'Behaviour plugins/Analytics events',
  component: AnalyticsEventsDemo,
  tags: ['real-playback', '!test'],
  parameters: {
    docs: {
      description: {
        component:
          '`examples/react-behaviour-plugin.tsx` mounted live: `AnalyticsEvents` renders nothing itself, and every line below is printed by this story reading its `onEvent` callback.'
      }
    }
  },
  render: () => <AnalyticsEventsDemo />
} satisfies Meta<typeof AnalyticsEventsDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

// No `play` function, deliberately, the same as `SuppliedProviderFixture`'s
// `ExampleFileClip`: this fixture is driven from outside, by
// `e2e/behaviour-plugin-analytics.spec.ts`, and a `play` function here would
// race that spec's own clicks on the same buttons -- Storybook runs a
// story's `play` as soon as the story mounts, with no way for an external
// driver to wait it out first. A human opening this story in the workbench
// still drives it by hand: every button is real, and the printed log is
// exactly what `e2e/behaviour-plugin-analytics.spec.ts` asserts on.
export const Sequence: Story = {};
