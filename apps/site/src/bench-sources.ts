/*
 * What each position of the source switch on `/` plays.
 *
 * The maintainer cannot serve video from this site, so every position here is
 * a hosted provider: `native` and `hls` are gone, along with `public/bunny.mp4`
 * and `public/hls/`. What is left is `HostedProvider`, every member of the
 * library's own `PlayerProvider` except those two -- and each of the three
 * still needs a clip this project is entitled to embed on a marketing page,
 * which is why `youtube` and `vimeo` point at Blender Studio's own uploads
 * rather than a copy this project made. See the notes on each entry below for
 * how its id was verified. `wistia` has no such upload and no account behind
 * it, so it stays `ready: false` until one exists. Turning one on is still
 * this file's three-character change.
 *
 * `youtube` is listed first, which is what makes it the switch's default
 * position -- `BenchIsland.tsx` reads `readySources[0]` for its initial
 * state, and `Bench.astro` reads `benchSources.find((entry) => entry.ready)`
 * for the same fact on the no-JavaScript path.
 *
 * ---- one film, both positions -----------------------------------------------
 *
 * Both `youtube` and `vimeo` play _Sprite Fright_ (2021). That was not a given
 * -- an earlier pass through this file assumed Blender's own Vimeo account
 * held only its two oldest films and put _Big Buck Bunny_ on `vimeo` instead,
 * because that was the one film verified as an official upload on both
 * accounts checked at the time. That was wrong: Blender runs two Vimeo
 * accounts, `yourown3dsoftware` (the 2008-era Foundation account, which does
 * only hold the old films) and `blenderstudio` (the Studio-era account, which
 * holds _Sprite Fright_). `vimeo.com/640499893` is on the second one --
 * verified the same way as `youtube` below -- so there was never a reason for
 * the two positions to disagree.
 *
 * ---- why every per-source fact is one object, not three lookups ------------
 *
 * `Bench.astro` used to override the source alone and leave the poster
 * pointed at the previous film -- a still from one clip over a video of
 * another, on the page whose argument is that nothing here claims what it
 * cannot show. `DESIGN.md` records that failure under the heading about the
 * `media` prop `/archetypes`' compositions still carry. The fix there was to
 * bundle the clip and the words describing it into one prop, so a surface
 * replacing one could not fail to replace the other.
 *
 * The same shape applies here, one level down: `BenchSource` carries the URL,
 * the poster, the intrinsic dimensions, the start time and the credit as one
 * object per provider, in `bySource` below. A provider added later that
 * supplies a `source` and forgets a `poster`, a `startTime` or a `credit`
 * does not compile -- `Record<HostedProvider, Omit<BenchSource, 'provider'>>`
 * requires every field of every entry, the same exhaustiveness this file
 * already used to keep `HostedProvider` and this object in sync. Three
 * separate `Record<HostedProvider, …>` lookups -- one for URLs, one for
 * posters, one for credits -- would let an author fill in two and never
 * notice the third was still pointing at the old film; nothing would fail to
 * compile, only the page would fail to be true.
 *
 * Both entries point at the same film today, which makes the bundling look
 * unnecessary until the day a second film is added -- exactly the day a
 * lookup keyed by provider stops being able to tell the two apart.
 */
import type { PlayerProvider } from '@playdeck/core';

/** Every provider this page's switch can offer -- everything hosted. */
type HostedProvider = Exclude<PlayerProvider, 'native' | 'hls'>;

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
 * The still the dormant player shows, at the two widths this file ships:
 * 1024w for a phone or a narrow viewport, 2048w -- the film's own native
 * width -- for the frame this poster fills on a wide or a high-density
 * display. `src` is the 1024w file, for a consumer of `<img>` that reads only
 * one address; `srcSet` is both, so a browser that can act on it picks the
 * one that actually matches what it is rendering rather than every reader
 * downloading the desktop-and-retina file regardless of screen.
 *
 * Both widths are exact integer divisions of the film's own 2048x858 --
 * 2048x858 itself and 1024x429 -- so neither is a scaler's rounding of the
 * ratio the way a poster forced to 16:9 was.
 */
export type BenchPoster = {
  readonly src: string;
  readonly srcSet: string;
};

export type BenchSource = {
  readonly provider: HostedProvider;
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
   * The film's real pixel dimensions -- not a rounded aspect ratio. `2048 /
   * 858` in CSS computes the same ratio the two integers describe with no
   * decimal in between, so nothing here approximates a number a browser can
   * compute exactly. `.bench__stage` in `Bench.astro` and the poster's own
   * pixel dimensions both derive from this pair, which is what keeps the
   * frame the same shape as the picture in it whichever position is
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
   * appear to begin a minute in for no reason a reader could see.
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
// is keyed by surface: a `Record<HostedProvider, ...>` object literal is
// exhaustive under TypeScript's excess-property checking, so `HostedProvider`
// gaining or losing a member is a compile error here rather than a switch that
// quietly drops or never shows a position -- and because every field of
// `BenchSource` is required, so is a member losing a poster, a start time or a
// credit while it keeps its source.
const bySource: Record<HostedProvider, Omit<BenchSource, 'provider'>> = {
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
  Object.keys(bySource) as HostedProvider[]
).map((provider) => ({ provider, ...bySource[provider] }));

export const readySources = benchSources.filter((entry) => entry.ready);
