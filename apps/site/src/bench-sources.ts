/*
 * What each position of the source switch on `/` plays.
 *
 * `native` and `hls` are served by this site, so the bench can demonstrate two
 * providers without contacting anyone. The other three are hosted, and each
 * needs a clip this project is entitled to embed on a marketing page. Until
 * those exist, `ready: false` keeps the button off the switch rather than on
 * it and broken. Turning one on is this file's three-character change.
 *
 * The two local addresses resolve against `import.meta.env.BASE_URL`, the way
 * every address on this site does, because `astro build --base` has to keep
 * working (#435).
 */
import type { PlayerProvider } from '@playdeck/core';

export type BenchSource = {
  readonly provider: PlayerProvider;
  /** What the switch prints on the button. */
  readonly label: string;
  /** False while this provider has no clip we may embed. */
  readonly ready: boolean;
  /** Resolved at call time, because BASE_URL is only known there. */
  readonly source: (baseUrl: string) => string;
};

// Keyed by provider, the way `REFUSED_URL_NOTICES` in packages/core/src/safety.ts
// is keyed by surface: a `Record<PlayerProvider, ...>` object literal is
// exhaustive under TypeScript's excess-property checking, so the union gaining
// or losing a member is a compile error here rather than a switch that quietly
// drops or never shows a position.
const bySource: Record<PlayerProvider, Omit<BenchSource, 'provider'>> = {
  native: {
    label: 'native',
    ready: true,
    source: (baseUrl) => `${baseUrl}tracer.mp4`
  },
  hls: {
    label: 'hls',
    ready: true,
    source: (baseUrl) => `${baseUrl}hls/master.m3u8`
  },
  // The three below wait on an upload. One Blender CC BY film goes on this
  // project's own YouTube, Vimeo and Wistia accounts, so all five providers
  // play the identical asset and a refusal the reason line reports is a fact
  // about the provider rather than about its clip. Replace the id and set
  // `ready`.
  youtube: {
    label: 'youtube',
    ready: false,
    source: () => 'https://www.youtube.com/watch?v=REPLACE_ME'
  },
  vimeo: {
    label: 'vimeo',
    ready: false,
    source: () => 'https://vimeo.com/REPLACE_ME'
  },
  wistia: {
    label: 'wistia',
    ready: false,
    source: () => 'https://fast.wistia.net/embed/iframe/REPLACE_ME'
  }
};

export const benchSources: readonly BenchSource[] = (
  Object.keys(bySource) as PlayerProvider[]
).map((provider) => ({ provider, ...bySource[provider] }));

export const readySources = benchSources.filter((entry) => entry.ready);
