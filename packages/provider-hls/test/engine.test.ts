// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';
import {
  detectHlsEnvironment,
  selectHlsEngine,
  type HlsModuleLoader
} from '../src/index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const environments = {
  native: { nativeHls: true, mse: false },
  mse: { nativeHls: false, mse: true },
  both: { nativeHls: true, mse: true },
  none: { nativeHls: false, mse: false }
} as const;

test('auto prefers the native engine where the browser plays HLS natively', () => {
  expect(selectHlsEngine('auto', environments.native)).toEqual({
    engine: 'native'
  });
  expect(selectHlsEngine('auto', environments.both)).toEqual({
    engine: 'native'
  });
});

test('auto falls back to hls.js where only MSE is supported', () => {
  expect(selectHlsEngine('auto', environments.mse)).toEqual({
    engine: 'hls.js'
  });
});

test('auto surfaces a normalized unsupported error without native HLS or MSE', () => {
  expect(selectHlsEngine('auto', environments.none)).toEqual({
    engine: null,
    error: {
      category: 'unsupported',
      fatal: true,
      recoverable: false,
      message:
        'HLS is unsupported in this browser: it has neither native HLS playback nor Media Source Extensions.'
    }
  });
});

test('a forced native engine fails clearly without native HLS support', () => {
  expect(selectHlsEngine('native', environments.native)).toEqual({
    engine: 'native'
  });
  expect(selectHlsEngine('native', environments.mse)).toEqual({
    engine: null,
    error: {
      category: 'unsupported',
      fatal: true,
      recoverable: false,
      message:
        'The forced "native" HLS engine is unavailable: this browser cannot play HLS natively.'
    }
  });
});

test('a forced hls.js engine fails clearly without MSE support', () => {
  expect(selectHlsEngine('hls.js', environments.both)).toEqual({
    engine: 'hls.js'
  });
  expect(selectHlsEngine('hls.js', environments.native)).toEqual({
    engine: null,
    error: {
      category: 'unsupported',
      fatal: true,
      recoverable: false,
      message:
        'The forced "hls.js" HLS engine is unavailable: this browser does not support Media Source Extensions.'
    }
  });
});

test('detects native HLS from canPlayType and MSE from MediaSource support', () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'canPlayType').mockImplementation((type) =>
    type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''
  );
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true });

  expect(detectHlsEnvironment(media)).toEqual({ nativeHls: true, mse: true });
});

test('detects an environment without native HLS or usable MSE', () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', undefined);

  expect(detectHlsEnvironment(media)).toEqual({ nativeHls: false, mse: false });
});

test('treats MSE without H.264 MP4 support as unusable', () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', { isTypeSupported: () => false });

  expect(detectHlsEnvironment(media)).toEqual({ nativeHls: false, mse: false });
});

test('detects MSE through ManagedMediaSource where only it exists', () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', undefined);
  vi.stubGlobal('ManagedMediaSource', { isTypeSupported: () => true });

  expect(detectHlsEnvironment(media)).toEqual({ nativeHls: false, mse: true });
});

// Type-level, not runtime: `loadHls: () => import('hls.js')` is the form this
// package's README documents, so a real hls.js module must satisfy
// `HlsModuleLoader` without a cast. It did not — `HlsInstanceLike.on` was a
// property-typed function, checked contravariantly, and hls.js's `on` only
// accepts its own event names. This assertion fails `pnpm typecheck` if that
// regresses.
type AssertAssignable<Target, Source extends Target> = Source;
export type RealHlsSatisfiesTheLoader = AssertAssignable<
  HlsModuleLoader,
  () => Promise<typeof import('hls.js')>
>;
