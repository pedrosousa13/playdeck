import { describe, expect, test } from 'vitest';
import {
  createInitialPlayerState,
  PlayerController,
  textTrackLabel,
  type ProviderAdapter,
  type ProviderStatePatch,
  type TextCue,
  type TextTrack
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

describe('textTrackLabel', () => {
  test('keeps a usable label, trimmed', () => {
    expect(textTrackLabel('  English  ', 'en')).toBe('English');
  });

  test('names the language in itself when the label is missing or blank', () => {
    expect(textTrackLabel('', 'fr')).toBe('français');
    expect(textTrackLabel(null, 'de')).toBe('Deutsch');
    expect(textTrackLabel(undefined, '  en ')).toBe('English');
  });

  test('falls back to the raw code for an untranslatable tag', () => {
    expect(textTrackLabel('', 'not a tag!')).toBe('not a tag!');
  });

  // Without `fallback: 'none'` Intl invents a name in the runtime's own
  // locale for codes with no display data of their own — 'und' becomes
  // 'root', which is worse than showing the code.
  test('shows the raw code for a language with no display name of its own', () => {
    expect(textTrackLabel('', 'und')).toBe('und');
  });

  test('falls back to Unknown with neither a label nor a language', () => {
    expect(textTrackLabel('', null)).toBe('Unknown');
    expect(textTrackLabel(undefined, undefined)).toBe('Unknown');
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

describe('published textTracks', () => {
  test('copies and freezes the patched list and its entries', () => {
    let emit: ((patch: ProviderStatePatch) => void) | undefined;
    const c = new PlayerController();
    c.setProvider(
      noopAdapter({
        subscribe: (listener) => {
          emit = listener;
          return () => {};
        }
      })
    );
    const providerTracks: TextTrack[] = [
      {
        id: 't1',
        label: 'English',
        language: 'en',
        kind: 'captions',
        readiness: 'loaded'
      }
    ];
    emit?.({ textTracks: providerTracks });

    const published = c.getState().textTracks;
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published[0])).toBe(true);
    // The provider keeps mutating its own array; the published snapshot must
    // not follow it.
    providerTracks.push({
      id: 't2',
      label: 'French',
      language: 'fr',
      kind: 'captions',
      readiness: 'loaded'
    });
    expect(c.getState().textTracks).toHaveLength(1);
  });
});
