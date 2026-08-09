// @vitest-environment node

import { expect, test } from 'vitest';
import {
  PlayerController,
  createInitialPlayerState,
  detectSource,
  isPermittedSourceUrl,
  type HlsSource,
  type ProviderStateListener,
  type VideoFileSource,
  type VimeoSource,
  type WistiaSource,
  type YouTubeSource
} from '../src/index';

const expectDetected = (input: unknown) => {
  const result = detectSource(input);
  expect(result.status).toBe('success');
  if (result.status === 'failure') throw new Error(result.guidance);
  expect(result.input).toBe(input);
  return result;
};

test('detects MP4 and WebM strings as video sources', () => {
  expect(expectDetected('/media/tracer.mp4?download=1#start').source).toEqual({
    type: 'video',
    sources: [
      { src: '/media/tracer.mp4?download=1#start', mimeType: 'video/mp4' }
    ]
  });
  expect(
    expectDetected('https://cdn.example.com/clip.webm#preview').source
  ).toEqual({
    type: 'video',
    sources: [
      {
        src: 'https://cdn.example.com/clip.webm#preview',
        mimeType: 'video/webm'
      }
    ]
  });
});

test('detects M3U8 strings as HLS sources', () => {
  expect(
    expectDetected('https://cdn.example.com/master.m3u8?token=abc#chapter')
      .source
  ).toEqual({
    type: 'hls',
    src: 'https://cdn.example.com/master.m3u8?token=abc#chapter'
  });
});

test.each([
  ['watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['bare-host watch', 'https://youtube.com/watch?v=dQw4w9WgXcQ'],
  ['mobile watch', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['music watch', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['short URL', 'https://youtu.be/dQw4w9WgXcQ'],
  ['embed', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ['shorts', 'https://www.youtube.com/shorts/dQw4w9WgXcQ']
])('detects YouTube %s URLs', (_form, input) => {
  expect(expectDetected(input).source).toEqual({
    type: 'youtube',
    videoId: 'dQw4w9WgXcQ'
  });
});

test.each([
  ['canonical', 'https://vimeo.com/123456789', undefined],
  ['player', 'https://player.vimeo.com/video/123456789', undefined],
  ['path hash', 'https://player.vimeo.com/video/123456789/a1b2c3', 'a1b2c3'],
  ['query hash', 'https://vimeo.com/123456789?h=a1b2c3', 'a1b2c3']
])('detects Vimeo %s URLs', (_form, input, hash) => {
  expect(expectDetected(input).source).toEqual({
    type: 'vimeo',
    videoId: '123456789',
    ...(hash ? { hash } : {})
  });
});

test('uses the query Vimeo privacy hash when both supported hash forms are present', () => {
  expect(
    expectDetected(
      'https://player.vimeo.com/video/123456789/pathhash?h=queryhash'
    ).source
  ).toEqual({ type: 'vimeo', videoId: '123456789', hash: 'queryhash' });
});

test.each([
  ['account media page', 'https://wesleyluyten.wistia.com/medias/oifkgmxnkb'],
  ['account embed', 'https://wesleyluyten.wistia.com/embed/medias/oifkgmxnkb'],
  ['embed iframe', 'https://fast.wistia.net/embed/iframe/oifkgmxnkb'],
  ['embed iframe, alt host', 'https://fast.wistia.com/embed/iframe/oifkgmxnkb']
])('detects Wistia %s URLs', (_form, input) => {
  expect(expectDetected(input).source).toEqual({
    type: 'wistia',
    mediaId: 'oifkgmxnkb'
  });
});

test('resolves a bare Wistia host the same as its subdomains', () => {
  expect(expectDetected('https://wistia.com/medias/oifkgmxnkb').source).toEqual(
    { type: 'wistia', mediaId: 'oifkgmxnkb' }
  );
});

// Wistia is the one recognised host that also serves plain media files -- its
// HLS manifests and direct deliveries are the documented way to play without
// its player. Detecting the embed shapes must not take that away (#198).
test.each([
  [
    'HLS manifest',
    'https://fast.wistia.net/embed/medias/oifkgmxnkb.m3u8',
    { type: 'hls', src: 'https://fast.wistia.net/embed/medias/oifkgmxnkb.m3u8' }
  ],
  [
    'direct delivery',
    'https://embed-ssl.wistia.com/deliveries/oifkgmxnkb.mp4',
    {
      type: 'video',
      sources: [
        {
          src: 'https://embed-ssl.wistia.com/deliveries/oifkgmxnkb.mp4',
          mimeType: 'video/mp4'
        }
      ]
    }
  ]
])(
  'still resolves a Wistia-hosted %s by file extension',
  (_form, input, source) => {
    expect(expectDetected(input).source).toEqual(source);
  }
);

test('accepts and preserves every explicit source object', () => {
  const video: VideoFileSource = {
    type: 'video',
    sources: [
      { src: '/movie.webm', mimeType: 'video/webm' },
      { src: '/movie.mp4', mimeType: 'video/mp4' }
    ]
  };
  const hls: HlsSource = { type: 'hls', src: '/master.m3u8', engine: 'hls.js' };
  const youtube: YouTubeSource = { type: 'youtube', videoId: 'dQw4w9WgXcQ' };
  const vimeo: VimeoSource = {
    type: 'vimeo',
    videoId: '123456789',
    hash: 'a1b2c3'
  };
  const wistia: WistiaSource = { type: 'wistia', mediaId: 'oifkgmxnkb' };

  for (const input of [video, hls, youtube, vimeo, wistia]) {
    const result = expectDetected(input);
    expect(result.input).toBe(input);
    expect(result.source).toEqual(input);
  }
});

test.each([
  'https://cdn.example.com/video?signature=abc',
  'https://cdn.example.com/video',
  'https://example.com/movie.avi',
  'mailto:clip.mp4',
  'ftp://host/clip.mp4',
  'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
  'https://vimeo.com.evil/123456789',
  'https://notwistia.com/medias/oifkgmxnkb',
  'https://wistia.com.evil.test/medias/oifkgmxnkb'
])('rejects unsupported strings with explicit-object guidance: %s', (input) => {
  const result = detectSource(input);
  expect(result).toMatchObject({
    status: 'failure',
    input,
    reason: 'unsupported-string'
  });
  if (result.status === 'failure') {
    expect(result.guidance).toMatch(/explicit source object/i);
  }
});

test.each([
  '',
  'https://www.youtube.com/watch',
  'https://www.youtube.com/watch?v=',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=another',
  'https://www.youtube.com/embed/dQw4w9WgXcQ/ignored',
  'https://www.youtube.com/shorts/dQw4w9WgXcQ/ignored',
  'https://youtu.be/dQw4w9WgXcQ/ignored',
  'https://youtube.com//embed//abc123',
  'https://youtu.be//abc123',
  'https://www.youtube.com/embed/%zz',
  'https://player.vimeo.com/123456789',
  'https://vimeo.com/video/123456789',
  'https://vimeo.com/123456789/ignored',
  'https://vimeo.com//123456789',
  'https://player.vimeo.com/video/123456789/pathhash/ignored',
  'https://player.vimeo.com//video//123456789//privatehash',
  'https://player.vimeo.com/video/123456789/%zz',
  // The `h` query parameter is the one hash form a caller can put anything
  // into -- the path form is already constrained by the path pattern itself.
  'https://vimeo.com/123456789?h=not-a-hash',
  'https://vimeo.com/123456789?h=',
  'https://vimeo.com/123456789?h=a1b2c3&h=d4e5f6',
  // A recognised Wistia host with a path that matches none of the known
  // shapes fails outright rather than falling through to another provider.
  'https://fast.wistia.net/embed/iframe',
  'https://wesleyluyten.wistia.com/oifkgmxnkb',
  // A disallowed character in the id breaks the path pattern itself.
  'https://fast.wistia.net/embed/iframe/oif-gmxnkb',
  // The media-file fall-through above is not a way in for junk: an extension
  // Reely does not play leaves the recognised-host rule to fail it.
  'https://fast.wistia.net/embed/medias/oifkgmxnkb.avi'
])('rejects malformed provider strings: %s', (input) => {
  expect(detectSource(input)).toMatchObject({
    status: 'failure',
    input,
    reason: 'malformed-string'
  });
});

test.each([
  { type: 'video', sources: [] },
  { type: 'video', sources: [{ src: '', mimeType: 'video/mp4' }] },
  { type: 'hls', src: '', engine: 'native' },
  { type: 'hls', src: '/master.m3u8', engine: 'other' },
  { type: 'youtube', videoId: '' },
  { type: 'youtube', videoId: 'with space' },
  { type: 'youtube', videoId: ' abc123 ' },
  { type: 'youtube', videoId: '   ' },
  { type: 'vimeo', videoId: 'not-numeric' },
  { type: 'vimeo', videoId: ' 123 ' },
  { type: 'vimeo', videoId: '   ' },
  { type: 'vimeo', videoId: '123', hash: '' },
  { type: 'vimeo', videoId: '123', hash: '../x' },
  { type: 'vimeo', videoId: '123', hash: ' privatehash ' },
  { type: 'vimeo', videoId: '123', hash: '   ' },
  { type: 'wistia', mediaId: '' },
  { type: 'wistia', mediaId: ' oifkgmxnkb ' },
  { type: 'wistia', mediaId: 'oif-gmxnkb' }
])('rejects invalid explicit source objects: %o', (input) => {
  const result = detectSource(input);
  expect(result).toMatchObject({
    status: 'failure',
    input,
    reason: 'invalid-source'
  });
  if (result.status === 'failure') {
    expect(result.guidance).toMatch(/explicit source object/i);
  }
});

// The explicit object is the documented public source API, so its `src` values
// reach a media resource-load sink without a string ever being detected. They
// go through the same scheme allowlist the string path uses (#219).
test.each([
  [
    'javascript: among video sources',
    {
      type: 'video',
      sources: [{ src: 'javascript:alert(1)', mimeType: 'video/mp4' }]
    }
  ],
  [
    'data: among video sources',
    {
      type: 'video',
      sources: [
        {
          src: 'data:text/html,<script>alert(1)</script>',
          mimeType: 'video/mp4'
        }
      ]
    }
  ],
  [
    'one rejected scheme among several video sources',
    {
      type: 'video',
      sources: [
        { src: '/movie.webm', mimeType: 'video/webm' },
        { src: 'javascript:alert(1)', mimeType: 'video/mp4' }
      ]
    }
  ],
  ['file: as an HLS src', { type: 'hls', src: 'file:///etc/passwd' }],
  [
    'blob: as an HLS src',
    { type: 'hls', src: 'blob:https://example.com/9b2c-4f1a' }
  ]
])('rejects explicit source objects carrying %s', (_case, input) => {
  const result = detectSource(input);
  expect(result).toMatchObject({
    status: 'failure',
    input,
    reason: 'invalid-source'
  });
  if (result.status === 'failure') {
    expect(result.guidance).toMatch(/explicit source object/i);
  }
});

// `blob:` is how a consumer hands over an in-page object -- a `MediaSource` or
// a picked `File` -- which only the video element can read. HLS rejects it
// because its manifest loader fetches the URL itself (#219).
test('accepts a blob: src on an explicit video source', () => {
  const input: VideoFileSource = {
    type: 'video',
    sources: [
      { src: 'blob:https://example.com/9b2c-4f1a', mimeType: 'video/mp4' }
    ]
  };

  expect(expectDetected(input).source).toEqual(input);
});

test('permits blob: for a video source and rejects it everywhere else', () => {
  const blob = 'blob:https://example.com/9b2c-4f1a';

  expect(isPermittedSourceUrl(blob, 'video')).toBe(true);
  expect(isPermittedSourceUrl(blob, 'hls')).toBe(false);
  expect(isPermittedSourceUrl(blob, 'youtube')).toBe(false);
  expect(isPermittedSourceUrl(blob, undefined)).toBe(false);
});

// Protocol-relative normalisation is a property of the emitted `src`, not of
// the path the source arrived by: the object path resolves against `https:`
// exactly as the string path does, so no source escapes it (#219).
test('normalises a protocol-relative src on an explicit video source', () => {
  const input: VideoFileSource = {
    type: 'video',
    sources: [
      { src: '//cdn.example.com/v.mp4', mimeType: 'video/mp4' },
      { src: '/local.webm', mimeType: 'video/webm' }
    ]
  };

  const result = expectDetected(input);
  expect(result.source).toEqual({
    type: 'video',
    sources: [
      { src: 'https://cdn.example.com/v.mp4', mimeType: 'video/mp4' },
      { src: '/local.webm', mimeType: 'video/webm' }
    ]
  });
  // The copy is the emitted source only; `input` stays the caller's object.
  expect(result.input).toBe(input);
});

test('normalises a protocol-relative src on an explicit HLS source', () => {
  const input: HlsSource = {
    type: 'hls',
    src: '//cdn.example.com/m.m3u8',
    engine: 'hls.js'
  };

  const result = expectDetected(input);
  expect(result.source).toEqual({
    type: 'hls',
    src: 'https://cdn.example.com/m.m3u8',
    engine: 'hls.js'
  });
  expect(result.input).toBe(input);
});

// The WHATWG URL parser strips tab, line feed and carriage return before
// parsing, so a scheme split by one of them is not the scheme the allowlist
// reads. Any of the three, anywhere, is malformed (#219).
test.each([
  'java\tscript:alert(1)//x.mp4',
  'java\nscript:alert(1)//x.mp4',
  'java\rscript:alert(1)//x.mp4'
])('rejects strings split by whitespace the URL parser strips: %j', (input) => {
  expect(detectSource(input)).toMatchObject({
    status: 'failure',
    input,
    reason: 'malformed-string'
  });
});

test('keeps http: media URLs detecting alongside https:', () => {
  expect(expectDetected('http://cdn.example.com/clip.mp4').source).toEqual({
    type: 'video',
    sources: [{ src: 'http://cdn.example.com/clip.mp4', mimeType: 'video/mp4' }]
  });
});

test.each(['https://youtube.com/embed/id.mp4', 'https://vimeo.com/123.mp4'])(
  'does not detect malformed known-provider URLs as files: %s',
  (input) => {
    expect(detectSource(input)).toMatchObject({
      status: 'failure',
      input,
      reason: 'malformed-string'
    });
  }
);

test.each(['//youtube.com/embed/id.mp4', '//vimeo.com/123.m3u8'])(
  'applies known-provider grammar to network-path references: %s',
  (input) => {
    expect(detectSource(input)).toMatchObject({
      status: 'failure',
      input,
      reason: 'malformed-string'
    });
  }
);

// Detection resolves a network-path reference against `https:` to parse it,
// and the emitted `src` now carries that resolution rather than the caller's
// `//host/...` form -- so what plays is what was validated (#219).
test('detects a generic file on an unknown network-path host', () => {
  expect(expectDetected('//cdn.example.com/video.mp4').source).toEqual({
    type: 'video',
    sources: [
      { src: 'https://cdn.example.com/video.mp4', mimeType: 'video/mp4' }
    ]
  });
});

test('detects a valid provider network-path reference', () => {
  expect(expectDetected('//youtu.be/abc123').source).toEqual({
    type: 'youtube',
    videoId: 'abc123'
  });
});

test.each([
  'https://player.vimeo.com/video/not-a-number',
  'https://player.vimeo.com/video/123456789/%25',
  'https://www.youtube.com/shorts/%25'
])('rejects unusable provider IDs and hashes: %s', (input) => {
  const result = detectSource(input);
  expect(result).toMatchObject({
    status: 'failure',
    input,
    reason: 'malformed-string'
  });
});

test('continues to accept ordinary relative file paths', () => {
  expect(expectDetected('media/clip.mp4').source).toEqual({
    type: 'video',
    sources: [{ src: 'media/clip.mp4', mimeType: 'video/mp4' }]
  });
});

test('imports and runs source detection in Node without browser globals', () => {
  expect(expectDetected('/server-rendered.mp4').source.type).toBe('video');
});

test('returns not-ready without changing confirmed playback when no provider is attached', async () => {
  const controller = new PlayerController();

  await expect(controller.play()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
  expect(controller.getState()).toMatchObject({ playback: 'paused' });
});

test('keeps confirmed playback paused until a provider event confirms play', async () => {
  let emit: ((state: { playback: 'playing' }) => void) | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    play: async () => ({ ok: true })
  });

  await expect(controller.play()).resolves.toEqual({ ok: true });
  expect(controller.getState()).toMatchObject({ playback: 'paused' });

  emit?.({ playback: 'playing' });
  expect(controller.getState()).toMatchObject({ playback: 'playing' });
});

test('returns unsupported and provider-error command results without throwing', async () => {
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined,
    play: async () => {
      throw new Error('native failed');
    }
  });

  await expect(controller.seekTo(10)).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
  await expect(controller.play()).resolves.toMatchObject({
    ok: false,
    reason: 'provider-error',
    error: { category: 'provider', message: 'native failed' }
  });
});

test('preserves adapter method this binding for commands', async () => {
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach() {
      return undefined;
    },
    load() {
      return undefined;
    },
    destroy() {
      return undefined;
    },
    subscribe() {
      return () => undefined;
    },
    async play() {
      return this.provider === 'native'
        ? ({ ok: true } as const)
        : ({ ok: false, reason: 'provider-error' } as const);
    }
  });

  await expect(controller.play()).resolves.toEqual({ ok: true });
});

test('ignores stale events after replacing a provider', () => {
  let emitFirst: ((state: { playback: 'playing' }) => void) | undefined;
  const createProvider = (
    subscribe: (listener: (state: { playback: 'playing' }) => void) => void
  ) => ({
    provider: 'native' as const,
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener: (state: { playback: 'playing' }) => void) => {
      subscribe(listener);
      return () => undefined;
    }
  });
  const controller = new PlayerController();
  controller.setProvider(createProvider((listener) => (emitFirst = listener)));
  controller.setProvider(createProvider(() => undefined));

  emitFirst?.({ playback: 'playing' });

  expect(controller.getState().playback).toBe('paused');
});

test('stops provider A setup when its loading state subscriber installs B', () => {
  let aSubscribeCount = 0;
  let aAttachCount = 0;
  let bSubscribeCount = 0;
  const controller = new PlayerController();
  const providerB = {
    provider: 'hls' as const,
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => {
      bSubscribeCount += 1;
      return () => undefined;
    }
  };
  controller.subscribe((state) => {
    if (state.provider === 'native') controller.setProvider(providerB);
  });

  controller.setProvider({
    provider: 'native',
    attach: () => {
      aAttachCount += 1;
    },
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => {
      aSubscribeCount += 1;
      return () => undefined;
    }
  });

  expect(aSubscribeCount).toBe(0);
  expect(aAttachCount).toBe(0);
  expect(bSubscribeCount).toBe(1);
  expect(controller.getState().provider).toBe('hls');
});

test('cleans a stale subscription when provider A subscribe installs B', () => {
  let aUnsubscribeCount = 0;
  let aAttachCount = 0;
  let bUnsubscribeCount = 0;
  const controller = new PlayerController();
  const providerB = {
    provider: 'hls' as const,
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => {
      bUnsubscribeCount += 1;
    }
  };

  controller.setProvider({
    provider: 'native',
    attach: () => {
      aAttachCount += 1;
    },
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => {
      controller.setProvider(providerB);
      return () => {
        aUnsubscribeCount += 1;
      };
    }
  });
  controller.setProvider(undefined);

  expect(aUnsubscribeCount).toBe(1);
  expect(aAttachCount).toBe(0);
  expect(bUnsubscribeCount).toBe(1);
});

test('stops outer setup when previous unsubscribe installs provider B', () => {
  let previousDestroyCount = 0;
  let targetSubscribeCount = 0;
  let bUnsubscribeCount = 0;
  const controller = new PlayerController();
  const providerB = {
    provider: 'vimeo' as const,
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => {
      bUnsubscribeCount += 1;
    }
  };
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => {
      previousDestroyCount += 1;
    },
    subscribe: () => () => controller.setProvider(providerB)
  });

  controller.setProvider({
    provider: 'hls',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => {
      targetSubscribeCount += 1;
      return () => undefined;
    }
  });

  expect(controller.getState().provider).toBe('vimeo');
  expect(previousDestroyCount).toBe(1);
  expect(targetSubscribeCount).toBe(0);
  controller.setProvider(undefined);
  expect(bUnsubscribeCount).toBe(1);
});

test('does not recurse or continue outer setup when previous destroy installs B', () => {
  let previousDestroyCount = 0;
  let targetSubscribeCount = 0;
  let bUnsubscribeCount = 0;
  const controller = new PlayerController();
  const providerB = {
    provider: 'vimeo' as const,
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => {
      bUnsubscribeCount += 1;
    }
  };
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => {
      previousDestroyCount += 1;
      if (previousDestroyCount === 1) controller.setProvider(providerB);
    },
    subscribe: () => () => undefined
  });

  controller.setProvider({
    provider: 'hls',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => {
      targetSubscribeCount += 1;
      return () => undefined;
    }
  });

  expect(controller.getState().provider).toBe('vimeo');
  expect(previousDestroyCount).toBe(1);
  expect(targetSubscribeCount).toBe(0);
  controller.setProvider(undefined);
  expect(bUnsubscribeCount).toBe(1);
});

test('labels an A event with A when its patch subscriber installs B', () => {
  let emitA: ProviderStateListener | undefined;
  const events: Array<{ provider: string | null }> = [];
  const controller = new PlayerController();
  const providerB = {
    provider: 'hls' as const,
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined
  };
  controller.subscribe((state) => {
    if (state.playback === 'playing') controller.setProvider(providerB);
  });
  controller.on('play', (event) => events.push(event));
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emitA = listener;
      return () => undefined;
    }
  });

  emitA?.(
    { playback: 'playing' },
    { type: 'play', detail: undefined, origin: 'provider' }
  );

  expect(controller.getState().provider).toBe('hls');
  expect(events).toEqual([expect.objectContaining({ provider: 'native' })]);
});

test('does not load an adapter after it has been replaced during attach', async () => {
  let firstLoadCount = 0;
  const createProvider = (load: () => void) => ({
    provider: 'native' as const,
    attach: () => undefined,
    load,
    destroy: () => undefined,
    subscribe: () => () => undefined
  });
  const controller = new PlayerController();
  controller.setProvider(createProvider(() => (firstLoadCount += 1)));
  controller.setProvider(createProvider(() => undefined));

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(firstLoadCount).toBe(0);
});

test('preserves range identities when an unrelated provider patch arrives', () => {
  let emit: ProviderStateListener | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    }
  });
  emit?.({
    buffered: [{ start: 0, end: 4 }],
    seekable: [{ start: 0, end: 10 }]
  });
  const { buffered, seekable } = controller.getState();

  emit?.({ buffering: true });

  expect(controller.getState().buffered).toBe(buffered);
  expect(controller.getState().seekable).toBe(seekable);
});

// A provider is free to hand over its ranges in whatever order its engine
// reports them (hls.js and the Vimeo SDK both do), and a consumer drawing a
// buffer bar walks the list in order. Sorting is the contract, not a
// coincidence of the fixtures used elsewhere in this file (#101).
test('orders buffered and seekable ranges by start, whatever order they arrive in', () => {
  let emit: ProviderStateListener | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    }
  });

  emit?.({
    buffered: [
      { start: 30, end: 40 },
      { start: 0, end: 10 },
      { start: 15, end: 20 }
    ],
    seekable: [
      { start: 12, end: 18 },
      { start: 0, end: 5 }
    ]
  });

  expect(controller.getState().buffered).toEqual([
    { start: 0, end: 10 },
    { start: 15, end: 20 },
    { start: 30, end: 40 }
  ]);
  expect(controller.getState().seekable).toEqual([
    { start: 0, end: 5 },
    { start: 12, end: 18 }
  ]);
});

test('protects public state snapshots and their nested values from mutation', () => {
  let emit: ProviderStateListener | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    }
  });
  emit?.({ buffered: [{ start: 0, end: 3 }] });
  const state = controller.getState();

  expect(() => Object.assign(state, { volume: 0 })).toThrow();
  expect(() =>
    Object.assign(state.capabilities.seek, { status: 'available' })
  ).toThrow();
  expect(() => Object.assign(state.buffered[0]!, { end: 10 })).toThrow();
  expect(controller.getState()).toMatchObject({
    volume: 1,
    buffered: [{ start: 0, end: 3 }]
  });
});

test('contains synchronous unsubscribe, destroy, and attach failures', async () => {
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => {
      throw new Error('destroy failed');
    },
    subscribe: () => () => {
      throw new Error('unsubscribe failed');
    }
  });

  expect(() =>
    controller.setProvider({
      provider: 'native',
      attach: () => {
        throw new Error('attach failed');
      },
      load: () => undefined,
      destroy: () => undefined,
      subscribe: () => () => undefined
    })
  ).not.toThrow();

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    error: { message: 'attach failed' }
  });
});

test('contains subscribe failure and destroys the failed provider', async () => {
  let destroyCount = 0;
  const controller = new PlayerController();

  expect(() =>
    controller.setProvider({
      provider: 'native',
      attach: () => undefined,
      load: () => undefined,
      destroy: () => {
        destroyCount += 1;
      },
      subscribe: () => {
        throw new Error('subscribe failed');
      }
    })
  ).not.toThrow();

  expect(destroyCount).toBe(1);
  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    error: { message: 'subscribe failed' }
  });
  await expect(controller.play()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('resets to the initial state when detaching after subscribe failure', () => {
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => {
      throw new Error('subscribe failed');
    }
  });

  controller.setProvider(undefined);

  expect(controller.getState()).toEqual(createInitialPlayerState());
});

test('ignores a callback captured before subscribe failure', () => {
  let emit: ProviderStateListener | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      throw new Error('subscribe failed');
    }
  });

  emit?.({ lifecycle: 'ready', activation: 'ready' });

  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    provider: 'native',
    error: { message: 'subscribe failed' }
  });
});

test('contains rejected destroy and load failures without stale state', async () => {
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => Promise.reject(new Error('destroy rejected')),
    subscribe: () => () => undefined
  });
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => Promise.reject(new Error('load rejected')),
    destroy: () => undefined,
    subscribe: () => () => undefined
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    error: { message: 'load rejected' }
  });
});

test('retry enters loading, clears the error, and accepts authoritative recovery', async () => {
  let emit: ProviderStateListener | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    retry: async () => ({ ok: true })
  });
  emit?.({
    lifecycle: 'error',
    activation: 'error',
    error: {
      category: 'network',
      fatal: true,
      recoverable: true,
      message: 'network failed'
    }
  });

  const retry = controller.retry();

  expect(controller.getState()).toMatchObject({
    lifecycle: 'loading',
    activation: 'loading-provider',
    error: null
  });
  await expect(retry).resolves.toEqual({ ok: true });
  emit?.({ lifecycle: 'ready', activation: 'ready' });
  expect(controller.getState()).toMatchObject({
    lifecycle: 'ready',
    error: null
  });
});

test('does not invoke replacement B retry when loading publication replaces A', async () => {
  let aRetryCount = 0;
  let bRetryCount = 0;
  let replaceOnLoading = false;
  const controller = new PlayerController();
  const providerB = {
    provider: 'hls' as const,
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined,
    retry: async () => {
      bRetryCount += 1;
      return { ok: true } as const;
    }
  };
  controller.subscribe((state) => {
    if (replaceOnLoading && state.lifecycle === 'loading') {
      replaceOnLoading = false;
      controller.setProvider(providerB);
    }
  });
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined,
    retry: async () => {
      aRetryCount += 1;
      return { ok: true } as const;
    }
  });
  replaceOnLoading = true;

  await controller.retry();

  expect(aRetryCount).toBe(0);
  expect(bRetryCount).toBe(0);
  expect(controller.getState().provider).toBe('hls');
});

test('ignores stale retry failure after a replacement provider is ready', async () => {
  let resolveRetry:
    | ((result: {
        ok: false;
        reason: 'provider-error';
        error: {
          category: 'provider';
          fatal: false;
          recoverable: true;
          message: string;
        };
      }) => void)
    | undefined;
  let emitReplacement: ProviderStateListener | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined,
    retry: () => new Promise((resolve) => (resolveRetry = resolve))
  });
  const retry = controller.retry();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emitReplacement = listener;
      return () => undefined;
    }
  });
  emitReplacement?.({ lifecycle: 'ready', activation: 'ready' });

  resolveRetry?.({
    ok: false,
    reason: 'provider-error',
    error: {
      category: 'provider',
      fatal: false,
      recoverable: true,
      message: 'stale retry failed'
    }
  });
  await retry;

  expect(controller.getState()).toMatchObject({
    lifecycle: 'ready',
    activation: 'ready',
    error: null
  });
});

test('restores the prior coherent error state when retry fails without an error', async () => {
  let emit: ProviderStateListener | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    retry: async () => ({ ok: false, reason: 'unsupported' })
  });
  emit?.({
    lifecycle: 'error',
    activation: 'error',
    error: {
      category: 'network',
      fatal: true,
      recoverable: true,
      message: 'original error'
    }
  });

  await expect(controller.retry()).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });

  expect(controller.getState()).toMatchObject({
    lifecycle: 'error',
    activation: 'error',
    error: { message: 'original error' }
  });
});

test('keys event listener detail types by the subscribed event name', () => {
  let emit: ProviderStateListener | undefined;
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    }
  });
  let observedVolume: number | undefined;
  controller.on('volumechange', (event) => {
    observedVolume = event.detail.volume;
  });

  emit?.(
    { volume: 0.25 },
    {
      type: 'volumechange',
      detail: { muted: false, volume: 0.25 },
      origin: 'provider'
    }
  );

  expect(observedVolume).toBe(0.25);
});
