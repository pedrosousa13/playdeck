// @vitest-environment happy-dom

import * as process from 'node:process';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import {
  createRef,
  startTransition,
  StrictMode,
  Suspense,
  useState
} from 'react';
import type * as React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlayerController, type ProviderAdapter } from '@reely/core';
import type { NativePlaybackOptions } from '@reely/provider-native';
import * as Player from '../src/index';

vi.mock('../src/provider-loaders', async () => {
  const { createNativeProvider } = await import('@reely/provider-native');
  return {
    // Keep legacy provider assertions synchronous; activation.test.tsx covers
    // the real Promise boundary and the loader's real async contract directly.
    loadProvider: ({
      media,
      nativeOptions
    }: {
      media: HTMLVideoElement | null;
      nativeOptions: NativePlaybackOptions;
    }) => ({
      then: (resolve: (adapter: ProviderAdapter) => void) => {
        resolve(createNativeProvider(media!, nativeOptions));
        return { catch: () => undefined };
      }
    })
  };
});

class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '200px 0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];
  constructor(private callback: IntersectionObserverCallback) {}
  disconnect = () => undefined;
  observe = (target: Element) =>
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0
        }
      ],
      this
    );
  takeRecords = () => [];
  unobserve = () => undefined;
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
});

const LegacyRoot = ({ loading = 'eager', ...props }: Player.RootProps) => (
  <Player.Root {...props} loading={loading} />
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const verifyReadonlyStateTypes = (
  state: ReturnType<Player.PlayerHandle['getState']>
): void => {
  // @ts-expect-error PlayerState snapshots are readonly.
  state.volume = 0;
  // @ts-expect-error Nested capabilities are readonly.
  state.capabilities.seek.status = 'available';
  // @ts-expect-error Nested time ranges are readonly.
  state.buffered[0]!.end = 10;
};

// Compile-time guard: Media excludes the controller-owned <video> attributes
// so a consumer can't silently desync or bypass the player's state machine.
const verifyMediaPropsExclusions = (): Player.MediaProps[] => [
  // @ts-expect-error src is driven by the resolved source / <source> children.
  { src: '/clip.mp4' },
  // @ts-expect-error muted is owned by the controller (volume/activation).
  { muted: true },
  // @ts-expect-error autoPlay is owned by the controller (autoplay policy).
  { autoPlay: true },
  // @ts-expect-error use nativePoster instead of poster.
  { poster: '/poster.jpg' },
  // @ts-expect-error preload is derived from the loading strategy.
  { preload: 'none' }
];

const confirmMetadataReady = (media: HTMLVideoElement): void => {
  Object.defineProperty(media, 'readyState', {
    configurable: true,
    value: 1
  });
  fireEvent.loadedMetadata(media);
};

test('exposes playback preferences without accepting a playing prop', () => {
  const onMutedChange = vi.fn();
  const onVolumeChange = vi.fn();
  const onPlaybackRateChange = vi.fn();
  const invalidRoot = (
    // @ts-expect-error Playback is confirmed state, not a controlled Root prop.
    <LegacyRoot playing source="/tracer.mp4">
      <Player.Media />
    </LegacyRoot>
  );

  render(
    <LegacyRoot
      defaultMuted
      defaultPlaybackRate={1.5}
      defaultVolume={0.4}
      onMutedChange={onMutedChange}
      onPlaybackRateChange={onPlaybackRateChange}
      onVolumeChange={onVolumeChange}
      source="/tracer.mp4"
    >
      <Player.Media />
    </LegacyRoot>
  );

  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  expect(media.muted).toBe(true);
  expect(media.volume).toBe(0.4);
  expect(media.playbackRate).toBe(1.5);
  expect(onMutedChange).not.toHaveBeenCalled();
  expect(onVolumeChange).not.toHaveBeenCalled();
  expect(onPlaybackRateChange).not.toHaveBeenCalled();
  expect(invalidRoot).toBeDefined();
});

test('keeps provider preferences and autoplay active after StrictMode effect replay', async () => {
  const onVolumeChange = vi.fn();
  const handle = createRef<Player.PlayerHandle>();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  render(
    <StrictMode>
      <LegacyRoot
        autoplay="audible"
        onVolumeChange={onVolumeChange}
        ref={handle}
        source="/tracer.mp4"
        volume={0.7}
      >
        <Player.Media />
        <Player.PlayButton />
      </LegacyRoot>
    </StrictMode>
  );
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');

  expect(handle.current?.getState().provider).toBe('native');
  media.volume = 0.2;
  fireEvent.volumeChange(media);
  expect(onVolumeChange).toHaveBeenCalledExactlyOnceWith(0.2);
  expect(media.volume).toBe(0.7);
  fireEvent.volumeChange(media);

  confirmMetadataReady(media);
  await waitFor(() =>
    expect(screen.getByRole('button').dataset.autoplayState).toBe('started')
  );
  expect(onVolumeChange).toHaveBeenCalledTimes(1);
});

test('does not assign invalid controlled numeric preferences during media registration', () => {
  const player = (source: string) => (
    <LegacyRoot playbackRate={0} source={source} volume={Number.NaN}>
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player('/first.mp4'));
  const firstMedia = screen.getByLabelText<HTMLVideoElement>('Reely media');

  expect(firstMedia.volume).toBe(1);
  expect(firstMedia.playbackRate).toBe(1);
  rerender(player('/second.mp4'));

  const replacement = screen.getByLabelText<HTMLVideoElement>('Reely media');
  expect(replacement).not.toBe(firstMedia);
  expect(replacement.volume).toBe(1);
  expect(replacement.playbackRate).toBe(1);
});

test('clamps finite default volume and skips an invalid default rate on replacement', () => {
  const player = (source: string) => (
    <LegacyRoot
      defaultPlaybackRate={Number.POSITIVE_INFINITY}
      defaultVolume={-2}
      source={source}
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player('/first.mp4'));
  const firstMedia = screen.getByLabelText<HTMLVideoElement>('Reely media');

  expect(firstMedia.volume).toBe(0);
  expect(firstMedia.playbackRate).toBe(1);
  rerender(player('/second.mp4'));

  const replacement = screen.getByLabelText<HTMLVideoElement>('Reely media');
  expect(replacement).not.toBe(firstMedia);
  expect(replacement.volume).toBe(0);
  expect(replacement.playbackRate).toBe(1);
});

test.each([
  ['volume', 0.4],
  ['playbackRate', 1.5]
] as const)(
  'keeps provider lifecycle usable when a valid initial %s setter throws',
  (property, value) => {
    const setter = vi
      .spyOn(HTMLMediaElement.prototype, property, 'set')
      .mockImplementation(() => {
        throw new DOMException(`The browser rejected ${property}.`);
      });
    const handle = createRef<Player.PlayerHandle>();
    const preferences =
      property === 'volume'
        ? { defaultVolume: value }
        : { defaultPlaybackRate: value };

    render(
      <LegacyRoot ref={handle} source="/tracer.mp4" {...preferences}>
        <Player.Media />
      </LegacyRoot>
    );
    const media = screen.getByLabelText<HTMLVideoElement>('Reely media');

    expect(setter).toHaveBeenCalledWith(value);
    expect(handle.current?.getState().provider).toBe('native');
    confirmMetadataReady(media);
    expect(handle.current?.getState().lifecycle).toBe('ready');
  }
);

test('seeds default preferences once and retains confirmed values across media replacement', () => {
  const player = (
    source: string,
    defaults: { muted: boolean; volume: number; playbackRate: number }
  ) => (
    <LegacyRoot
      defaultMuted={defaults.muted}
      defaultPlaybackRate={defaults.playbackRate}
      defaultVolume={defaults.volume}
      source={source}
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(
    player('/first.mp4', { muted: true, volume: 0.4, playbackRate: 1.5 })
  );
  const firstMedia = screen.getByLabelText<HTMLVideoElement>('Reely media');

  rerender(
    player('/first.mp4', { muted: false, volume: 0.8, playbackRate: 2 })
  );
  expect(firstMedia.muted).toBe(true);
  expect(firstMedia.volume).toBe(0.4);
  expect(firstMedia.playbackRate).toBe(1.5);

  firstMedia.muted = false;
  firstMedia.volume = 0.6;
  firstMedia.playbackRate = 1.25;
  fireEvent.volumeChange(firstMedia);
  fireEvent.rateChange(firstMedia);
  rerender(
    player('/second.mp4', { muted: false, volume: 0.8, playbackRate: 2 })
  );

  const replacement = screen.getByLabelText<HTMLVideoElement>('Reely media');
  expect(replacement).not.toBe(firstMedia);
  expect(replacement.muted).toBe(false);
  expect(replacement.volume).toBe(0.6);
  expect(replacement.playbackRate).toBe(1.25);
});

test('reconciles controlled preferences without reporting prop-driven confirmations', () => {
  const onMutedChange = vi.fn();
  const onVolumeChange = vi.fn();
  const onPlaybackRateChange = vi.fn();
  const player = (muted: boolean, volume: number, playbackRate: number) => (
    <LegacyRoot
      muted={muted}
      onMutedChange={onMutedChange}
      onPlaybackRateChange={onPlaybackRateChange}
      onVolumeChange={onVolumeChange}
      playbackRate={playbackRate}
      source="/tracer.mp4"
      volume={volume}
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player(false, 0.7, 1.25));
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');

  rerender(player(true, 0.3, 1.75));
  expect(media.muted).toBe(true);
  expect(media.volume).toBe(0.3);
  expect(media.playbackRate).toBe(1.75);
  fireEvent.volumeChange(media);
  fireEvent.rateChange(media);

  expect(onMutedChange).not.toHaveBeenCalled();
  expect(onVolumeChange).not.toHaveBeenCalled();
  expect(onPlaybackRateChange).not.toHaveBeenCalled();
});

test('supersedes a delayed muted confirmation after a rapid controlled reversal', () => {
  const onMutedChange = vi.fn();
  const handle = createRef<Player.PlayerHandle>();
  const player = (muted: boolean) => (
    <LegacyRoot
      muted={muted}
      onMutedChange={onMutedChange}
      ref={handle}
      source="/tracer.mp4"
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player(false));
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  const mute = vi.spyOn(handle.current!, 'mute');
  const unmute = vi.spyOn(handle.current!, 'unmute');

  rerender(player(true));
  rerender(player(false));
  expect(media.muted).toBe(true);

  fireEvent.volumeChange(media);
  expect(handle.current?.getState().muted).toBe(true);
  expect(media.muted).toBe(false);
  fireEvent.volumeChange(media);
  fireEvent.volumeChange(media);

  expect(handle.current?.getState().muted).toBe(false);
  expect(media.muted).toBe(false);
  expect(onMutedChange).not.toHaveBeenCalled();
  expect(mute).toHaveBeenCalledTimes(1);
  expect(unmute).toHaveBeenCalledTimes(1);
});

test('supersedes a delayed volume confirmation after a rapid controlled reversal', () => {
  const onVolumeChange = vi.fn();
  const handle = createRef<Player.PlayerHandle>();
  const player = (volume: number) => (
    <LegacyRoot
      onVolumeChange={onVolumeChange}
      ref={handle}
      source="/tracer.mp4"
      volume={volume}
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player(0.7));
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  const setVolume = vi.spyOn(handle.current!, 'setVolume');

  rerender(player(0.2));
  rerender(player(0.7));
  expect(media.volume).toBe(0.2);

  fireEvent.volumeChange(media);
  expect(handle.current?.getState().volume).toBe(0.2);
  expect(media.volume).toBe(0.7);
  fireEvent.volumeChange(media);
  fireEvent.volumeChange(media);

  expect(handle.current?.getState().volume).toBe(0.7);
  expect(media.volume).toBe(0.7);
  expect(onVolumeChange).not.toHaveBeenCalled();
  expect(setVolume.mock.calls).toEqual([[0.2], [0.7]]);
});

test('supersedes a delayed rate confirmation after a rapid controlled reversal', () => {
  const onPlaybackRateChange = vi.fn();
  const handle = createRef<Player.PlayerHandle>();
  const player = (playbackRate: number) => (
    <LegacyRoot
      onPlaybackRateChange={onPlaybackRateChange}
      playbackRate={playbackRate}
      ref={handle}
      source="/tracer.mp4"
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player(1.25));
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  const setPlaybackRate = vi.spyOn(handle.current!, 'setPlaybackRate');

  rerender(player(2));
  rerender(player(1.25));
  expect(media.playbackRate).toBe(2);

  fireEvent.rateChange(media);
  expect(handle.current?.getState().playbackRate).toBe(2);
  expect(media.playbackRate).toBe(1.25);
  fireEvent.rateChange(media);
  fireEvent.rateChange(media);

  expect(handle.current?.getState().playbackRate).toBe(1.25);
  expect(media.playbackRate).toBe(1.25);
  expect(onPlaybackRateChange).not.toHaveBeenCalled();
  expect(setPlaybackRate.mock.calls).toEqual([[2], [1.25]]);
});

test('clears retired volume targets when queued confirmations coalesce to the latest value', () => {
  const callbackMediaValues: number[] = [];
  const onVolumeChange = vi.fn((value: number) => {
    const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
    callbackMediaValues.push(media.volume);
    expect(value).toBe(media.volume);
  });
  const handle = createRef<Player.PlayerHandle>();
  const player = (volume: number) => (
    <LegacyRoot
      onVolumeChange={onVolumeChange}
      ref={handle}
      source="/tracer.mp4"
      volume={volume}
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player(0.7));
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  const setVolume = vi.spyOn(handle.current!, 'setVolume');

  rerender(player(0.2));
  rerender(player(0.5));
  fireEvent.volumeChange(media);
  fireEvent.volumeChange(media);

  media.volume = 0.2;
  fireEvent.volumeChange(media);
  expect(onVolumeChange).toHaveBeenCalledExactlyOnceWith(0.2);
  expect(callbackMediaValues).toEqual([0.2]);
  expect(media.volume).toBe(0.5);
  fireEvent.volumeChange(media);
  fireEvent.volumeChange(media);

  expect(handle.current?.getState().volume).toBe(0.5);
  expect(onVolumeChange).toHaveBeenCalledTimes(1);
  expect(setVolume.mock.calls).toEqual([[0.2], [0.5], [0.5]]);
});

test('clears repeated retired rate targets after the latest active confirmation', () => {
  const callbackMediaValues: number[] = [];
  const onPlaybackRateChange = vi.fn((value: number) => {
    const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
    callbackMediaValues.push(media.playbackRate);
    expect(value).toBe(media.playbackRate);
  });
  const handle = createRef<Player.PlayerHandle>();
  const player = (playbackRate: number) => (
    <LegacyRoot
      onPlaybackRateChange={onPlaybackRateChange}
      playbackRate={playbackRate}
      ref={handle}
      source="/tracer.mp4"
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player(1));
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  const setPlaybackRate = vi.spyOn(handle.current!, 'setPlaybackRate');

  rerender(player(2));
  rerender(player(1));
  rerender(player(2));
  fireEvent.rateChange(media);
  rerender(player(1.5));
  fireEvent.rateChange(media);

  media.playbackRate = 2;
  fireEvent.rateChange(media);
  expect(onPlaybackRateChange).toHaveBeenCalledExactlyOnceWith(2);
  expect(callbackMediaValues).toEqual([2]);
  expect(media.playbackRate).toBe(1.5);
  fireEvent.rateChange(media);
  fireEvent.rateChange(media);

  expect(handle.current?.getState().playbackRate).toBe(1.5);
  expect(onPlaybackRateChange).toHaveBeenCalledTimes(1);
  expect(setPlaybackRate.mock.calls).toEqual([[2], [2], [1.5], [1.5]]);
});

test('clears retired muted targets when a reversal confirmation coalesces to current', () => {
  const callbackMediaValues: boolean[] = [];
  const onMutedChange = vi.fn((value: boolean) => {
    const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
    callbackMediaValues.push(media.muted);
    expect(value).toBe(media.muted);
  });
  const handle = createRef<Player.PlayerHandle>();
  const player = (muted: boolean) => (
    <LegacyRoot
      muted={muted}
      onMutedChange={onMutedChange}
      ref={handle}
      source="/tracer.mp4"
    >
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player(false));
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  const mute = vi.spyOn(handle.current!, 'mute');
  const unmute = vi.spyOn(handle.current!, 'unmute');

  rerender(player(true));
  rerender(player(false));
  media.muted = false;
  fireEvent.volumeChange(media);

  media.muted = true;
  fireEvent.volumeChange(media);
  expect(onMutedChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(callbackMediaValues).toEqual([true]);
  expect(media.muted).toBe(false);
  fireEvent.volumeChange(media);
  fireEvent.volumeChange(media);

  expect(handle.current?.getState().muted).toBe(false);
  expect(onMutedChange).toHaveBeenCalledTimes(1);
  expect(mute).toHaveBeenCalledTimes(1);
  expect(unmute).toHaveBeenCalledTimes(1);
});

test('reports confirmed controlled conflicts before restoring controlled values', () => {
  const mediaAtMutedCallback: boolean[] = [];
  const mediaAtVolumeCallback: number[] = [];
  const mediaAtRateCallback: number[] = [];
  const onMutedChange = vi.fn((value: boolean) => {
    const confirmed = screen.getByLabelText<HTMLVideoElement>('Reely media');
    mediaAtMutedCallback.push(confirmed.muted);
    expect(value).toBe(confirmed.muted);
  });
  const onVolumeChange = vi.fn((value: number) => {
    const confirmed = screen.getByLabelText<HTMLVideoElement>('Reely media');
    mediaAtVolumeCallback.push(confirmed.volume);
    expect(value).toBe(confirmed.volume);
  });
  const onPlaybackRateChange = vi.fn((value: number) => {
    const confirmed = screen.getByLabelText<HTMLVideoElement>('Reely media');
    mediaAtRateCallback.push(confirmed.playbackRate);
    expect(value).toBe(confirmed.playbackRate);
  });
  render(
    <LegacyRoot
      muted={false}
      onMutedChange={onMutedChange}
      onPlaybackRateChange={onPlaybackRateChange}
      onVolumeChange={onVolumeChange}
      playbackRate={1.25}
      source="/tracer.mp4"
      volume={0.7}
    >
      <Player.Media />
    </LegacyRoot>
  );
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');

  media.muted = true;
  media.volume = 0.2;
  fireEvent.volumeChange(media);
  media.playbackRate = 2;
  fireEvent.rateChange(media);

  expect(onMutedChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(onVolumeChange).toHaveBeenCalledExactlyOnceWith(0.2);
  expect(onPlaybackRateChange).toHaveBeenCalledExactlyOnceWith(2);
  expect(mediaAtMutedCallback).toEqual([true]);
  expect(mediaAtVolumeCallback).toEqual([0.2]);
  expect(mediaAtRateCallback).toEqual([2]);
  expect(media.muted).toBe(false);
  expect(media.volume).toBe(0.7);
  expect(media.playbackRate).toBe(1.25);

  fireEvent.volumeChange(media);
  fireEvent.rateChange(media);
  expect(onMutedChange).toHaveBeenCalledTimes(1);
  expect(onVolumeChange).toHaveBeenCalledTimes(1);
  expect(onPlaybackRateChange).toHaveBeenCalledTimes(1);
});

test('keeps autoplay disabled by default', () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined);
  render(
    <LegacyRoot source="/tracer.mp4">
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );

  confirmMetadataReady(screen.getByLabelText('Reely media'));

  expect(play).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Play' }).dataset.autoplayState
  ).toBe('idle');
});

test('mutes before autoplay and reports attempting then confirmed started', async () => {
  const observedMutedAtPlay: boolean[] = [];
  const onMutedChange = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    observedMutedAtPlay.push(this.muted);
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  render(
    <LegacyRoot
      autoplay="muted"
      onMutedChange={onMutedChange}
      source="/tracer.mp4"
    >
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');

  confirmMetadataReady(media);
  // Awaited rather than asserted synchronously: autoplay is deferred until the
  // provider's own `load()` has run (#87), because `load()` aborts a play
  // already in flight. The `attempting` state is stable until the
  // `volumechange` below confirms the mute, so this cannot race past it.
  await waitFor(() =>
    expect(screen.getByRole('button').dataset.autoplayState).toBe('attempting')
  );
  fireEvent.volumeChange(media);

  await waitFor(() =>
    expect(screen.getByRole('button').dataset.autoplayState).toBe('started')
  );
  expect(observedMutedAtPlay).toEqual([true]);
  expect(onMutedChange).toHaveBeenCalledExactlyOnceWith(true);
});

test('attempts audible autoplay without muting', async () => {
  const mediaMutedAtPlay: boolean[] = [];
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    mediaMutedAtPlay.push(this.muted);
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  render(
    <LegacyRoot autoplay="audible" source="/tracer.mp4">
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );

  confirmMetadataReady(screen.getByLabelText('Reely media'));

  await waitFor(() =>
    expect(screen.getByRole('button').dataset.autoplayState).toBe('started')
  );
  expect(mediaMutedAtPlay).toEqual([false]);
});

test.each([
  ['blocked', new DOMException('Playback blocked.', 'NotAllowedError')],
  ['failed', new Error('Playback failed.')]
])('reports %s autoplay attempts', async (state, error) => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(error);
  render(
    <LegacyRoot autoplay="audible" source="/tracer.mp4">
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );

  confirmMetadataReady(screen.getByLabelText('Reely media'));

  await waitFor(() =>
    expect(screen.getByRole('button').dataset.autoplayState).toBe(state)
  );
});

test('keeps blocked autoplay focusable and retries only from a user-origin click', async () => {
  const origins: string[] = [];
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockRejectedValueOnce(
      new DOMException('Playback blocked.', 'NotAllowedError')
    )
    .mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
  const handle = createRef<Player.PlayerHandle>();
  render(
    <LegacyRoot autoplay="audible" ref={handle} source="/tracer.mp4">
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );
  handle.current?.on('play', (event) => origins.push(event.origin));
  confirmMetadataReady(screen.getByLabelText('Reely media'));
  await waitFor(() =>
    expect(screen.getByRole('button').dataset.autoplayState).toBe('blocked')
  );

  const button = screen.getByRole('button', { name: 'Play' });
  expect(button.tabIndex).toBe(0);
  expect(play).toHaveBeenCalledTimes(1);
  fireEvent.click(button);

  await waitFor(() => expect(origins).toEqual(['user']));
  expect(play).toHaveBeenCalledTimes(2);
});

test('reports the controlled-unmuted conflict without trying muted autoplay', () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined);
  const handle = createRef<Player.PlayerHandle>();
  render(
    <LegacyRoot
      autoplay="muted"
      muted={false}
      ref={handle}
      source="/tracer.mp4"
    >
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );

  confirmMetadataReady(screen.getByLabelText('Reely media'));

  expect(screen.getByRole('button').dataset.autoplayState).toBe('failed');
  expect(handle.current?.getState().error?.category).toBe('configuration');
  expect(play).not.toHaveBeenCalled();
});

test('keeps confirmed paused state when the media play command rejects', async () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
    new DOMException('Playback was blocked.', 'NotAllowedError')
  );

  try {
    render(
      <LegacyRoot source="video.mp4">
        <Player.Media />
        <Player.PlayButton />
      </LegacyRoot>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandledRejections).toEqual([]);
    expect(
      screen.getByRole('button', { name: 'Play' }).getAttribute('data-state')
    ).toBe('paused');
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});

test('renders every explicit video source in order with its MIME type', () => {
  render(
    <LegacyRoot
      source={{
        type: 'video',
        sources: [
          { src: '/tracer.webm', mimeType: 'video/webm' },
          { src: '/tracer.mp4', mimeType: 'video/mp4' }
        ]
      }}
    >
      <Player.Media />
    </LegacyRoot>
  );

  const sources = screen
    .getByLabelText('Reely media')
    .querySelectorAll('source');
  expect(
    Array.from(sources, (source) => ({
      src: source.getAttribute('src'),
      type: source.getAttribute('type')
    }))
  ).toEqual([
    { src: '/tracer.webm', type: 'video/webm' },
    { src: '/tracer.mp4', type: 'video/mp4' }
  ]);
});

test('remounts media and resets confirmed playing state after a transition to HLS', () => {
  const source = { type: 'hls' as const, src: '/master.m3u8' };
  const player = (playerSource: '/tracer.mp4' | typeof source) => (
    <LegacyRoot source={playerSource}>
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );
  const { rerender } = render(player('/tracer.mp4'));
  const media = screen.getByLabelText('Reely media');

  fireEvent.play(media);
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined();

  rerender(player(source));

  const remounted = screen.getByLabelText('Reely media');
  expect(remounted).not.toBe(media);
  expect(remounted.querySelectorAll('source')).toHaveLength(0);
  expect(
    screen.getByRole('button', { name: 'Play' }).getAttribute('data-state')
  ).toBe('paused');
});

test('renders hls sources as a bare video mount with quality actions exposed', () => {
  const handle = createRef<Player.PlayerHandle>();
  render(
    <LegacyRoot ref={handle} source={{ type: 'hls', src: '/hls/master.m3u8' }}>
      <Player.Media nativePoster="/poster.jpg" />
    </LegacyRoot>
  );

  const media = screen.getByLabelText('Reely media');
  expect(media.querySelectorAll('source')).toHaveLength(0);
  expect(media.getAttribute('poster')).toBe('/poster.jpg');
  expect(typeof handle.current?.selectQuality).toBe('function');
});

test.each([
  ['provider', { type: 'youtube' as const, videoId: 'dQw4w9WgXcQ' }],
  ['detection failure', 'source-without-extension']
])(
  'resets confirmed playing state after a transition to %s',
  (_kind, source) => {
    const player = (playerSource: '/tracer.mp4' | typeof source) => (
      <LegacyRoot source={playerSource}>
        <Player.Media />
        <Player.PlayButton />
      </LegacyRoot>
    );
    const { rerender } = render(player('/tracer.mp4'));
    const media = screen.getByLabelText('Reely media');

    fireEvent.play(media);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined();

    rerender(player(source));

    expect(screen.queryByLabelText('Reely media')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Play' }).getAttribute('data-state')
    ).toBe('paused');
  }
);

test('exposes stable actions and a ref handle backed by the Root controller', () => {
  const handle = createRef<Player.PlayerHandle>();
  const actionReferences: Player.PlayerActions[] = [];
  const Probe = () => {
    actionReferences.push(Player.usePlayerActions());
    Player.usePlayerState((state) => state.playback);
    return null;
  };
  const player = () => (
    <LegacyRoot ref={handle} source="/tracer.mp4">
      <Player.Media />
      <Probe />
    </LegacyRoot>
  );
  const { rerender } = render(player());

  rerender(player());

  expect(actionReferences).toHaveLength(3);
  expect(
    actionReferences.every((actions) => actions === actionReferences[0])
  ).toBe(true);
  expect(actionReferences[0]?.play).toBe(handle.current?.play);
  expect(handle.current?.getState().playback).toBe('paused');
  expect(handle.current).toMatchObject({
    getState: expect.any(Function),
    play: expect.any(Function)
  });
  handle.current?.on('volumechange', (event) => {
    expect(event.detail.volume).toBeTypeOf('number');
  });
  expect(verifyReadonlyStateTypes).toBeTypeOf('function');
  expect(verifyMediaPropsExclusions).toBeTypeOf('function');
});

test('keeps the imperative handle backed by the full PlayerController', () => {
  // The Storybook mock-player decorator (apps/storybook/.storybook/
  // mock-player.tsx) casts PlayerHandle to PlayerController to reach the
  // provider-facing surface (setProvider, configureAutoplay). This pins that
  // invariant: the handle must remain the controller instance itself.
  const handle = createRef<Player.PlayerHandle>();
  render(
    <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
      {null}
    </Player.Root>
  );

  expect(handle.current).toBeInstanceOf(PlayerController);
  const controller = handle.current as unknown as PlayerController;
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined
  };
  act(() => {
    controller.setProvider(adapter);
  });
  expect(controller.getState().activation).toBe('loading-provider');
  act(() => {
    controller.setProvider(undefined);
  });
  expect(controller.getState().activation).toBe('dormant');
});

test('throws a clear error when player hooks are used outside Root', () => {
  const Probe = () => {
    Player.usePlayerState((state) => state.playback);
    return null;
  };

  expect(() => render(<Probe />)).toThrow(/inside Player.Root/i);
});

test('reads the same controller state through PlayerHandle and usePlayerState', () => {
  const handle = createRef<Player.PlayerHandle>();
  const Probe = () => {
    const selectedPlayback = Player.usePlayerState((state) => state.playback);
    return <output data-testid="selected-playback">{selectedPlayback}</output>;
  };
  render(
    <LegacyRoot ref={handle} source="/tracer.mp4">
      <Player.Media />
      <Probe />
    </LegacyRoot>
  );

  fireEvent.play(screen.getByLabelText('Reely media'));

  expect(screen.getByTestId('selected-playback').textContent).toBe('playing');
  expect(handle.current?.getState().playback).toBe('playing');
});

test('does not rerender a selector when an unrelated confirmed state changes', () => {
  const renderSpy = vi.fn();
  const Volume = () => {
    Player.usePlayerState((state) => state.volume);
    renderSpy();
    return null;
  };

  render(
    <LegacyRoot source="/tracer.mp4">
      <Player.Media />
      <Volume />
    </LegacyRoot>
  );
  const initialRenders = renderSpy.mock.calls.length;

  fireEvent.play(screen.getByLabelText('Reely media'));

  expect(renderSpy).toHaveBeenCalledTimes(initialRenders);
});

test('caches an object selector and isolates it from unrelated state changes', () => {
  const renderSpy = vi.fn();
  const Volume = () => {
    const selection = Player.usePlayerState((state) => ({
      volume: state.volume
    }));
    renderSpy();
    return <output>{selection.volume}</output>;
  };

  render(
    <LegacyRoot source="/tracer.mp4">
      <Player.Media />
      <Volume />
    </LegacyRoot>
  );
  const initialRenders = renderSpy.mock.calls.length;

  fireEvent.play(screen.getByLabelText('Reely media'));

  expect(screen.getByText('1')).toBeDefined();
  expect(renderSpy).toHaveBeenCalledTimes(initialRenders);
});

test('observes changes to enumerable symbol-key selector values', () => {
  const volume = Symbol('volume');
  const Volume = () => {
    const selection = Player.usePlayerState((state) => ({
      [volume]: state.volume
    }));
    return <output>{selection[volume]}</output>;
  };
  render(
    <LegacyRoot source="/tracer.mp4">
      <Player.Media />
      <Volume />
    </LegacyRoot>
  );
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  media.volume = 0.4;

  fireEvent.volumeChange(media);

  expect(screen.getByText('0.4')).toBeDefined();
});

test('reevaluates a changed selector when controller state is unchanged', () => {
  const Selection = ({ selectPlayback }: { selectPlayback: boolean }) => {
    const selected = Player.usePlayerState((state) =>
      selectPlayback ? state.playback : state.volume
    );
    return <output>{selected}</output>;
  };
  const player = (selectPlayback: boolean) => (
    <LegacyRoot source="/tracer.mp4">
      <Selection selectPlayback={selectPlayback} />
    </LegacyRoot>
  );
  const { rerender } = render(player(false));
  expect(screen.getByText('1')).toBeDefined();

  rerender(player(true));

  expect(screen.getByText('paused')).toBeDefined();
});

test('throws a clear error when usePlayerActions is used outside Root', () => {
  const Probe = () => {
    Player.usePlayerActions();
    return null;
  };

  expect(() => render(<Probe />)).toThrow(/inside Player.Root/i);
});

test('passes loop and playback boundaries from Root to the native adapter', async () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined);
  render(
    <LegacyRoot loop startTime={3} endTime={6} source="/tracer.mp4">
      <Player.Media />
    </LegacyRoot>
  );
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');

  fireEvent.loadedMetadata(media);
  expect(media.currentTime).toBe(3);

  media.currentTime = 6;
  fireEvent.timeUpdate(media);
  await Promise.resolve();
  expect(media.currentTime).toBe(3);
  expect(play).toHaveBeenCalledOnce();
});

test('replaces the provider once when native playback options change', async () => {
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined);
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
  const handle = createRef<Player.PlayerHandle>();
  const player = (startTime: number) => (
    <LegacyRoot
      autoplay="audible"
      ref={handle}
      source="/tracer.mp4"
      startTime={startTime}
    >
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );
  const { rerender } = render(player(0));
  const media = screen.getByLabelText<HTMLVideoElement>('Reely media');
  confirmMetadataReady(media);
  await waitFor(() => expect(play).toHaveBeenCalledOnce());
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  play.mockClear();
  load.mockClear();
  const providerStates: Array<string | null> = [];
  const unsubscribe = handle.current?.subscribe((state) =>
    providerStates.push(state.provider)
  );
  providerStates.length = 0;

  rerender(player(1));

  await waitFor(() => expect(play).toHaveBeenCalledOnce());
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      provider: 'native',
      autoplay: 'started'
    })
  );
  expect(providerStates).toEqual(expect.arrayContaining(['native']));
  expect(providerStates).not.toContain(null);
  unsubscribe?.();
});

test('attaches and loads one provider without detaching on source switch', async () => {
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined);
  const handle = createRef<Player.PlayerHandle>();
  const player = (source: string) => (
    <LegacyRoot ref={handle} source={source}>
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player('/first.mp4'));
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  load.mockClear();
  const providerStates: Array<string | null> = [];
  const unsubscribe = handle.current?.subscribe((state) =>
    providerStates.push(state.provider)
  );
  providerStates.length = 0;

  rerender(player('/second.mp4'));
  await waitFor(() => expect(load).toHaveBeenCalled());
  await Promise.resolve();

  expect(load).toHaveBeenCalledOnce();
  expect(providerStates).toEqual(expect.arrayContaining(['native']));
  expect(providerStates.lastIndexOf(null)).toBeLessThan(
    providerStates.indexOf('native')
  );
  expect(handle.current?.getState().provider).toBe('native');
  unsubscribe?.();
});

test('destroys the previous native adapter and ignores its stale events on source switch', async () => {
  const removeEventListener = vi.spyOn(
    HTMLMediaElement.prototype,
    'removeEventListener'
  );
  const player = (source: string) => (
    <LegacyRoot source={source}>
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );
  const { rerender } = render(player('/first.mp4'));
  const previousMedia = screen.getByLabelText('Reely media');

  rerender(player('/second.mp4'));
  expect(removeEventListener).toHaveBeenCalledWith(
    'play',
    expect.any(Function)
  );
  await Promise.resolve();
  const currentMedia = screen.getByLabelText('Reely media');
  expect(currentMedia).not.toBe(previousMedia);

  fireEvent.play(previousMedia);
  expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();

  fireEvent.play(currentMedia);
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined();
});

const posterPrimitives = Player as typeof Player & {
  Poster: (props: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
    [attribute: string]: unknown;
  }) => React.ReactNode;
  PosterImage: (props: {
    src?: string;
    srcSet?: string;
    sizes?: string;
    width?: number | string;
    height?: number | string;
    loading?: 'eager' | 'lazy';
    fetchPriority?: 'high' | 'low' | 'auto';
    decoding?: 'async' | 'sync' | 'auto';
    objectFit?: React.CSSProperties['objectFit'];
    objectPosition?: React.CSSProperties['objectPosition'];
    onLoad?: () => void;
    onError?: () => void;
    [attribute: string]: unknown;
  }) => React.ReactNode;
  normalizePoster: (input: unknown) => unknown;
};

test('renders opaque custom and native picture posters in the decorative layer', () => {
  const renderSpy = vi.fn();
  const marker = {};
  const CustomPoster = ({ marker: receivedMarker }: { marker: object }) => {
    renderSpy(receivedMarker);
    return <span data-custom-poster />;
  };
  const { Poster } = posterPrimitives;

  const { container } = render(
    <Player.Root source="/clip.mp4">
      <Player.Viewport data-viewport-marker style={{ color: 'red' }}>
        <Player.Media />
        <Poster
          style={{
            position: 'fixed',
            inset: 12,
            width: 320,
            height: 180,
            zIndex: 999,
            pointerEvents: 'auto',
            visibility: 'collapse',
            transform: 'translateX(100px)'
          }}
        >
          <CustomPoster marker={marker} />
          <picture data-native-picture>
            <source media="(min-width: 800px)" srcSet="/wide.jpg 2x" />
            <img alt="" src="/small.jpg" />
          </picture>
        </Poster>
      </Player.Viewport>
    </Player.Root>
  );

  const viewport = container.querySelector('[data-reely-part="viewport"]');
  const poster = container.querySelector('[data-reely-part="poster"]');
  const media = screen.getByLabelText('Reely media');
  const picture = container.querySelector('picture[data-native-picture]');

  expect(renderSpy).toHaveBeenCalledExactlyOnceWith(marker);
  expect((viewport as HTMLElement).style.position).toBe('relative');
  expect((viewport as HTMLElement).style.overflow).toBe('hidden');
  expect(media.getAttribute('data-reely-part')).toBe('media');
  expect(media.style.position).toBe('relative');
  expect(media.style.zIndex).toBe('0');
  expect(poster?.getAttribute('aria-hidden')).toBe('true');
  expect(poster?.getAttribute('data-state')).toBe('visible');
  // #89: the layer's geometry is a *default*, not an invariant — every static
  // property below is the consumer's value, not the primitive's. `visibility`
  // is the exception and is the point of the exception: it is derived from
  // `posterState`, so overriding it would not be overriding layout, it would
  // be pinning a state machine open and permanently defeating the hide.
  expect((poster as HTMLElement).style).toMatchObject({
    position: 'fixed',
    inset: '12px',
    width: '320px',
    height: '180px',
    zIndex: '999',
    pointerEvents: 'auto',
    visibility: 'visible',
    transform: 'translateX(100px)'
  });
  expect(poster?.getAttribute('style')).not.toContain('background-image');
  expect(picture?.outerHTML).toBe(
    '<picture data-native-picture="true"><source media="(min-width: 800px)" srcset="/wide.jpg 2x"><img alt="" src="/small.jpg"></picture>'
  );
});

test('normalizes poster inputs without altering consumer priority choices', () => {
  const responsive = {
    src: '/poster.jpg',
    srcSet: '/poster-2x.jpg 2x',
    sizes: '100vw',
    width: 1600,
    height: 900,
    loading: 'lazy' as const,
    fetchPriority: 'high' as const,
    decoding: 'async' as const,
    objectFit: 'contain' as const,
    objectPosition: 'top' as const
  };
  const element = (
    <picture>
      <img alt="" src="/native.jpg" />
    </picture>
  );
  const { normalizePoster } = posterPrimitives;

  expect(normalizePoster('/poster.jpg')).toEqual({
    type: 'image',
    props: { src: '/poster.jpg' }
  });
  expect(normalizePoster(responsive)).toEqual({
    type: 'image',
    props: responsive
  });
  expect((normalizePoster(responsive) as { props: object }).props).not.toBe(
    responsive
  );
  expect(normalizePoster(element)).toEqual({ type: 'custom', element });
  expect((normalizePoster(element) as { element: object }).element).toBe(
    element
  );
});

test('tracks poster image request state and preserves its explicit image attributes', () => {
  const onLoad = vi.fn();
  const onError = vi.fn();
  const { PosterImage } = posterPrimitives;
  const { container, rerender } = render(<PosterImage />);
  const image = container.querySelector('img')!;

  expect(image.getAttribute('alt')).toBe('');
  expect(image.getAttribute('data-reely-part')).toBe('poster-image');
  expect(image.getAttribute('data-state')).toBe('idle');
  expect(image.style).toMatchObject({
    display: 'block',
    width: '100%',
    height: '100%'
  });
  expect(image.style.objectFit).toBe('var(--reely-poster-fit, cover)');
  expect(image.style.objectPosition).toBe(
    'var(--reely-poster-position, center)'
  );

  rerender(
    <PosterImage
      alt="consumer text"
      decoding="async"
      fetchPriority="high"
      height={900}
      loading="lazy"
      onError={onError}
      onLoad={onLoad}
      sizes="100vw"
      src="/poster.jpg"
      srcSet="/poster-2x.jpg 2x"
      width={1600}
    />
  );
  expect(image.getAttribute('alt')).toBe('');
  expect(image.getAttribute('data-state')).toBe('loading');
  expect(image.getAttribute('srcset')).toBe('/poster-2x.jpg 2x');
  expect(image.getAttribute('sizes')).toBe('100vw');
  expect(image.getAttribute('fetchpriority')).toBe('high');
  fireEvent.load(image);
  expect(image.getAttribute('data-state')).toBe('loaded');
  expect(onLoad).toHaveBeenCalledOnce();

  rerender(
    <PosterImage
      objectFit="contain"
      objectPosition="top"
      onError={onError}
      src="/replacement.jpg"
      srcSet="/replacement-2x.jpg 2x"
    />
  );
  expect(image.getAttribute('data-state')).toBe('loading');
  expect(image.style.objectFit).toBe('contain');
  expect(image.style.objectPosition).toBe('top');
  fireEvent.error(image);
  expect(image.getAttribute('data-state')).toBe('error');
  expect(onError).toHaveBeenCalledOnce();
});

test('resolves a cached poster image whose load fired before the handler attached', () => {
  const { PosterImage } = posterPrimitives;
  // Simulate the browser's cached-image path: the <img> is already complete
  // (and decoded) by the time React attaches onLoad, so no load event fires.
  const completeSpy = vi
    .spyOn(HTMLImageElement.prototype, 'complete', 'get')
    .mockReturnValue(true);
  const naturalWidthSpy = vi
    .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
    .mockReturnValue(1280);
  try {
    const { container } = render(<PosterImage src="/cached.jpg" />);
    const image = container.querySelector('img')!;
    expect(image.getAttribute('data-state')).toBe('loaded');
  } finally {
    completeSpy.mockRestore();
    naturalWidthSpy.mockRestore();
  }
});

test('marks a cached but broken poster image as error', () => {
  const { PosterImage } = posterPrimitives;
  const completeSpy = vi
    .spyOn(HTMLImageElement.prototype, 'complete', 'get')
    .mockReturnValue(true);
  const naturalWidthSpy = vi
    .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
    .mockReturnValue(0);
  try {
    const { container } = render(<PosterImage src="/broken.jpg" />);
    const image = container.querySelector('img')!;
    expect(image.getAttribute('data-state')).toBe('error');
  } finally {
    completeSpy.mockRestore();
    naturalWidthSpy.mockRestore();
  }
});

test('hides the poster only for confirmed playback or the current media frame', async () => {
  const { Poster } = posterPrimitives;
  const handle = createRef<Player.PlayerHandle>();
  const player = (source: string) => (
    <Player.Root ref={handle} source={source}>
      <Player.Viewport>
        <Player.Media />
        <Poster>
          <span>Poster</span>
        </Poster>
      </Player.Viewport>
    </Player.Root>
  );
  const { rerender } = render(player('/first.mp4'));
  const firstMedia = screen.getByLabelText<HTMLVideoElement>('Reely media');
  const poster = screen.getByText('Poster').parentElement!;

  expect(poster.getAttribute('data-state')).toBe('visible');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  await handle.current?.play();
  expect(poster.getAttribute('data-state')).toBe('visible');
  fireEvent.play(firstMedia);
  expect(poster.getAttribute('data-state')).toBe('hidden');

  rerender(player('/second.mp4'));
  const secondMedia = screen.getByLabelText<HTMLVideoElement>('Reely media');
  expect(poster.getAttribute('data-state')).toBe('visible');
  fireEvent.loadedData(firstMedia);
  expect(poster.getAttribute('data-state')).toBe('visible');
  fireEvent.loadedData(secondMedia);
  expect(poster.getAttribute('data-state')).toBe('hidden');
});

test('detached media loadeddata cannot hide the poster', () => {
  const { Poster } = posterPrimitives;
  const player = (showMedia: boolean) => (
    <Player.Root source="/clip.mp4">
      <Player.Viewport>
        {showMedia ? <Player.Media /> : null}
        <Poster>
          <span>Detached media poster</span>
        </Poster>
      </Player.Viewport>
    </Player.Root>
  );
  const { rerender } = render(player(true));
  const detachedMedia = screen.getByLabelText('Reely media');
  const poster = screen.getByText('Detached media poster').parentElement!;
  expect(poster.getAttribute('data-state')).toBe('visible');

  rerender(player(false));
  expect(screen.queryByLabelText('Reely media')).toBeNull();
  fireEvent.loadedData(detachedMedia);

  expect(poster.getAttribute('data-state')).toBe('visible');
});

test('shows the poster synchronously for every A to B to A source transition', () => {
  const { Poster } = posterPrimitives;
  const player = (source: string) => (
    <Player.Root source={source}>
      <Player.Viewport>
        <Player.Media />
        <Poster>
          <span>Transition poster</span>
        </Poster>
      </Player.Viewport>
    </Player.Root>
  );
  const { rerender } = render(player('/first.mp4'));
  const poster = screen.getByText('Transition poster').parentElement!;

  fireEvent.loadedData(screen.getByLabelText('Reely media'));
  expect(poster.getAttribute('data-state')).toBe('hidden');

  rerender(player('/second.mp4'));
  expect(poster.getAttribute('data-state')).toBe('visible');

  rerender(player('/first.mp4'));
  expect(poster.getAttribute('data-state')).toBe('visible');
  fireEvent.loadedData(screen.getByLabelText('Reely media'));
  expect(poster.getAttribute('data-state')).toBe('hidden');
});

test('keeps the committed poster lifecycle through an abandoned source render', async () => {
  const suspendedForever = new Promise<never>(() => undefined);
  let attemptedSecondSource = false;
  const SuspendForSecondSource = ({ source }: { source: string }) => {
    if (source === '/second.mp4') {
      attemptedSecondSource = true;
      throw suspendedForever;
    }
    return null;
  };
  const { Poster } = posterPrimitives;
  const player = (source: string) => (
    <Player.Root source={source}>
      <Suspense fallback={<span>Suspended source</span>}>
        <Player.Viewport>
          <Player.Media />
          <Poster>
            <span>Concurrent poster</span>
          </Poster>
          <SuspendForSecondSource source={source} />
        </Player.Viewport>
      </Suspense>
    </Player.Root>
  );
  const { rerender } = render(player('/first.mp4'));
  const committedMedia = screen.getByLabelText<HTMLVideoElement>('Reely media');
  const poster = screen.getByText('Concurrent poster').parentElement!;

  await act(async () => {
    startTransition(() => rerender(player('/second.mp4')));
  });

  expect(attemptedSecondSource).toBe(true);
  expect(screen.queryByText('Suspended source')).toBeNull();
  expect(screen.getByLabelText('Reely media')).toBe(committedMedia);
  fireEvent.loadedData(committedMedia);
  expect(poster.getAttribute('data-state')).toBe('hidden');

  await act(async () => {
    startTransition(() => rerender(player('/first.mp4')));
  });
  expect(poster.getAttribute('data-state')).toBe('hidden');
});

test('hides the poster when attached media already has current data', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2);
  const { Poster } = posterPrimitives;

  render(
    <Player.Root source="/cached.mp4">
      <Player.Viewport>
        <Player.Media />
        <Poster>
          <span>Cached poster</span>
        </Poster>
      </Player.Viewport>
    </Player.Root>
  );

  expect(
    screen.getByText('Cached poster').parentElement?.getAttribute('data-state')
  ).toBe('hidden');
});

test('keeps poster lifecycle listeners correct through StrictMode replay', () => {
  const { Poster } = posterPrimitives;
  render(
    <StrictMode>
      <Player.Root source="/strict.mp4">
        <Player.Viewport>
          <Player.Media />
          <Poster>
            <span>Strict poster</span>
          </Poster>
        </Player.Viewport>
      </Player.Root>
    </StrictMode>
  );

  fireEvent.loadedData(screen.getByLabelText('Reely media'));
  expect(
    screen.getByText('Strict poster').parentElement?.getAttribute('data-state')
  ).toBe('hidden');
});

test('forwards nativePoster only to native videos and server-renders poster markup', () => {
  const { Poster, PosterImage } = posterPrimitives;
  const player = (
    source: Player.RootProps['source'],
    nativePoster?: string
  ) => (
    <LegacyRoot source={source}>
      <Player.Media nativePoster={nativePoster} />
    </LegacyRoot>
  );
  const { rerender } = render(player('/clip.mp4', '/fallback.jpg'));

  expect(screen.getByLabelText('Reely media').getAttribute('poster')).toBe(
    '/fallback.jpg'
  );
  rerender(player('/clip.mp4', '/updated.jpg'));
  expect(screen.getByLabelText('Reely media').getAttribute('poster')).toBe(
    '/updated.jpg'
  );
  rerender(player({ type: 'hls', src: '/master.m3u8' }, '/fallback.jpg'));
  expect(screen.getByLabelText('Reely media').getAttribute('poster')).toBe(
    '/fallback.jpg'
  );
  rerender(
    player({ type: 'youtube', videoId: 'dQw4w9WgXcQ' }, '/fallback.jpg')
  );
  expect(screen.queryByLabelText('Reely media')).toBeNull();

  const markup = renderToString(
    <Player.Root source="/server.mp4">
      <Player.Viewport>
        <Player.Media />
        <Poster>
          <PosterImage
            sizes="100vw"
            src="/server.jpg"
            srcSet="/server-2x.jpg 2x"
          />
        </Poster>
      </Player.Viewport>
    </Player.Root>
  );
  expect(markup).toContain('data-reely-part="viewport"');
  expect(markup).toContain('data-reely-part="poster"');
  expect(markup).toContain('data-reely-part="poster-image"');
  expect(markup).toContain('srcSet="/server-2x.jpg 2x"');
  expect(markup).toContain('sizes="100vw"');
  expect(markup).toContain('alt=""');
});

test('forwards a ref, custom attributes, style, and aria-label to the native video', () => {
  const ref = createRef<HTMLVideoElement>();
  render(
    <LegacyRoot source="/clip.mp4">
      <Player.Media
        aria-label="Main video"
        className="hero-video"
        id="hero"
        ref={ref}
        style={{ opacity: 0.5 }}
      />
    </LegacyRoot>
  );

  const video = ref.current!;
  expect(video.tagName).toBe('VIDEO');
  expect(video.getAttribute('aria-label')).toBe('Main video');
  expect(video.className).toBe('hero-video');
  expect(video.id).toBe('hero');
  expect(video.style.opacity).toBe('0.5');
  // Library-owned attributes remain intact alongside the passthrough.
  expect(video.getAttribute('data-reely-part')).toBe('media');
});

test('renders the controls attribute on the native video when controls is true', () => {
  render(
    <LegacyRoot controls source="/clip.mp4">
      <Player.Media />
    </LegacyRoot>
  );

  const video = screen.getByLabelText<HTMLVideoElement>('Reely media');
  expect(video.controls).toBe(true);
});

test('omits the controls attribute on the native video when controls is unset', () => {
  render(
    <LegacyRoot source="/clip.mp4">
      <Player.Media />
    </LegacyRoot>
  );

  const video = screen.getByLabelText<HTMLVideoElement>('Reely media');
  expect(video.controls).toBe(false);
});

test('toggles the video controls attribute across a re-render without re-attaching the native provider', async () => {
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined);
  const player = (controls: boolean) => (
    <LegacyRoot controls={controls} source="/clip.mp4">
      <Player.Media />
    </LegacyRoot>
  );
  const { rerender } = render(player(true));
  const video = screen.getByLabelText<HTMLVideoElement>('Reely media');
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  expect(video.controls).toBe(true);
  load.mockClear();

  rerender(player(false));

  expect(video.controls).toBe(false);
  // No re-attach: the native provider has no bag of its own -- `controls`
  // reaches the element as a DOM attribute, not through the provider-options
  // comparison that would tear it down and rebuild it.
  await act(async () => undefined);
  expect(load).not.toHaveBeenCalled();
});

test('sizes the native video to fill its viewport and letterbox by default', () => {
  // #150: stated inline, so a consumer who ships no stylesheet gets the same
  // frame the theme draws. `style-precedence.test.tsx` pins that each of these
  // is overridable.
  render(
    <LegacyRoot source="/clip.mp4">
      <Player.Media />
    </LegacyRoot>
  );

  const video = screen.getByLabelText('Reely media');
  expect(video.style.position).toBe('relative');
  expect(video.style.zIndex).toBe('0');
  // Inline-level by default, which would hang a descender gap below the frame.
  expect(video.style.display).toBe('block');
  expect(video.style.width).toBe('100%');
  expect(video.style.height).toBe('100%');
  // The frame is content, not decoration, so the default letterboxes.
  expect(video.style.objectFit).toBe('contain');
});

test('an inline ref on Media does not reload the provider on parent re-renders', () => {
  const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load');
  const Harness = () => {
    const [tick, setTick] = useState(0);
    return (
      <div>
        <button onClick={() => setTick((value) => value + 1)}>tick</button>
        <LegacyRoot source="/clip.mp4">
          <Player.Media data-tick={tick} ref={() => undefined} />
        </LegacyRoot>
      </div>
    );
  };
  const { getByText } = render(<Harness />);
  const loadsAfterMount = loadSpy.mock.calls.length;

  fireEvent.click(getByText('tick'));
  fireEvent.click(getByText('tick'));
  fireEvent.click(getByText('tick'));

  // A volatile consumer ref must not churn the internal media registration,
  // which would tear down and reload the provider on every render.
  expect(loadSpy.mock.calls.length).toBe(loadsAfterMount);
});

test('forwards a ref to the poster container', () => {
  const { Poster } = posterPrimitives;
  const ref = createRef<HTMLDivElement>();
  render(
    <Poster ref={ref}>
      <span>Poster</span>
    </Poster>
  );
  expect(ref.current?.getAttribute('data-reely-part')).toBe('poster');
});

test('tolerates an inline callback ref through unrelated parent re-renders', () => {
  const observerInstances: unknown[] = [];
  class ManualIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly scrollMargin = '0px';
    readonly thresholds = [0];
    constructor() {
      observerInstances.push(this);
    }
    disconnect = () => undefined;
    observe = () => undefined;
    takeRecords = () => [];
    unobserve = () => undefined;
  }
  vi.stubGlobal('IntersectionObserver', ManualIntersectionObserver);

  const Harness = () => {
    const [tick, setTick] = useState(0);
    return (
      <div>
        <button onClick={() => setTick((value) => value + 1)}>tick</button>
        <Player.Root loading="viewport" source="/clip.mp4">
          <Player.Viewport data-tick={tick} ref={() => undefined}>
            <Player.Media />
          </Player.Viewport>
        </Player.Root>
      </div>
    );
  };

  const { getByText } = render(<Harness />);
  expect(() => {
    fireEvent.click(getByText('tick'));
    fireEvent.click(getByText('tick'));
    fireEvent.click(getByText('tick'));
  }).not.toThrow();
  expect(observerInstances).toHaveLength(1);
});

test('issues no autoplay play before the provider load when metadata is already present', async () => {
  // The end-to-end shape of #87, driven through the real native provider
  // rather than a fake: `provider-native.attach()` calls `emitMediaState()`
  // synchronously, which reports `ready` off `readyState >= HAVE_METADATA`.
  // The controller only queues `load()` after `attach()` returns, so an
  // autoplay play issued during the attach tick lands first and `load()` then
  // aborts it, per the HTML media spec.
  //
  // Reproducing needs metadata present BEFORE the provider attaches — a local
  // fixture served directly rather than a throttled or mocked response. That
  // latency difference is why the sibling defect (#86) survived so long.
  const calls: string[] = [];
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {
    calls.push('load');
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    calls.push('play');
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });

  render(
    <LegacyRoot autoplay="audible" source="/tracer.mp4">
      <Player.Media />
      <Player.PlayButton />
    </LegacyRoot>
  );

  await waitFor(() =>
    expect(screen.getByRole('button').dataset.autoplayState).toBe('started')
  );
  expect(calls).toEqual(['load', 'play']);
});

// #69: the awaitable is only useful if consumers can reach it. `PlayerHandle`
// is an explicit Pick, so omitting it there would leave `whenReady` reachable
// only by constructing a PlayerController by hand.
test('exposes whenReady on the imperative handle and on player actions', () => {
  const handle = createRef<Player.PlayerHandle>();

  const Probe = (): React.ReactElement => {
    const actions = Player.usePlayerActions();
    return <span data-testid="probe">{typeof actions.whenReady}</span>;
  };

  render(
    <Player.Root ref={handle} source="/fixtures/clip.mp4">
      <Probe />
    </Player.Root>
  );

  expect(typeof handle.current?.whenReady).toBe('function');
  expect(screen.getByTestId('probe').textContent).toBe('function');
});
