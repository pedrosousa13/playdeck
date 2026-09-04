/*
 * What each position of the source switch on `/` plays.
 *
 * `native` is still gone: there is no raw progressive file for this project to
 * point a plain `<video>` at, and none of the work below adds one. `hls` is
 * back, and it is not a hosted provider in the sense the other three are --
 * `scripts/media-sprite-fright.mjs` cuts a same-origin clip from Blender
 * Studio's own official upload and writes it into
 * `apps/site/public/media/sprite-fright/`, which Astro copies into the build
 * the Worker serves like any other file under `public/`. So this switch now
 * offers one self-hosted position and three third-party ones, every member of
 * the library's own `PlayerProvider` except `native` -- and each of the three
 * hosted entries still needs a clip this project is entitled to embed on a
 * marketing page, which is why `youtube` and `vimeo` point at Blender Studio's
 * own uploads rather than a copy this project made. See the notes on each
 * entry below for how its id was verified. `wistia` has no such upload and no
 * account behind it, so it stays `ready: false` until one exists. Turning one
 * on is still this file's three-character change.
 *
 * `hls` is listed first, which is what makes it the switch's default
 * position -- `BenchIsland.tsx` reads `readySources[0]` for its initial
 * state, and `Bench.astro` reads `benchSources.find((entry) => entry.ready)`
 * for the same fact on the no-JavaScript path. It earns the position on the
 * page's own terms, not just alphabetically: `bench-quiet.ts` reports a
 * same-origin load as "no third party has been contacted", so the switch now
 * rests on the position that makes the page's central claim easiest to
 * believe -- nothing leaves `playdeck.video` until a reader presses play, and
 * the segments the press fetches are this site's own.
 *
 * ---- one film, four positions -----------------------------------------------
 *
 * Every position plays _Sprite Fright_ (2021). `youtube` and `vimeo` play
 * Blender Studio's own uploads to their respective accounts (see each entry's
 * own note for how that was verified); `hls` plays a clip cut from Blender's
 * own `video.blender.org` release of the same film -- a different official
 * source from the one the `youtube`/`vimeo` poster was cut from, which is why
 * its declared `width`/`height` differ from theirs rather than matching by
 * coincidence. `scripts/media-sprite-fright.mjs` records the exact source URL,
 * its size and the licence evidence for that release.
 *
 * ---- why every per-source fact is one object, not three lookups ------------
 *
 * `Bench.astro` used to override the source alone and leave the poster
 * pointed at the previous film -- a still from one clip over a video of
 * another, on the page whose argument is that nothing here claims what it
 * cannot show. `DESIGN.md` records that failure under the heading about the
 * `media` prop `/examples`' compositions still carry. The fix there was to
 * bundle the clip and the words describing it into one prop, so a surface
 * replacing one could not fail to replace the other.
 *
 * The same shape applies here, one level down: `BenchSource` carries the URL,
 * the poster, the intrinsic dimensions, the start time and the credit as one
 * object per provider, in `bySource` below. A provider added later that
 * supplies a `source` and forgets a `poster`, a `startTime` or a `credit`
 * does not compile -- `Record<BenchProvider, Omit<BenchSource, 'provider'>>`
 * requires every field of every entry, the same exhaustiveness this file
 * already used to keep `BenchProvider` and this object in sync. Three
 * separate `Record<BenchProvider, …>` lookups -- one for URLs, one for
 * posters, one for credits -- would let an author fill in two and never
 * notice the third was still pointing at the old film; nothing would fail to
 * compile, only the page would fail to be true.
 *
 * Every entry points at the same film today, which makes the bundling look
 * unnecessary until the day a second film is added -- exactly the day a
 * lookup keyed by provider stops being able to tell the entries apart.
 */
import type { PlayerProvider, PlayerSource } from '@playdeck/core';

/**
 * Every provider this page's switch can offer. `native` is the one member of
 * `PlayerProvider` excluded: there is still no raw progressive file this
 * project ships, same-origin or otherwise, for a plain `<video>` to point at.
 * `hls` is not excluded -- it is a real entry below, same-origin rather than
 * hosted, which is why this type is no longer named `HostedProvider`: that
 * name was accurate while every entry left this origin, and would now be
 * describing the one entry that does not.
 */
type BenchProvider = Exclude<PlayerProvider, 'native'>;

/**
 * The CC BY attribution a provider's clip is owed, wherever it plays --
 * including the `<noscript>` fallback. Every field is required for the same
 * reason every field of `BenchSource` is: a credit missing its licence link,
 * or naming the wrong rightsholder, is not a smaller defect than a missing
 * poster, so it does not get an easier type to satisfy.
 */
export type BenchCredit = {
  /** The film's title, in the credit's `<em>`. */
  readonly title: string;
  /** The rightsholder CC BY asks the credit to name. */
  readonly holder: string;
  /** What the licence link prints, e.g. `CC BY 4.0`. */
  readonly licenceLabel: string;
  /** Where the licence link points. */
  readonly licenceUrl: string;
};

/**
 * The still the dormant player shows. `src` is the narrower file, for a
 * consumer of `<img>` that reads only one address; `srcSet` carries both
 * widths this entry ships, so a browser that can act on it picks the one that
 * actually matches what it is rendering rather than every reader downloading
 * the desktop-and-retina file regardless of screen.
 *
 * Every entry's pair of widths are exact integer divisions of that entry's
 * own frame -- see `hls`'s and `youtube`'s notes below for the two pairs this
 * file ships today -- so neither file is a scaler's rounding of the ratio the
 * way a poster forced to 16:9 was.
 */
export type BenchPoster = {
  readonly src: string;
  readonly srcSet: string;
};

export type BenchSource = {
  readonly provider: BenchProvider;
  /** What the switch prints on the button. */
  readonly label: string;
  /** False while this provider has no clip we may embed. */
  readonly ready: boolean;
  /** Resolved at call time, because BASE_URL is only known there. */
  readonly source: (baseUrl: string) => string;
  /**
   * The still the dormant player shows for this position, resolved against
   * the site's base path the same way `source` is. Always this film's own
   * frame: `Bench.astro` and `BenchIsland.tsx` both read this rather than a
   * page-wide constant, which is what makes a poster/source mismatch a defect
   * this type cannot express instead of one an editor has to remember to
   * avoid.
   */
  readonly poster: (baseUrl: string) => BenchPoster;
  /**
   * The film's real pixel dimensions for this entry's own clip -- not a
   * rounded aspect ratio, and not assumed to match every other entry's.
   * `width / height` in CSS computes the same ratio the two integers describe
   * with no decimal in between, so nothing here approximates a number a
   * browser can compute exactly. `.bench__stage` in `Bench.astro` and the
   * poster's own pixel dimensions both derive from this pair, which is what
   * keeps the frame the same shape as the picture in it whichever position is
   * selected -- a 2.39:1 film in a 16:9 box is the same class of mismatch as
   * a poster from one film over a video of another, just measured in
   * letterboxing rather than in a wrong title.
   */
  readonly width: number;
  readonly height: number;
  /**
   * Where playback starts, in seconds. `0` for every entry today: a press
   * plays the film from its own beginning, the way every hosted embed on the
   * web does, rather than promising the moment `poster` happens to show. An
   * earlier version of this field pinned it to the second `poster` was cut
   * from, on the reasoning that the still and the first played frame should
   * be the same instant -- worth doing when this repository cut its own
   * poster from its own clip, and not worth asking of a film that would then
   * appear to begin a minute in for no reason a reader could see. `hls`
   * plays a clip cut to start at that scene already (`CLIP_START_SECONDS` in
   * `scripts/media-sprite-fright.mjs`), so the same reasoning keeps it at `0`
   * rather than asking it of this entry alone.
   */
  readonly startTime: number;
  /** The attribution this film's clip is owed. */
  readonly credit: BenchCredit;
};

const SPRITE_FRIGHT_CREDIT: BenchCredit = {
  title: 'Sprite Fright',
  holder: 'Blender Studio',
  licenceLabel: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
};

// Keyed by provider, the way `REFUSED_URL_NOTICES` in packages/core/src/safety.ts
// is keyed by surface: a `Record<BenchProvider, ...>` object literal is
// exhaustive under TypeScript's excess-property checking, so `BenchProvider`
// gaining or losing a member is a compile error here rather than a switch that
// quietly drops or never shows a position -- and because every field of
// `BenchSource` is required, so is a member losing a poster, a start time or a
// credit while it keeps its source.
//
// `hls` is written first, which is what makes it the switch's default --
// `Object.keys` preserves a string-keyed object literal's insertion order, and
// `benchSources` below is built by mapping over exactly that order.
const bySource: Record<BenchProvider, Omit<BenchSource, 'provider'>> = {
  // Same-origin. `scripts/media-sprite-fright.mjs` downloads Blender Studio's
  // own `video.blender.org` release of _Sprite Fright_ -- the script's own
  // header carries the exact source URL, its size and the licence evidence --
  // and cuts a 90-second clip into an HLS ladder under
  // `apps/site/public/media/sprite-fright/`, which Astro copies into the site
  // build like any other file under `public/`. Nothing here is fetched before
  // a press: the manifest address below is a `<source>` string like every
  // other entry's, not a preload.
  hls: {
    label: 'hls',
    ready: true,
    source: (baseUrl) => `${baseUrl}media/sprite-fright/master.m3u8`,
    poster: (baseUrl) => ({
      src: `${baseUrl}sprite-fright-hls-poster-960w.webp`,
      srcSet: `${baseUrl}sprite-fright-hls-poster-960w.webp 960w, ${baseUrl}sprite-fright-hls-poster-1920w.webp 1920w`
    }),
    // The clip's own encoded frame size -- not the 2048x858 the
    // Wikimedia-cut stills for `youtube`/`vimeo` below carry. Blender's
    // `video.blender.org` release is itself 1920x804, and every rendition
    // `scripts/media-sprite-fright.mjs` encodes and both poster widths below
    // are exact integer divisions of that pair (1x, 1.5x and 3x for the
    // ladder; 1x and its exact half, 960x402, for the poster) rather than a
    // re-crop to the other release's dimensions.
    width: 1920,
    height: 804,
    startTime: 0,
    credit: SPRITE_FRIGHT_CREDIT
  },
  // The Blender Studio channel's own upload of _Sprite Fright_ (2021),
  // verified through YouTube's `oembed` endpoint:
  // `title: "Sprite Fright - Blender Open Movie"`,
  // `author_name: "Blender Studio"`, `author_url: ".../@BlenderStudio"`.
  youtube: {
    label: 'youtube',
    ready: true,
    source: () => 'https://www.youtube.com/watch?v=_cMxraX_5RE',
    poster: (baseUrl) => ({
      src: `${baseUrl}sprite-fright-poster-1024w.webp`,
      srcSet: `${baseUrl}sprite-fright-poster-1024w.webp 1024w, ${baseUrl}sprite-fright-poster-2048w.webp 2048w`
    }),
    width: 2048,
    height: 858,
    // A character mid-scene in the forest -- not the title card, not a fade,
    // not one of the film's darker night shots -- cut from Wikimedia
    // Commons' mirror of the same official Blender Studio release (CC BY
    // 4.0, `commons.wikimedia.org/wiki/File:Sprite_Fright_-_Open_Movie_by_Blender_Studio.webm`),
    // fetched by range request rather than in full.
    // `apps/site/public/sprite-fright-poster-1024w.webp`,
    // `apps/site/public/sprite-fright-poster-2048w.webp` and `DESIGN.md` carry
    // the exact commands.
    startTime: 0,
    credit: SPRITE_FRIGHT_CREDIT
  },
  // The Blender Studio channel's own upload of the same film, verified the
  // same way: Vimeo's `oembed` endpoint reports
  // `title: "Sprite Fright - Blender Open Movie"`,
  // `author_name: "Blender Studio"`, `author_url: "vimeo.com/blenderstudio"`.
  // That account is the Studio-era one and is distinct from
  // `vimeo.com/yourown3dsoftware`, the 2008-era Foundation account that
  // uploaded _Big Buck Bunny_ and _Elephants Dream_ and holds nothing newer
  // -- which is why this position plays the same film as `youtube` rather
  // than a different one.
  vimeo: {
    label: 'vimeo',
    ready: true,
    source: () => 'https://vimeo.com/640499893',
    poster: (baseUrl) => ({
      src: `${baseUrl}sprite-fright-poster-1024w.webp`,
      srcSet: `${baseUrl}sprite-fright-poster-1024w.webp 1024w, ${baseUrl}sprite-fright-poster-2048w.webp 2048w`
    }),
    width: 2048,
    height: 858,
    startTime: 0,
    credit: SPRITE_FRIGHT_CREDIT
  },
  // No Blender upload turned up and no account exists to hold one. Off until
  // one does. The poster, dimensions, start time and credit are still real
  // values rather than placeholders -- `ready: false` is what keeps this
  // position off the switch, not an incomplete entry -- so turning it on
  // needs no more than the `source` and `ready` fields to change.
  wistia: {
    label: 'wistia',
    ready: false,
    source: () => 'https://fast.wistia.net/embed/iframe/REPLACE_ME',
    poster: (baseUrl) => ({
      src: `${baseUrl}sprite-fright-poster-1024w.webp`,
      srcSet: `${baseUrl}sprite-fright-poster-1024w.webp 1024w, ${baseUrl}sprite-fright-poster-2048w.webp 2048w`
    }),
    width: 2048,
    height: 858,
    startTime: 0,
    credit: SPRITE_FRIGHT_CREDIT
  }
};

export const benchSources: readonly BenchSource[] = (
  Object.keys(bySource) as BenchProvider[]
).map((provider) => ({ provider, ...bySource[provider] }));

export const readySources = benchSources.filter((entry) => entry.ready);

/**
 * What `Player.Root`'s `source` prop actually receives for one entry, once
 * `baseUrl` is known.
 *
 * Every position but `hls` is `entry.source(baseUrl)` verbatim: a plain URL
 * is the whole of what `detectSource` needs to find a provider on its own.
 * `hls` differs, and deliberately: this bench exists to demonstrate quality
 * selection, and Chromium's `canPlayType('application/vnd.apple.mpegurl')`
 * answers `'maybe'`, which sends the automatic engine pick to the native
 * decoder -- where `selectQuality` is unavailable and `state.qualities` stays
 * empty (`packages/provider-hls/src/index.ts`'s `selectHlsEngine`). The
 * quality picker and the stats readout merged in #618 would therefore show
 * nothing on this position in Chrome, on the one page whose job is to
 * demonstrate them. So this position's own source pins `engine: 'hls.js'` on
 * an explicit source object -- the shape `docs/provider-setup.md`'s
 * "Explicit source objects" table documents -- rather than trusting the
 * per-browser automatic pick every other position is happy to leave alone.
 *
 * `entry.source(baseUrl)` is still called for the `hls` case, once, for its
 * `src` field: that function stays the one place this file computes the raw
 * URL, used elsewhere for the no-JavaScript fallback's `href` and for the
 * quiet line's own record of what loaded, both of which need a URL and never
 * an engine.
 */
export const resolvePlayerSource = (
  entry: BenchSource,
  baseUrl: string
): PlayerSource =>
  entry.provider === 'hls'
    ? { type: 'hls', src: entry.source(baseUrl), engine: 'hls.js' }
    : entry.source(baseUrl);
