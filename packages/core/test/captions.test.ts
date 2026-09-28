import { describe, expect, test } from 'vitest';
import {
  createInitialPlayerState,
  PlayerController,
  plainCueText,
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

describe('plainCueText', () => {
  test('strips WebVTT tag spans and decodes the entity the tags surrounded', () => {
    expect(plainCueText('<v Bob><i>Look out</i> &amp; run')).toBe(
      'Look out & run'
    );
  });

  test('decodes the six named escapes this helper covers', () => {
    expect(
      plainCueText('rock &amp; roll &lt;loud&gt;&nbsp;now&lrm;&rlm;')
    ).toBe('rock & roll <loud> now‎‏');
  });

  // `&amp;lt;` is an author writing the literal text `&lt;`. A single regex
  // pass over the original string is what keeps it that way: the match at
  // `&amp;` consumes those five characters, and the `lt;` immediately after
  // is untouched text with no `&` of its own, so it is never read as a
  // second reference.
  test('a doubly-escaped named entity does not decode twice', () => {
    expect(plainCueText('writes &amp;lt; as text')).toBe('writes &lt; as text');
  });

  test('leaves a named entity outside the covered six untouched', () => {
    expect(plainCueText('&quot;quoted&quot;')).toBe('&quot;quoted&quot;');
  });

  test('decodes decimal and hexadecimal numeric character references', () => {
    expect(plainCueText('&#38; &#65; &#x26; &#X41;')).toBe('& A & A');
  });

  // A decoded `<` from a numeric reference is not re-read as a tag delimiter:
  // tag stripping already ran, and nothing here runs it again.
  test('a numeric reference decoding to < or > stays text, not a tag delimiter', () => {
    expect(plainCueText('&#60;i&#62;not italic&#60;/i&#62;')).toBe(
      '<i>not italic</i>'
    );
  });

  // 0, a lone surrogate half (0xD800-0xDFFF), and anything past 0x10FFFF name
  // no valid code point; each maps to U+FFFD rather than throwing or being
  // left literal.
  test('maps an invalid or out-of-range numeric reference to U+FFFD', () => {
    expect(plainCueText('&#0;&#55296;&#1114112;')).toBe('���');
  });

  // `&amp;#38;` is an author writing the literal text `&#38;`: escaping
  // only the leading `&` as `&amp;` is how WebVTT cue text writes a
  // literal `&` immediately followed by `#38;`. The single regex pass
  // matches `&amp;` alone and leaves the untouched `#38;` beside it, so it
  // never becomes a second, unintended numeric reference.
  test('a doubly-escaped numeric entity does not decode twice', () => {
    expect(plainCueText('&amp;#38;')).toBe('&#38;');
  });

  // The bug a sequential chain of `.replace` calls has and a single regex
  // pass does not: an earlier call's decoded output can itself read as a
  // later call's entity. `&#x26;amp;`'s numeric half decodes to `&`,
  // landing right before the literal `amp;` that followed it -- a chain
  // that still had an `&amp;` step left to run would read that adjacency as
  // a second entity and decode it again into `&`. `&#38;lt;` is the same
  // shape one step earlier: the decimal reference decodes to `&`, landing
  // before the literal `lt;` that followed it.
  test('a numeric reference decoding to & or < does not compose with adjacent literal text into a new entity', () => {
    expect(plainCueText('&#x26;amp;')).toBe('&amp;');
    expect(plainCueText('&#38;lt;')).toBe('&lt;');
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
