import { describe, expect, it } from 'vitest';
import { buildComposition, type BenchPosition } from '../src/bench-composition';
import type { AutoplayMode } from '@playdeck/core';

const NATIVE_URL = 'https://example.com/clip.mp4';
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=example';

describe('buildComposition', () => {
  it('prints the smallest composition when nothing is switched', () => {
    expect(
      buildComposition({
        source: 'native',
        skin: 'none',
        autoplay: false,
        sourceUrl: NATIVE_URL
      })
    ).toBe(
      [
        `const source = '${NATIVE_URL}';`,
        '',
        '<Player.Root source={source}>',
        '  <Player.Viewport>',
        '    <Player.Media />',
        '    <Player.Controls />',
        '  </Player.Viewport>',
        '</Player.Root>'
      ].join('\n')
    );
  });

  it('puts each prop on its own line once autoplay is on', () => {
    expect(
      buildComposition({
        source: 'native',
        skin: 'none',
        autoplay: 'audible-then-muted',
        sourceUrl: NATIVE_URL
      })
    ).toBe(
      [
        `const source = '${NATIVE_URL}';`,
        '',
        '<Player.Root',
        '  source={source}',
        '  autoplay="audible-then-muted"',
        '>',
        '  <Player.Viewport>',
        '    <Player.Media />',
        '    <Player.Controls />',
        '  </Player.Viewport>',
        '</Player.Root>'
      ].join('\n')
    );
  });

  it('changes the source URL when the source switch changes, and nothing else', () => {
    const native = buildComposition({
      source: 'native',
      skin: 'none',
      autoplay: false,
      sourceUrl: NATIVE_URL
    });
    const youtube = buildComposition({
      source: 'youtube',
      skin: 'none',
      autoplay: false,
      sourceUrl: YOUTUBE_URL
    });

    expect(native).toContain(`const source = '${NATIVE_URL}';`);
    expect(youtube).toContain(`const source = '${YOUTUBE_URL}';`);

    // The claim the panel makes: one API drives every provider, so the
    // composition itself -- everything after the `const source` line and its
    // trailing blank line -- does not change shape when the provider does.
    const compositionBlock = (code: string) =>
      code.split('\n').slice(2).join('\n');
    expect(compositionBlock(native)).toBe(compositionBlock(youtube));
  });

  it('adds no autoplay prop when autoplay is off', () => {
    const off = buildComposition({
      source: 'native',
      skin: 'none',
      autoplay: false,
      sourceUrl: NATIVE_URL
    });
    expect(off).not.toContain('autoplay');
  });

  // `AutoplayMode` has three non-`false` members, and the bench switch only
  // ever exposes one of them today. Covering all three here proves the other
  // two are reachable through this function even though nothing calls it with
  // them yet.
  it.each<Exclude<AutoplayMode, false>>([
    'muted',
    'audible',
    'audible-then-muted'
  ])('adds autoplay="%s" when the autoplay switch selects it', (autoplay) => {
    const code = buildComposition({
      source: 'native',
      skin: 'none',
      autoplay,
      sourceUrl: NATIVE_URL
    });
    expect(code).toContain(`autoplay="${autoplay}"`);
  });

  it('adds the theme import only when the theme skin is chosen', () => {
    const bare = buildComposition({
      source: 'native',
      skin: 'none',
      autoplay: false,
      sourceUrl: NATIVE_URL
    });
    expect(bare).not.toContain('theme.css');
    expect(bare.split('\n')[0]).toBe(`const source = '${NATIVE_URL}';`);

    const themed = buildComposition({
      source: 'native',
      skin: 'theme',
      autoplay: false,
      sourceUrl: NATIVE_URL
    });
    expect(themed.split('\n')[0]).toBe("import '@playdeck/react/theme.css';");
    expect(themed.split('\n')[1]).toBe('');
    expect(themed.split('\n')[2]).toBe(`const source = '${NATIVE_URL}';`);
    expect(themed.split('\n')[3]).toBe('');
  });

  it('carries a long source URL through whole, without truncating or eliding it', () => {
    const longUrl = `https://example.com/videos/${'a'.repeat(500)}.mp4`;
    const code = buildComposition({
      source: 'native',
      skin: 'none',
      autoplay: false,
      sourceUrl: longUrl
    });
    expect(code).toContain(`const source = '${longUrl}';`);
    expect(code).not.toContain('…');
    expect(code).not.toContain('...');
  });

  it.each<BenchPosition>([
    { source: 'native', skin: 'none', autoplay: false, sourceUrl: NATIVE_URL },
    {
      source: 'youtube',
      skin: 'theme',
      autoplay: 'muted',
      sourceUrl: YOUTUBE_URL
    },
    {
      source: 'vimeo',
      skin: 'theme',
      autoplay: 'audible-then-muted',
      sourceUrl: 'https://vimeo.com/000000000'
    },
    {
      source: 'wistia',
      skin: 'none',
      autoplay: 'audible',
      sourceUrl: 'https://example.wistia.com/medias/abc123'
    }
  ])(
    'never leaves a trailing space on a line ($source/$skin/$autoplay)',
    (position) => {
      for (const line of buildComposition(position).split('\n')) {
        expect(line).toBe(line.trimEnd());
      }
    }
  );
});
