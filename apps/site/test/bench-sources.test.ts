import { describe, expect, it } from 'vitest';
import { benchSources, readySources } from '../src/bench-sources';
import type { PlayerProvider } from '@playdeck/core';

// Written by hand, and typed against `PlayerProvider` rather than inferred as
// `string[]`, so a member removed from that union turns this line itself into
// a type error instead of silently passing a shorter list. `native` and `hls`
// are not in it: the maintainer cannot serve video from this site, so the
// switch is hosted providers only, and `bench-sources.ts`'s own
// `HostedProvider` type is what enforces that this list stays exactly the
// other three.
const HOSTED_PROVIDERS: PlayerProvider[] = ['youtube', 'vimeo', 'wistia'];

describe('benchSources', () => {
  it('has exactly one entry per hosted provider, and no extras', () => {
    expect(benchSources.map((entry) => entry.provider).sort()).toEqual(
      [...HOSTED_PROVIDERS].sort()
    );
  });

  it('marks only youtube and vimeo ready today', () => {
    expect(readySources.map((entry) => entry.provider).sort()).toEqual(
      ['vimeo', 'youtube'].sort()
    );
  });

  it('never lets a ready entry produce a placeholder URL', () => {
    for (const entry of readySources) {
      expect(entry.source('/')).not.toContain('REPLACE_ME');
    }
  });

  // Every ready source is a hosted provider now, so its URL is a real
  // cross-origin address rather than a same-origin path under `base` -- the
  // opposite of what this file asserted while `native` and `hls` were the
  // ready entries.
  it('resolves both ready entries to a cross-origin URL, not a same-origin path', () => {
    for (const entry of readySources) {
      const url = entry.source('/');
      expect(url.startsWith('https://')).toBe(true);
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

  // Both providers play the same film today, so every ready entry's poster is
  // the same asset -- which is the point being pinned here, rather than a
  // difference between them the way an earlier version of this file asserted.
  it('gives every ready entry the same poster', () => {
    const posters = readySources.map((entry) => entry.poster('/').src);
    expect(new Set(posters).size).toBe(1);
  });

  it("resolves the youtube entry's poster to the Sprite Fright still, at both widths", () => {
    const youtube = benchSources.find((entry) => entry.provider === 'youtube');
    expect(youtube?.poster('/')).toEqual({
      src: '/sprite-fright-poster-1024w.webp',
      srcSet:
        '/sprite-fright-poster-1024w.webp 1024w, /sprite-fright-poster-2048w.webp 2048w'
    });
  });

  // The film's real pixel dimensions, not a rounded aspect ratio -- every
  // entry's `width`/`height` should be exact integers a browser can compute
  // `width / height` from without any decimal in between.
  it('gives every entry the film’s exact intrinsic dimensions', () => {
    for (const entry of benchSources) {
      expect(entry.width).toBe(2048);
      expect(entry.height).toBe(858);
      expect(Number.isInteger(entry.width)).toBe(true);
      expect(Number.isInteger(entry.height)).toBe(true);
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
