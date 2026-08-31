import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { benchSources, readySources } from '../src/bench-sources';
import type { PlayerProvider } from '@playdeck/core';

// Written by hand, and typed against `PlayerProvider` rather than inferred as
// `string[]`, so a member removed from that union turns this line itself into
// a type error instead of silently passing a shorter list.
const ALL_PROVIDERS: PlayerProvider[] = [
  'native',
  'hls',
  'youtube',
  'vimeo',
  'wistia'
];

// vitest.config.ts's `root` is the repo root, so `process.cwd()` at test time
// is that root rather than this file's own directory (and happy-dom's global
// `URL` resolves a relative `import.meta.url` against `http://localhost/`
// instead of the file, which is the wrong base to use here).
const publicDir = join(process.cwd(), 'apps/site/public');

describe('benchSources', () => {
  it('has exactly one entry per PlayerProvider, and no extras', () => {
    expect(benchSources.map((entry) => entry.provider).sort()).toEqual(
      [...ALL_PROVIDERS].sort()
    );
  });

  it('marks only native and hls ready today', () => {
    expect(readySources.map((entry) => entry.provider).sort()).toEqual(
      ['hls', 'native'].sort()
    );
  });

  it('never lets a ready entry produce a placeholder URL', () => {
    for (const entry of readySources) {
      expect(entry.source('/')).not.toContain('REPLACE_ME');
    }
  });

  it.each(['/', '/playdeck/'])(
    'resolves both ready entries to a same-origin path under the given base (base %s)',
    (base) => {
      for (const entry of readySources) {
        const url = entry.source(base);
        expect(url.startsWith(base)).toBe(true);
        expect(url.startsWith('http://')).toBe(false);
        expect(url.startsWith('https://')).toBe(false);
        expect(url.startsWith('//')).toBe(false);
      }
    }
  );

  it('resolves both ready entries to a fixture that actually exists in public/', () => {
    for (const entry of readySources) {
      const relativePath = entry.source('/').slice('/'.length);
      expect(existsSync(join(publicDir, relativePath))).toBe(true);
    }
  });
});
