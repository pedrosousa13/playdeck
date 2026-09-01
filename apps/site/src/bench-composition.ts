/*
 * The composition the two switches on `/` describe, as the source a reader
 * would write to get the player above it.
 *
 * A pure function rather than hand-written snippets, because the panel's whole
 * argument is that the knobs are compositions and not options. Fixed strings
 * would be claims about what the switches do; this is the thing they do.
 *
 * There was a third switch, `autoplay`, and it is gone rather than disabled.
 * `/` mounts its player with `loading="interaction"`, so the player can only
 * ever start from a user gesture, and after a gesture the browser permits the
 * audible attempt -- which means the refusal-and-muted-retry that switch existed
 * to show could never occur on this page. What was left was a switch whose only
 * effect was to add a prop to the block below, and a knob that argues by
 * printing itself is not an argument. Autoplay recovery is not sold on `/`.
 */
import type { PlayerProvider } from '@playdeck/core';

export type SkinName = 'none' | 'theme';

export type BenchPosition = {
  readonly source: PlayerProvider;
  readonly skin: SkinName;
  // The URL the source switch resolved to. Resolving a provider to a URL is
  // not this module's job -- it takes the URL as a field so it stays pure and
  // has no opinion about where that URL came from.
  readonly sourceUrl: string;
};

export const buildComposition = ({
  skin,
  sourceUrl
}: BenchPosition): string => {
  // The composition never names a provider: the library detects one from the
  // URL, so `source={source}` is the whole of `Player.Root`'s configuration
  // regardless of which provider switched on. What changes is the `const` line
  // above it. That is the claim the panel makes -- and it is why there is one
  // prop here rather than a list: with autoplay gone, nothing either switch
  // does can add a second one, so the branch that wrapped two or more props
  // onto their own lines went with it rather than sitting unreachable.

  // The theme import and the source declaration are lines a consumer would
  // write above the composition, not props on it. Keeping them out of
  // `Player.Root` is what lets the six lines below read byte-identical
  // regardless of which provider is switched on.
  const preamble = [
    ...(skin === 'theme' ? ["import '@playdeck/react/theme.css';", ''] : []),
    `const source = '${sourceUrl}';`,
    ''
  ];

  return [
    ...preamble,
    '<Player.Root source={source}>',
    '  <Player.Viewport>',
    '    <Player.Media />',
    '    <Player.Controls />',
    '  </Player.Viewport>',
    '</Player.Root>'
  ].join('\n');
};
