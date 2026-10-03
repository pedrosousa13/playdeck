import { expect, test, vi } from 'vitest';
import {
  preconnectOriginsFor,
  warmProviderChunk
} from '../src/connection-warm-up';

// A plain module-scope `vi.fn()` would not survive `vi.mock`'s own hoisting
// above every import in this file -- `vi.hoisted` is what gives each mock
// factory below a reference it can actually close over, so calling it is
// what proves the factory ran, which is what proves the matching
// `import()` actually resolved rather than merely being asked to.
const evaluated = vi.hoisted(() => ({
  hls: vi.fn(),
  native: vi.fn(),
  vimeo: vi.fn(),
  wistia: vi.fn(),
  youtube: vi.fn()
}));

vi.mock('@playdeck/provider-hls', () => {
  evaluated.hls();
  return { createHlsProvider: vi.fn() };
});
vi.mock('@playdeck/provider-native', () => {
  evaluated.native();
  return { createNativeProvider: vi.fn() };
});
vi.mock('@playdeck/provider-youtube', () => {
  evaluated.youtube();
  return { createYouTubeProvider: vi.fn() };
});
vi.mock('@playdeck/provider-vimeo', () => {
  evaluated.vimeo();
  return { createVimeoProvider: vi.fn() };
});
vi.mock('@playdeck/provider-wistia', () => {
  evaluated.wistia();
  return { createWistiaProvider: vi.fn() };
});

test('youtube hints are exactly the script and embed origins when no poster is resolved', () => {
  expect(preconnectOriginsFor('youtube', false)).toEqual([
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com'
  ]);
});

// The poster CDN host is a further opt-in on top of `warmUp` itself --
// `Root`'s own `poster === 'provider'` -- so it only joins the hint list when
// that second argument is true, never merely because a YouTube source was
// detected.
test('youtube gains the poster origin only when a provider poster is resolved', () => {
  expect(preconnectOriginsFor('youtube', true)).toEqual([
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    'https://i.ytimg.com'
  ]);
});

test('vimeo hints are exactly the embed origin when no poster is resolved', () => {
  expect(preconnectOriginsFor('vimeo', false)).toEqual([
    'https://player.vimeo.com'
  ]);
});

test('vimeo gains the poster origin only when a provider poster is resolved', () => {
  expect(preconnectOriginsFor('vimeo', true)).toEqual([
    'https://player.vimeo.com',
    'https://i.vimeocdn.com'
  ]);
});

// Wistia's poster still shares a host already in its own base list (the same
// host `player.js` is fetched from), so resolving one adds nothing further --
// unlike YouTube's and Vimeo's own poster CDN hosts above.
test('wistia hints are exactly the script and CDN origins, whether or not a provider poster is resolved', () => {
  const withoutPoster = [
    'https://fast.wistia.net',
    'https://fast.wistia.com',
    'https://embed.wistia.com',
    'https://embed-ssl.wistia.com',
    'https://embed-fastly.wistia.com'
  ];
  expect(preconnectOriginsFor('wistia', false)).toEqual(withoutPoster);
  expect(preconnectOriginsFor('wistia', true)).toEqual(withoutPoster);
});

// HLS and native media have no fixed third-party origin -- the manifest or
// media host is the consumer's own -- so neither gets a hint, with or
// without a provider poster, the same empty answer a supplied or
// unrecognised kind gets below.
test('hls and native media get no hints, with or without a provider poster', () => {
  expect(preconnectOriginsFor('hls', false)).toEqual([]);
  expect(preconnectOriginsFor('hls', true)).toEqual([]);
  expect(preconnectOriginsFor('video', false)).toEqual([]);
  expect(preconnectOriginsFor('video', true)).toEqual([]);
});

test('a supplied or unrecognised kind gets no hints', () => {
  expect(preconnectOriginsFor('acme-video', false)).toEqual([]);
  expect(preconnectOriginsFor('acme-video', true)).toEqual([]);
  expect(preconnectOriginsFor('', false)).toEqual([]);
});

// Ordered ahead of the real-import test below, deliberately: every
// `evaluated.*` spy must still read unfired here, which only holds while
// nothing earlier in this file has actually imported a provider module yet.
test('warmProviderChunk is a no-op for a supplied kind or no detected source', async () => {
  expect(() => warmProviderChunk('acme-video')).not.toThrow();
  expect(() => warmProviderChunk(undefined)).not.toThrow();
  // A wrongly-fired `import()` is asynchronous, so asserting immediately
  // would pass whether or not one was kicked off -- this gives any pending
  // module evaluation a real chance to run before the negative assertions
  // below are trusted. A real delay, not a single `await Promise.resolve()`,
  // which only flushes one microtask and would still miss an import that
  // settles over more than one.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(evaluated.youtube).not.toHaveBeenCalled();
  expect(evaluated.vimeo).not.toHaveBeenCalled();
  expect(evaluated.wistia).not.toHaveBeenCalled();
  expect(evaluated.hls).not.toHaveBeenCalled();
  expect(evaluated.native).not.toHaveBeenCalled();
});

test('warmProviderChunk imports exactly the matching built-in provider module, once each', async () => {
  warmProviderChunk('youtube');
  warmProviderChunk('vimeo');
  warmProviderChunk('wistia');
  warmProviderChunk('hls');
  warmProviderChunk('video');

  await vi.waitFor(() => {
    expect(evaluated.youtube).toHaveBeenCalledOnce();
    expect(evaluated.vimeo).toHaveBeenCalledOnce();
    expect(evaluated.wistia).toHaveBeenCalledOnce();
    expect(evaluated.hls).toHaveBeenCalledOnce();
    expect(evaluated.native).toHaveBeenCalledOnce();
  });

  // The module system's own cache, not this function, is what makes a
  // repeat call free -- asked for again, nothing is evaluated a second time.
  warmProviderChunk('youtube');
  await Promise.resolve();
  expect(evaluated.youtube).toHaveBeenCalledOnce();
});
