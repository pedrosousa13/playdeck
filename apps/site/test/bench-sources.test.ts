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

  it('resolves the youtube entry to a Blender Foundation upload', () => {
    const youtube = benchSources.find((entry) => entry.provider === 'youtube');
    expect(youtube?.source('/')).toBe(
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
    );
  });

  it('resolves the vimeo entry to a Blender Foundation upload', () => {
    const vimeo = benchSources.find((entry) => entry.provider === 'vimeo');
    expect(vimeo?.source('/')).toBe('https://vimeo.com/1084537');
  });
});
