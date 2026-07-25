import { vi, type Mock } from 'vitest';
import type {
  VimeoSdkConstructor,
  VimeoSdkEventListener,
  VimeoSdkPlayer,
  VimeoSdkTextTrack
} from '../../src/loader';

export type FakePlayerOptions = {
  readonly duration?: number;
  readonly muted?: boolean;
  readonly volume?: number;
  readonly playbackRate?: number;
  readonly textTracks?: ReadonlyArray<VimeoSdkTextTrack>;
  readonly ready?: () => Promise<void>;
  readonly play?: () => Promise<unknown>;
  readonly setVolume?: (volume: number) => Promise<unknown>;
  readonly setPlaybackRate?: (rate: number) => Promise<unknown>;
  readonly requestFullscreen?: () => Promise<unknown>;
  readonly requestPictureInPicture?: () => Promise<unknown>;
};

export class FakeVimeoPlayer implements VimeoSdkPlayer {
  readonly element: HTMLIFrameElement;
  destroyed = false;
  muted: boolean;
  volume: number;
  playbackRate: number;
  readonly #options: FakePlayerOptions;
  readonly #listeners = new Map<string, Set<VimeoSdkEventListener>>();
  #textTracks: ReadonlyArray<VimeoSdkTextTrack>;

  constructor(element: HTMLIFrameElement, options: FakePlayerOptions) {
    this.element = element;
    this.#options = options;
    this.muted = options.muted ?? false;
    this.volume = options.volume ?? 1;
    this.playbackRate = options.playbackRate ?? 1;
    this.#textTracks = options.textTracks ?? [];
  }

  // Lets tests simulate Vimeo's track list changing after ready (e.g. a
  // texttrackchange for a track that wasn't part of the initial discovery).
  setTextTracks(tracks: ReadonlyArray<VimeoSdkTextTrack>): void {
    this.#textTracks = tracks;
  }

  emit(event: string, data?: unknown): void {
    this.#listeners.get(event)?.forEach((listener) => listener(data));
  }

  on = (event: string, listener: VimeoSdkEventListener): void => {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  };

  off = (event: string, listener?: VimeoSdkEventListener): void => {
    if (!listener) {
      this.#listeners.delete(event);
      return;
    }
    this.#listeners.get(event)?.delete(listener);
  };

  ready: Mock<() => Promise<void>> = vi.fn(
    () => this.#options.ready?.() ?? Promise.resolve()
  );

  destroy: Mock<() => Promise<void>> = vi.fn(() => {
    this.destroyed = true;
    this.element.remove();
    return Promise.resolve();
  });

  play: Mock<() => Promise<unknown>> = vi.fn(
    () => this.#options.play?.() ?? Promise.resolve()
  );

  pause: Mock<() => Promise<unknown>> = vi.fn(() => Promise.resolve());

  setCurrentTime: Mock<(seconds: number) => Promise<unknown>> = vi.fn(
    (seconds) => Promise.resolve(seconds)
  );

  getCurrentTime: Mock<() => Promise<number>> = vi.fn(() => Promise.resolve(0));

  getDuration: Mock<() => Promise<number>> = vi.fn(() =>
    Promise.resolve(this.#options.duration ?? 60)
  );

  getMuted: Mock<() => Promise<boolean>> = vi.fn(() =>
    Promise.resolve(this.muted)
  );

  setMuted: Mock<(muted: boolean) => Promise<unknown>> = vi.fn((muted) => {
    this.muted = muted;
    return Promise.resolve(muted);
  });

  getVolume: Mock<() => Promise<number>> = vi.fn(() =>
    Promise.resolve(this.volume)
  );

  setVolume: Mock<(volume: number) => Promise<unknown>> = vi.fn((volume) => {
    if (this.#options.setVolume) return this.#options.setVolume(volume);
    this.volume = volume;
    return Promise.resolve(volume);
  });

  getPlaybackRate: Mock<() => Promise<number>> = vi.fn(() =>
    Promise.resolve(this.playbackRate)
  );

  setPlaybackRate: Mock<(rate: number) => Promise<unknown>> = vi.fn((rate) => {
    if (this.#options.setPlaybackRate)
      return this.#options.setPlaybackRate(rate);
    this.playbackRate = rate;
    return Promise.resolve(rate);
  });

  getTextTracks: Mock<() => Promise<ReadonlyArray<VimeoSdkTextTrack>>> = vi.fn(
    () => Promise.resolve(this.#textTracks)
  );

  enableTextTrack: Mock<
    (language: string, kind?: string, showing?: boolean) => Promise<unknown>
  > = vi.fn(() => Promise.resolve());

  disableTextTrack: Mock<() => Promise<unknown>> = vi.fn(() =>
    Promise.resolve()
  );

  requestFullscreen: Mock<() => Promise<unknown>> = vi.fn(
    () => this.#options.requestFullscreen?.() ?? Promise.resolve()
  );

  exitFullscreen: Mock<() => Promise<unknown>> = vi.fn(() => Promise.resolve());

  getFullscreen: Mock<() => Promise<boolean>> = vi.fn(() =>
    Promise.resolve(false)
  );

  requestPictureInPicture: Mock<() => Promise<unknown>> = vi.fn(
    () => this.#options.requestPictureInPicture?.() ?? Promise.resolve()
  );

  exitPictureInPicture: Mock<() => Promise<unknown>> = vi.fn(() =>
    Promise.resolve()
  );

  getPictureInPicture: Mock<() => Promise<boolean>> = vi.fn(() =>
    Promise.resolve(false)
  );
}

export type FakeSdk = {
  readonly Sdk: VimeoSdkConstructor;
  readonly instances: FakeVimeoPlayer[];
};

export const createFakeSdk = (options: FakePlayerOptions = {}): FakeSdk => {
  const instances: FakeVimeoPlayer[] = [];
  const Sdk = function (this: unknown, element: HTMLIFrameElement) {
    const player = new FakeVimeoPlayer(element, options);
    instances.push(player);
    return player;
  } as unknown as VimeoSdkConstructor;
  return { Sdk, instances };
};

export const namedError = (name: string, message: string): Error =>
  Object.assign(new Error(message), { name });
