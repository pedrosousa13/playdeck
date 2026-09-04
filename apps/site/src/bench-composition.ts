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
import { BENCH_CONTROLS, type BenchControlName } from './bench-controls';

/**
 * Each control's printed source, one entry short of the lines it prints:
 * `timeDuration` carries the separator's line too, since the separator is
 * consumer text between the two `Player.Time`s rather than a control of its
 * own (see the spec's row-two contract). The settings menu prints that a
 * settings control exists, trigger and content, both self-closing, without
 * printing what `RateMenu` mounts inside it, per the spec's own instruction
 * that the panel need not print what is inside a menu.
 *
 * `Record<BenchControlName, ...>` is what makes this table and `ControlBar`'s
 * own record in `BenchIsland.tsx` unable to drift: a name added to
 * `BENCH_CONTROLS` and forgotten in either one is a compile error.
 */
const CONTROL_LINES: Record<BenchControlName, readonly string[]> = {
  seekSlider: ['<Player.SeekSlider />'],
  playButton: ['<Player.PlayButton />'],
  muteButton: ['<Player.MuteButton />'],
  volumeSlider: ['<Player.VolumeSlider />'],
  timeCurrent: ['<Player.Time type="current" />'],
  timeDuration: [
    '<span aria-hidden="true"> / </span>',
    '<Player.Time type="duration" />'
  ],
  captionsButton: ['<Player.CaptionsButton />'],
  settingsMenu: [
    '<Player.SettingsMenu>',
    '  <Player.SettingsMenuTrigger />',
    '  <Player.SettingsMenuContent />',
    '</Player.SettingsMenu>'
  ],
  pipButton: ['<Player.PipButton />'],
  fullscreenButton: ['<Player.FullscreenButton />']
};

export type SkinName = 'theme' | 'docked';

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

  // The skin import and the source declaration are lines a consumer would
  // write above the composition, not props on it. Keeping them out of
  // `Player.Root` is what lets the tree below read byte-identical regardless
  // of which provider is switched on. Every remaining position ships a
  // stylesheet, so the import line is unconditional now: there is no third,
  // unstyled position that prints zero lines here.
  const preamble = [
    `import '@playdeck/react/${skin}.css';`,
    '',
    `const source = '${sourceUrl}';`,
    ''
  ];

  const controlLines = BENCH_CONTROLS.flatMap((name) => CONTROL_LINES[name]);

  return [
    ...preamble,
    '<Player.Root source={source}>',
    '  <Player.Viewport>',
    '    <Player.Media />',
    '    <Player.Poster>',
    '      <Player.PosterImage />',
    '    </Player.Poster>',
    '    <Player.Controls>',
    ...controlLines.map((line) => `      ${line}`),
    '    </Player.Controls>',
    '  </Player.Viewport>',
    '</Player.Root>'
  ].join('\n');
};
