import { describe, expect, it } from 'vitest';
import { benchSources, readySources } from '../src/bench-sources';
import type { PlayerProvider } from '@playdeck/core';

// Written by hand, and typed against `PlayerProvider` rather than inferred as
// `string[]`, so a member removed from that union turns this line itself into
// a type error instead of silently passing a shorter list. `native` is the
// one member left out: there is still no raw progressive file this project
// ships for a plain `<video>` to point at, and `bench-sources.ts`'s own
// `BenchProvider` type is what enforces that this list stays exactly the
// other four.
const BENCH_PROVIDERS: PlayerProvider[] = ['hls', 'youtube', 'vimeo', 'wistia'];

describe('benchSources', () => {
  it('has exactly one entry per bench provider, and no extras', () => {
    expect(benchSources.map((entry) => entry.provider).sort()).toEqual(
      [...BENCH_PROVIDERS].sort()
    );
  });

  it('marks hls, youtube and vimeo ready today', () => {
    expect(readySources.map((entry) => entry.provider).sort()).toEqual(
      ['hls', 'vimeo', 'youtube'].sort()
    );
  });

  it('lists hls first, which is what makes it the switch’s default', () => {
    expect(benchSources[0]?.provider).toBe('hls');
    expect(readySources[0]?.provider).toBe('hls');
  });

  it('never lets a ready entry produce a placeholder URL', () => {
    for (const entry of readySources) {
      expect(entry.source('/')).not.toContain('REPLACE_ME');
    }
  });

  // `hls` resolves to a same-origin path under `base`; `youtube` and `vimeo`
  // are hosted providers and resolve to a real cross-origin address.
  it('resolves hls to a same-origin path, and youtube/vimeo to a cross-origin URL', () => {
    const hls = benchSources.find((entry) => entry.provider === 'hls');
    expect(hls?.source('/')).toBe('/media/sprite-fright/master.m3u8');

    for (const entry of readySources.filter(
      (candidate) => candidate.provider !== 'hls'
    )) {
      expect(entry.source('/').startsWith('https://')).toBe(true);
    }
  });

  it('resolves the youtube entry to the Blender Studio upload of Sprite Fright', () => {
    const youtube = benchSources.find((entry) => entry.provider === 'youtube');
    expect(youtube?.source('/')).toBe(
      'https://www.youtube.com/watch?v=_cMxraX_5RE'
    );
  });

  it('resolves the vimeo entry to the Blender Studio upload of Sprite Fright', () => {
    const vimeo = benchSources.find((entry) => entry.provider === 'vimeo');
    expect(vimeo?.source('/')).toBe('https://vimeo.com/640499893');
  });

  // `youtube` and `vimeo` share the still cut from Wikimedia's mirror; `hls`
  // carries its own, cut from the clip `scripts/media-sprite-fright.mjs`
  // itself produces, at that script's own frame size rather than the other
  // release's.
  it('gives hls its own poster, distinct from the shared youtube/vimeo one', () => {
    const hostedPosters = readySources
      .filter((entry) => entry.provider !== 'hls')
      .map((entry) => entry.poster('/').src);
    expect(new Set(hostedPosters).size).toBe(1);

    const hls = benchSources.find((entry) => entry.provider === 'hls');
    expect(hls?.poster('/')).toEqual({
      src: '/sprite-fright-hls-poster-960w.webp',
      srcSet:
        '/sprite-fright-hls-poster-960w.webp 960w, /sprite-fright-hls-poster-1920w.webp 1920w'
    });
    expect(hostedPosters).not.toContain(hls?.poster('/').src);
  });

  it("resolves the youtube entry's poster to the Sprite Fright still, at both widths", () => {
    const youtube = benchSources.find((entry) => entry.provider === 'youtube');
    expect(youtube?.poster('/')).toEqual({
      src: '/sprite-fright-poster-1024w.webp',
      srcSet:
        '/sprite-fright-poster-1024w.webp 1024w, /sprite-fright-poster-2048w.webp 2048w'
    });
  });

  // Every entry's own pixel dimensions, not a rounded aspect ratio -- and
  // `hls`'s do not have to match the other entries', because it is cut from a
  // different official release of the same film. Every entry's own pair
  // still has to be exact integers a browser can compute `width / height`
  // from without any decimal in between.
  it('gives every entry its own exact intrinsic dimensions', () => {
    for (const entry of benchSources) {
      expect(Number.isInteger(entry.width)).toBe(true);
      expect(Number.isInteger(entry.height)).toBe(true);
    }

    const hls = benchSources.find((entry) => entry.provider === 'hls');
    expect(hls).toMatchObject({ width: 1920, height: 804 });

    for (const entry of benchSources.filter(
      (candidate) => candidate.provider !== 'hls'
    )) {
      expect(entry.width).toBe(2048);
      expect(entry.height).toBe(858);
    }
  });

  // Every entry's credit names the same film, holder and licence, since every
  // entry plays the same film -- a hardcoded credit would happen to be right
  // today, which is exactly why this bundles the credit with the source
  // rather than writing it once: the day a second film joins this file, only
  // an entry that is wrong stays wrong silently.
  it('credits Sprite Fright to Blender Studio under CC BY 4.0 on every entry', () => {
    for (const entry of benchSources) {
      expect(entry.credit).toEqual({
        title: 'Sprite Fright',
        holder: 'Blender Studio',
        licenceLabel: 'CC BY 4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
      });
    }
  });

  // Every entry, ready or not, carries a real start time -- `bySource`'s
  // object type requires the field on every member, so this is really a check
  // that nobody weakened the type to make it optional.
  it('gives every entry a start time', () => {
    for (const entry of benchSources) {
      expect(typeof entry.startTime).toBe('number');
    }
  });
});
