/*
 * What each position of the source switch on `/` plays.
 *
 * The maintainer cannot serve video from this site, so every position here is
 * a hosted provider: `native` and `hls` are gone, along with `public/bunny.mp4`
 * and `public/hls/`. What is left is `HostedProvider`, every member of the
 * library's own `PlayerProvider` except those two -- and each of the three
 * still needs a clip this project is entitled to embed on a marketing page,
 * which is why `youtube` and `vimeo` point at the Blender Foundation's own
 * uploads of _Big Buck Bunny_ rather than a copy this project made. See
 * `Bench.astro` for how each id was verified. `wistia` has no such upload and
 * no account behind it, so it stays `ready: false` until one exists. Turning
 * one on is still this file's three-character change.
 *
 * `youtube` is listed first, which is what makes it the switch's default
 * position -- `BenchIsland.tsx` reads `benchSources[0]` for its initial state.
 */
import type { PlayerProvider } from '@playdeck/core';

/** Every provider this page's switch can offer -- everything hosted. */
type HostedProvider = Exclude<PlayerProvider, 'native' | 'hls'>;

export type BenchSource = {
  readonly provider: HostedProvider;
  /** What the switch prints on the button. */
  readonly label: string;
  /** False while this provider has no clip we may embed. */
  readonly ready: boolean;
  /** Resolved at call time, because BASE_URL is only known there. */
  readonly source: (baseUrl: string) => string;
};

// Keyed by provider, the way `REFUSED_URL_NOTICES` in packages/core/src/safety.ts
// is keyed by surface: a `Record<HostedProvider, ...>` object literal is
// exhaustive under TypeScript's excess-property checking, so `HostedProvider`
// gaining or losing a member is a compile error here rather than a switch that
// quietly drops or never shows a position.
const bySource: Record<HostedProvider, Omit<BenchSource, 'provider'>> = {
  // The Blender Foundation's own upload, verified through YouTube's `oembed`
  // endpoint: `author_name: "Blender"`, `author_url` ending `/@BlenderOfficial`.
  // It is a 4K 60fps encode rather than a lighter 1080p one -- no official
  // 1080p upload of the film turned up on that channel -- but it is the only
  // upload actually on it. Several look-alikes titled "Official Blender
  // Foundation Short Film" on other channels (Kids Tube, X-One-Kids, and
  // others) were checked the same way and rejected for not being it.
  youtube: {
    label: 'youtube',
    ready: true,
    source: () => 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
  },
  // The Blender Foundation's own upload, verified the same way: Vimeo's
  // `oembed` endpoint reports `author_name: "Blender"`, `author_url` ending
  // `/yourown3dsoftware` -- the same account that uploaded _Elephants Dream_
  // -- uploaded 2008-05-29, days after the film's release, its description
  // linking bigbuckbunny.org.
  vimeo: {
    label: 'vimeo',
    ready: true,
    source: () => 'https://vimeo.com/1084537'
  },
  // No Blender upload turned up and no account exists to hold one. Off until
  // one does.
  wistia: {
    label: 'wistia',
    ready: false,
    source: () => 'https://fast.wistia.net/embed/iframe/REPLACE_ME'
  }
};

export const benchSources: readonly BenchSource[] = (
  Object.keys(bySource) as HostedProvider[]
).map((provider) => ({ provider, ...bySource[provider] }));

export const readySources = benchSources.filter((entry) => entry.ready);
