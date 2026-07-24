import { describe, expect, test } from 'vitest';
import {
  createInitialPlayerState,
  PlayerController,
  type ProviderAdapter,
  type TextCue
} from '../src/index';

describe('caption initial state', () => {
  test('starts with no tracks, no selection, unavailable rendering', () => {
    const state = createInitialPlayerState();
    expect(state.textTracks).toEqual([]);
    expect(state.selectedTextTrackId).toBeNull();
    expect(state.captionRendering).toBe('unavailable');
    expect(Object.isFrozen(state.textTracks)).toBe(true);
  });
});

const noopAdapter = (over: Partial<ProviderAdapter> = {}): ProviderAdapter => ({
  provider: 'native',
  attach: () => {},
  load: () => {},
  destroy: () => {},
  subscribe: () => () => {},
  ...over
});

describe('controller cue channel', () => {
  test('emits [] when no provider is attached', () => {
    const c = new PlayerController();
    const seen: (readonly TextCue[])[] = [];
    c.subscribeCues((cues) => seen.push(cues));
    expect(seen.at(-1)).toEqual([]);
  });

  test('fans out active cues from the attached provider', () => {
    let emit: (cues: readonly TextCue[]) => void = () => {};
    const c = new PlayerController();
    c.subscribeCues(() => {});
    c.setProvider(
      noopAdapter({
        subscribeCues: (l) => {
          emit = l;
          return () => {};
        }
      })
    );
    const received: (readonly TextCue[])[] = [];
    c.subscribeCues((cues) => received.push(cues));
    emit([{ id: null, startTime: 0, endTime: 1, text: 'hi' }]);
    expect(received.at(-1)).toEqual([
      { id: null, startTime: 0, endTime: 1, text: 'hi' }
    ]);
  });

  test('setCaptionRenderer forwards to the provider', () => {
    const modes: string[] = [];
    const c = new PlayerController();
    // Attaching a provider re-applies the (default 'custom') stored mode, so
    // it appears here before the explicit 'native' call.
    c.setProvider(noopAdapter({ setCaptionRenderer: (m) => modes.push(m) }));
    c.setCaptionRenderer('native');
    expect(modes).toEqual(['custom', 'native']);
  });

  test('remembers the renderer mode set before a provider attaches and re-applies it on attach', () => {
    const modes: string[] = [];
    const c = new PlayerController();
    c.setCaptionRenderer('native');
    c.setProvider(noopAdapter({ setCaptionRenderer: (m) => modes.push(m) }));
    expect(modes).toEqual(['native']);
  });
});
