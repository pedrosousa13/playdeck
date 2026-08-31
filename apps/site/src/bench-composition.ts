/*
 * The composition the three switches on `/` describe, as the source a reader
 * would write to get the player above it.
 *
 * A pure function rather than hand-written snippets, because the panel's whole
 * argument is that the knobs are compositions and not options. Fixed strings
 * would be claims about what the switches do; this is the thing they do.
 */
import type { AutoplayMode, PlayerProvider } from '@playdeck/core';

export type SkinName = 'none' | 'theme';

export type BenchPosition = {
  readonly source: PlayerProvider;
  readonly skin: SkinName;
  readonly autoplay: AutoplayMode;
  // The URL the source switch resolved to. Resolving a provider to a URL is
  // not this module's job -- it takes the URL as a field so it stays pure and
  // has no opinion about where that URL came from.
  readonly sourceUrl: string;
};

export const buildComposition = ({
  skin,
  autoplay,
  sourceUrl
}: BenchPosition): string => {
  // The composition never names a provider: the library detects one from the
  // URL, so `source={source}` is the whole prop regardless of which provider
  // switched on. What changes is the `const` line above it.
  const rootProps = ['source={source}'];
  if (autoplay !== false) rootProps.push(`autoplay="${autoplay}"`);

  // The theme import and the source declaration are lines a consumer would
  // write above the composition, not props on it. Keeping them out of
  // `Player.Root` is what lets the composition below read byte-identical
  // regardless of which provider is switched on.
  const preamble = [
    ...(skin === 'theme' ? ["import '@playdeck/react/theme.css';", ''] : []),
    `const source = '${sourceUrl}';`,
    ''
  ];

  // One prop stays on the opening line; two or more take a line each, which is
  // how a reader would have written it and how prettier would leave it.
  const open =
    rootProps.length === 1
      ? `<Player.Root ${rootProps[0]}>`
      : ['<Player.Root', ...rootProps.map((prop) => `  ${prop}`), '>'].join(
          '\n'
        );

  return [
    ...preamble,
    open,
    '  <Player.Viewport>',
    '    <Player.Media />',
    '    <Player.Controls />',
    '  </Player.Viewport>',
    '</Player.Root>'
  ].join('\n');
};
