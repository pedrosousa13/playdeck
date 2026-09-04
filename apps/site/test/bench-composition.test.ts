import { describe, expect, it } from 'vitest';
import { buildComposition, type BenchPosition } from '../src/bench-composition';

const NATIVE_URL = 'https://example.com/clip.mp4';
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=example';

describe('buildComposition', () => {
  it('prints the real ten-control tree, SeekSlider first', () => {
    const code = buildComposition({
      source: 'youtube',
      skin: 'theme',
      sourceUrl: YOUTUBE_URL
    });
    const tree = code.slice(code.indexOf('<Player.Root'));
    expect(tree).toBe(
      [
        '<Player.Root source={source}>',
        '  <Player.Viewport>',
        '    <Player.Media />',
        '    <Player.Poster showWhilePaused>',
        '      <Player.PosterImage />',
        '    </Player.Poster>',
        '    <Player.Controls>',
        '      <Player.SeekSlider />',
        '      <Player.PlayButton />',
        '      <Player.MuteButton />',
        '      <Player.VolumeSlider />',
        '      <Player.Time type="current" />',
        '      <span aria-hidden="true"> / </span>',
        '      <Player.Time type="duration" />',
        '      <Player.CaptionsButton />',
        '      <Player.SettingsMenu>',
        '        <Player.SettingsMenuTrigger />',
        '        <Player.SettingsMenuContent />',
        '      </Player.SettingsMenu>',
        '      <Player.PipButton />',
        '      <Player.FullscreenButton />',
        '    </Player.Controls>',
        '  </Player.Viewport>',
        '</Player.Root>'
      ].join('\n')
    );
  });

  it('changes the source URL when the source switch changes, and nothing else but the youtube poster line', () => {
    const native = buildComposition({
      source: 'native',
      skin: 'theme',
      sourceUrl: NATIVE_URL
    });
    const youtube = buildComposition({
      source: 'youtube',
      skin: 'theme',
      sourceUrl: YOUTUBE_URL
    });

    expect(native).toContain(`const source = '${NATIVE_URL}';`);
    expect(youtube).toContain(`const source = '${YOUTUBE_URL}';`);

    // The claim the panel makes: one API drives every provider, so the
    // composition itself -- everything from `<Player.Root` down, past whatever
    // preamble the skin wrote -- does not change shape when the provider does,
    // with exactly one deliberate exception: `showWhilePaused` on the youtube
    // position's own `<Player.Poster>`, covering the chrome its embed draws
    // over an idle iframe. Compared line by line rather than as one block, so
    // a future difference anywhere else in the tree fails loudly instead of
    // being folded into "the poster line changed too".
    const compositionLines = (code: string) =>
      code.slice(code.indexOf('<Player.Root')).split('\n');
    const nativeLines = compositionLines(native);
    const youtubeLines = compositionLines(youtube);
    expect(youtubeLines).toHaveLength(nativeLines.length);
    const differences = nativeLines
      .map((line, index) => [line, youtubeLines[index]] as const)
      .filter(([nativeLine, youtubeLine]) => nativeLine !== youtubeLine);
    expect(differences).toEqual([
      ['    <Player.Poster>', '    <Player.Poster showWhilePaused>']
    ]);
  });

  // The autoplay switch is gone from the bench, and the prop is gone from this
  // builder with it -- see the file header for why it demonstrated nothing.
  // Pinned rather than assumed, so a later session does not reintroduce it as
  // a "harmless" default.
  it('names no prop on Player.Root but the source', () => {
    for (const skin of ['theme', 'docked'] as const) {
      const code = buildComposition({
        source: 'native',
        skin,
        sourceUrl: NATIVE_URL
      });
      expect(code).toContain('<Player.Root source={source}>');
      expect(code).not.toContain('autoplay');
    }
  });

  it('prints a four-line preamble with a real import, for either skin', () => {
    const themed = buildComposition({
      source: 'native',
      skin: 'theme',
      sourceUrl: NATIVE_URL
    });
    expect(themed.split('\n')[0]).toBe("import '@playdeck/react/theme.css';");
    expect(themed.split('\n')[1]).toBe('');
    expect(themed.split('\n')[2]).toBe(`const source = '${NATIVE_URL}';`);
    expect(themed.split('\n')[3]).toBe('');

    const docked = buildComposition({
      source: 'native',
      skin: 'docked',
      sourceUrl: NATIVE_URL
    });
    expect(docked.split('\n')[0]).toBe("import '@playdeck/react/docked.css';");
    expect(docked.split('\n')[1]).toBe('');
    expect(docked.split('\n')[2]).toBe(`const source = '${NATIVE_URL}';`);
    expect(docked.split('\n')[3]).toBe('');
  });

  it('prints the same control tree under either skin', () => {
    const themed = buildComposition({
      source: 'native',
      skin: 'theme',
      sourceUrl: NATIVE_URL
    });
    const docked = buildComposition({
      source: 'native',
      skin: 'docked',
      sourceUrl: NATIVE_URL
    });
    const compositionBlock = (code: string) =>
      code.slice(code.indexOf('<Player.Root'));
    expect(compositionBlock(themed)).toBe(compositionBlock(docked));
  });

  it('carries a long source URL through whole, without truncating or eliding it', () => {
    const longUrl = `https://example.com/videos/${'a'.repeat(500)}.mp4`;
    const code = buildComposition({
      source: 'native',
      skin: 'theme',
      sourceUrl: longUrl
    });
    expect(code).toContain(`const source = '${longUrl}';`);
    expect(code).not.toContain('…');
    expect(code).not.toContain('...');
  });

  it.each<BenchPosition>([
    { source: 'native', skin: 'theme', sourceUrl: NATIVE_URL },
    { source: 'youtube', skin: 'theme', sourceUrl: YOUTUBE_URL },
    {
      source: 'vimeo',
      skin: 'theme',
      sourceUrl: 'https://vimeo.com/000000000'
    },
    {
      source: 'wistia',
      skin: 'theme',
      sourceUrl: 'https://example.wistia.com/medias/abc123'
    }
  ])('never leaves a trailing space on a line ($source/$skin)', (position) => {
    for (const line of buildComposition(position).split('\n')) {
      expect(line).toBe(line.trimEnd());
    }
  });
});
