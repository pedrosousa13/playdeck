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
import type { HlsSource, PlayerProvider, PlayerSource } from '@playdeck/core';
import { BENCH_CONTROLS, type BenchControlName } from './bench-controls';

/**
 * Each control's printed source, one entry short of the lines it prints:
 * `timeDuration` carries the separator's line too, since the separator is
 * consumer text between the two `Player.Time`s rather than a control of its
 * own (see the spec's row-two contract). The settings menu now prints
 * `RateMenu`'s real children -- the quality group, the rate group and the
 * restart item, transcribed by hand from `examples/react-menus.tsx` rather
 * than generated from it, the same way every other line here is a reader's
 * eye on a component and not a build step's. A change to that fixture that
 * is not carried here is a panel that shows a menu the bench does not mount.
 *
 * Unconditional on `source`, deliberately: `RateMenu`'s own JSX never
 * branches on which provider is playing -- the group that vanishes for a
 * source with no ladder is a runtime decision inside the component, not a
 * different tree -- so printing it the same way for every position is what
 * keeps the "byte-identical across a provider change" claim the source-switch
 * test makes actually true.
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
    '  <Player.SettingsMenuTrigger aria-label="Settings" />',
    '  <Player.SettingsMenuContent>',
    '    <Player.MenuRadioGroup',
    '      aria-label="Quality"',
    "      value={selectedQualityId ?? ''}",
    '      onValueChange={selectQuality}',
    '    >',
    '      <Player.MenuRadioItem value="">Auto</Player.MenuRadioItem>',
    '      {qualities.map((quality) => (',
    '        <Player.MenuRadioItem key={quality.id} value={quality.id}>',
    '          {qualityLabel(quality)}',
    '        </Player.MenuRadioItem>',
    '      ))}',
    '    </Player.MenuRadioGroup>',
    '    <Player.MenuRadioGroup',
    '      value={String(rate)}',
    '      onValueChange={setPlaybackRate}',
    '    >',
    '      <Player.MenuRadioItem value="0.5">0.5×</Player.MenuRadioItem>',
    '      <Player.MenuRadioItem value="1">1×</Player.MenuRadioItem>',
    '      <Player.MenuRadioItem value="1.5">1.5×</Player.MenuRadioItem>',
    '      <Player.MenuRadioItem value="2">2×</Player.MenuRadioItem>',
    '    </Player.MenuRadioGroup>',
    '    <Player.MenuItem onSelect={restart}>Restart</Player.MenuItem>',
    '  </Player.SettingsMenuContent>',
    '</Player.SettingsMenu>'
  ],
  pipButton: ['<Player.PipButton />'],
  fullscreenButton: ['<Player.FullscreenButton />']
};

export type SkinName = 'theme' | 'docked';

export type BenchPosition = {
  readonly source: PlayerProvider;
  readonly skin: SkinName;
  // What `Player.Root`'s `source` prop actually receives for this position --
  // a plain URL for every position but `hls`, and an explicit source object
  // with its engine pinned for that one (see `bench-sources.ts`'s
  // `resolvePlayerSource`). Resolving a provider to it is not this module's
  // job -- it takes the value as a field so it stays pure and has no opinion
  // about where it came from -- but printing it honestly, whichever shape it
  // is, is exactly this module's job.
  readonly playerSource: PlayerSource;
};

/**
 * The right-hand side of the composition's `const source = …;` line, as the
 * literal a consumer would write. Every position but `hls` resolves to a
 * plain URL string, printed as a quoted one; `hls` resolves to an explicit
 * source object instead (`bench-sources.ts`'s `resolvePlayerSource`), so this
 * prints that object rather than quietly falling back to a URL the player is
 * not actually reading. The `throw` is not reachable from this bench today --
 * every entry in `bench-sources.ts` resolves to a string or an `hls` object --
 * and it is there so a position that resolved to a different object shape
 * later fails loudly here rather than printing something the page is not
 * doing.
 */
const printSourceValue = (value: PlayerSource): string => {
  if (typeof value === 'string') return `'${value}'`;
  if (value.type === 'hls') {
    const hls: HlsSource = value;
    return `{ type: 'hls', src: '${hls.src}', engine: '${hls.engine}' }`;
  }
  throw new Error(
    `bench-composition: no printer for a '${value.type}' source object.`
  );
};

export const buildComposition = ({
  skin,
  source,
  playerSource
}: BenchPosition): string => {
  // The composition never names a provider on `Player.Root`: the library
  // detects one from the URL, so `source={source}` is the whole of `Root`'s
  // own configuration regardless of which provider switched on. What changes
  // there is the `const` line above it. That is the claim the panel makes for
  // `Player.Root` -- and it is why there is one prop on it rather than a
  // list: with autoplay gone, nothing either switch does can add a second
  // one, so the branch that wrapped two or more props onto their own lines
  // went with it rather than sitting unreachable.
  //
  // `hls` is the one position whose `const source = …;` line is not a quoted
  // URL. This bench exists to demonstrate quality selection, and in Chromium
  // `canPlayType('application/vnd.apple.mpegurl')` answers `'maybe'`, which
  // sends the automatic engine pick `docs/provider-setup.md` documents to the
  // native decoder -- where `selectQuality` is unavailable and
  // `state.qualities` stays empty
  // (`packages/provider-hls/src/index.ts`'s `selectHlsEngine`). So this
  // position's own source pins `engine: 'hls.js'` on an explicit source
  // object (`bench-sources.ts`'s `resolvePlayerSource`), and
  // `printSourceValue` above prints that object rather than the string every
  // other position resolves to. It still needs no import of its own: the
  // object is a literal, not a type, so the real import this position needs
  // is the one every position needs: the skin's own stylesheet, printed
  // below. `packages/react/src/provider-loaders.ts` dynamically imports
  // `@playdeck/provider-hls` itself once `Player.Root` sees the `hls` type,
  // the same as every other provider here.
  //
  // `Player.Poster` is the one part below `Root` that does name a provider,
  // and only one: `showWhilePaused` prints for `youtube` alone, because that
  // is the one position whose embed draws its own chrome over an idle iframe
  // once nothing on this side covers it (`BenchIsland.tsx`'s `Stage` carries
  // the same condition on the real prop, and this line is the panel's report
  // of it, not a second decision).

  // The skin import and the source declaration are lines a consumer would
  // write above the composition, not props on it. Keeping them out of
  // `Player.Root` is what lets the tree below read byte-identical regardless
  // of which provider is switched on. Every remaining position ships a
  // stylesheet, so the import line is unconditional now: there is no third,
  // unstyled position that prints zero lines here.
  const preamble = [
    `import '@playdeck/react/${skin}.css';`,
    '',
    `const source = ${printSourceValue(playerSource)};`,
    ''
  ];

  const controlLines = BENCH_CONTROLS.flatMap((name) => CONTROL_LINES[name]);

  return [
    ...preamble,
    '<Player.Root source={source}>',
    '  <Player.Viewport>',
    '    <Player.Media />',
    source === 'youtube'
      ? '    <Player.Poster showWhilePaused>'
      : '    <Player.Poster>',
    '      <Player.PosterImage />',
    '    </Player.Poster>',
    '    <Player.Controls>',
    ...controlLines.map((line) => `      ${line}`),
    '    </Player.Controls>',
    '  </Player.Viewport>',
    '</Player.Root>'
  ].join('\n');
};
