import { describe, expect, it } from 'vitest';
import { buildComposition, type BenchPosition } from '../src/bench-composition';

const NATIVE_URL = 'https://example.com/clip.mp4';
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=example';

describe('buildComposition', () => {
  it('prints the six lines the page claims drive all five providers', () => {
    expect(
      buildComposition({
        source: 'native',
        skin: 'none',
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

  // The thesis paragraph on `/` says "the same six lines drive all five", and
  // this is the count it is counting. If the composition grows or loses a line,
  // that sentence changes with it or it comes out.
  it('is six lines of composition, whatever the switches are set to', () => {
    for (const skin of ['none', 'theme'] as const) {
      const code = buildComposition({
        source: 'native',
        skin,
        sourceUrl: NATIVE_URL
      });
      const composition = code
        .split('\n')
        .filter((line) => line.startsWith('<') || line.startsWith(' '));
      expect(composition).toHaveLength(6);
    }
  });

  it('changes the source URL when the source switch changes, and nothing else', () => {
    const native = buildComposition({
      source: 'native',
      skin: 'none',
      sourceUrl: NATIVE_URL
    });
    const youtube = buildComposition({
      source: 'youtube',
      skin: 'none',
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

  // The autoplay switch is gone from the bench, and the prop is gone from this
  // builder with it -- see the file header for why it demonstrated nothing.
  // Pinned rather than assumed, so a later session does not reintroduce it as
  // a "harmless" default.
  it('names no prop on Player.Root but the source', () => {
    for (const skin of ['none', 'theme'] as const) {
      const code = buildComposition({
        source: 'native',
        skin,
        sourceUrl: NATIVE_URL
      });
      expect(code).toContain('<Player.Root source={source}>');
      expect(code).not.toContain('autoplay');
    }
  });

  it('adds the theme import only when the theme skin is chosen', () => {
    const bare = buildComposition({
      source: 'native',
      skin: 'none',
      sourceUrl: NATIVE_URL
    });
    expect(bare).not.toContain('theme.css');
    expect(bare.split('\n')[0]).toBe(`const source = '${NATIVE_URL}';`);

    const themed = buildComposition({
      source: 'native',
      skin: 'theme',
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
      sourceUrl: longUrl
    });
    expect(code).toContain(`const source = '${longUrl}';`);
    expect(code).not.toContain('…');
    expect(code).not.toContain('...');
  });

  it.each<BenchPosition>([
    { source: 'native', skin: 'none', sourceUrl: NATIVE_URL },
    { source: 'youtube', skin: 'theme', sourceUrl: YOUTUBE_URL },
    {
      source: 'vimeo',
      skin: 'theme',
      sourceUrl: 'https://vimeo.com/000000000'
    },
    {
      source: 'wistia',
      skin: 'none',
      sourceUrl: 'https://example.wistia.com/medias/abc123'
    }
  ])('never leaves a trailing space on a line ($source/$skin)', (position) => {
    for (const line of buildComposition(position).split('\n')) {
      expect(line).toBe(line.trimEnd());
    }
  });
});
