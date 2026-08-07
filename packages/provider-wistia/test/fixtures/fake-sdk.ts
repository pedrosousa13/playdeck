import { vi, type Mock } from 'vitest';
import type { WistiaPlayerApi, WistiaPlayerState } from '../../src/loader';

// Aurora's element events. Every name here has been observed firing on a live
// player — see `e2e/wistia-smoke.spec.ts`, which exists because this fixture
// and the adapter would otherwise agree on a name neither had ever seen.
export const WISTIA_EVENTS = {
  apiReady: 'api-ready',
  cancelFullscreen: 'cancel-fullscreen',
  ended: 'ended',
  enterFullscreen: 'enter-fullscreen',
  // Absent from that e2e spec, and it does not need to be there: unlike the
  // names the runtime engine dispatches, this one is built by the shipped
  // bundle itself (`WistiaPlayer.tsx:2628`, out of the media data it has just
  // fetched), so the literal is readable from the installed package.
  loadedMediaData: 'loaded-media-data',
  loadedMetadata: 'loaded-metadata',
  muteChange: 'mute-change',
  pause: 'pause',
  play: 'play',
  rateChange: 'rate-change',
  seeked: 'seeked',
  seeking: 'seeking',
  timeUpdate: 'time-update',
  volumeChange: 'volume-change'
} as const;

// `time` and `volume` are overloaded getter/setter pairs, and `Mock<T>`
// resolves an overloaded `T` to its last signature only. The declared type is
// therefore the handle's own signature — so the fake still has to match
// Wistia's declaration — intersected with the spy surface the assertions read.
type OverloadedMock<Signature> = Signature & Mock<(value?: number) => unknown>;

export type FakePlayerOptions = {
  readonly duration?: number;
  readonly muted?: boolean;
  readonly volume?: number;
  readonly playbackRate?: number;
  readonly state?: WistiaPlayerState;
  readonly videoWidth?: number;
  readonly videoHeight?: number;
  // Which of the three handle properties the element exposes. 0.7.12 uses
  // `deprecatedApiDoNotUse`; the other two exist so the read order is proven.
  readonly apiProperty?: 'api' | 'wistiaApi' | 'deprecatedApiDoNotUse';
  // The `mediaData` the element carries on its `loaded-media-data` event.
  // Typed loosely on purpose: the adapter has to survive a payload with no
  // `mediaType`, which Wistia's own declaration allows, and a media data it
  // never receives at all — which is what leaving this undefined models.
  readonly mediaData?: unknown;
  // Holds `api-ready` back so a test can decide when the handle appears.
  readonly deferApiReady?: boolean;
  readonly play?: () => unknown;
  readonly time?: (newTime: number) => unknown;
  readonly volumeCommand?: (volume: number) => unknown;
  readonly playbackRateCommand?: (rate: number) => unknown;
  readonly requestFullscreen?: () => unknown;
};

// Aurora's handle. Every method is synchronous, and the return values are the
// ones `PublicApi` declares: `play`/`pause`/`mute` answer the handle itself,
// `unmute`/`requestFullscreen`/`cancelFullscreen`/`remove` answer nothing, and
// the getter/setter pairs answer a number or the handle depending on arity.
export class FakeWistiaApi implements WistiaPlayerApi {
  removed = false;
  currentTime = 0;
  #options: FakePlayerOptions;
  #muted: boolean;
  #volume: number;
  #playbackRate: number;
  #state: WistiaPlayerState;

  constructor(options: FakePlayerOptions) {
    this.#options = options;
    this.#muted = options.muted ?? false;
    this.#volume = options.volume ?? 1;
    this.#playbackRate = options.playbackRate ?? 1;
    this.#state = options.state ?? 'beforeplay';
  }

  play: Mock<WistiaPlayerApi['play']> = vi.fn(() => {
    this.#options.play?.();
    this.#state = 'playing';
    return this as unknown as ReturnType<WistiaPlayerApi['play']>;
  });

  pause: Mock<WistiaPlayerApi['pause']> = vi.fn(() => {
    this.#state = 'paused';
    return this as unknown as ReturnType<WistiaPlayerApi['pause']>;
  });

  time: OverloadedMock<WistiaPlayerApi['time']> = vi.fn((newTime?: number) => {
    if (newTime === undefined) return this.currentTime;
    this.#options.time?.(newTime);
    this.currentTime = newTime;
    return this;
  }) as unknown as OverloadedMock<WistiaPlayerApi['time']>;

  mute: Mock<WistiaPlayerApi['mute']> = vi.fn(() => {
    this.#muted = true;
    return this as unknown as ReturnType<WistiaPlayerApi['mute']>;
  });

  unmute: Mock<WistiaPlayerApi['unmute']> = vi.fn(() => {
    this.#muted = false;
  });

  volume: OverloadedMock<WistiaPlayerApi['volume']> = vi.fn(
    (newVolume?: number) => {
      if (newVolume === undefined) return this.#volume;
      this.#options.volumeCommand?.(newVolume);
      this.#volume = newVolume;
      return this;
    }
  ) as unknown as OverloadedMock<WistiaPlayerApi['volume']>;

  playbackRate: Mock<WistiaPlayerApi['playbackRate']> = vi.fn(
    (newRate?: number) => {
      if (newRate === undefined) return this.#playbackRate;
      this.#options.playbackRateCommand?.(newRate);
      this.#playbackRate = newRate;
      return this.#playbackRate;
    }
  );

  duration: Mock<WistiaPlayerApi['duration']> = vi.fn(
    () => this.#options.duration ?? 60
  );

  state: Mock<WistiaPlayerApi['state']> = vi.fn(() => this.#state);

  isMuted: Mock<WistiaPlayerApi['isMuted']> = vi.fn(() => this.#muted);

  requestFullscreen: Mock<WistiaPlayerApi['requestFullscreen']> = vi.fn(() => {
    this.#options.requestFullscreen?.();
  });

  cancelFullscreen: Mock<WistiaPlayerApi['cancelFullscreen']> = vi.fn(
    () => undefined
  );

  videoWidth: Mock<WistiaPlayerApi['videoWidth']> = vi.fn(
    () => this.#options.videoWidth ?? 1920
  );

  videoHeight: Mock<WistiaPlayerApi['videoHeight']> = vi.fn(
    () => this.#options.videoHeight ?? 1080
  );

  remove: Mock<WistiaPlayerApi['remove']> = vi.fn(() => {
    this.removed = true;
  });
}

// The options the next `<wistia-player>` the document creates will adopt. The
// element is built by the adapter through `createElement`, not by the test, so
// its configuration has to reach it through the registry rather than a
// constructor argument.
let nextOptions: FakePlayerOptions = {};
let created: FakeWistiaPlayerElement[] = [];

export class FakeWistiaPlayerElement extends HTMLElement {
  readonly options: FakePlayerOptions;
  // Deliberately not named `api`: 0.7.12's element carries the handle on
  // `deprecatedApiDoNotUse` and on nothing else, so the fixture must not hold
  // a same-named field that would answer a read the real element refuses.
  readonly handle: FakeWistiaApi;

  constructor() {
    super();
    this.options = nextOptions;
    this.handle = new FakeWistiaApi(this.options);
    created.push(this);
  }

  connectedCallback(): void {
    if (this.options.deferApiReady) return;
    // The real element reaches `api-ready` only after it has fetched its media
    // data, so it is never synchronous with the append.
    queueMicrotask(() => {
      if (!this.isConnected) return;
      // Strictly before `api-ready`, which is the order the real element keeps:
      // `WistiaPlayer.tsx:2628` dispatches the media data inside the fetch's
      // own `then`, and only the `#initPlayerEmbed` two statements later
      // eventually reaches the `api-ready` at `:2946`. A fixture that dispatched
      // the two the other way round would let a listener bound after the
      // handshake look correct here and receive nothing on a live player.
      this.emitLoadedMediaData();
      this.becomeApiReady();
    });
  }

  // No-op when the test configured no media data, which models the load that
  // never answers with any — a media-data error, or the legacy-iframe fallback
  // the element takes without dispatching.
  emitLoadedMediaData(): void {
    const { mediaData } = this.options;
    if (mediaData === undefined) return;
    this.emit(WISTIA_EVENTS.loadedMediaData, { mediaData });
  }

  becomeApiReady(): void {
    const property = this.options.apiProperty ?? 'deprecatedApiDoNotUse';
    // Exactly one property carries it, which is what makes the adapter's read
    // order a real question rather than a formality.
    Object.defineProperty(this, property, {
      configurable: true,
      value: this.handle
    });
    this.dispatchEvent(
      new CustomEvent(WISTIA_EVENTS.apiReady, {
        detail: { mediaId: this.getAttribute('media-id') }
      })
    );
  }

  emit(event: string, detail?: unknown): void {
    this.dispatchEvent(
      detail === undefined
        ? new CustomEvent(event)
        : new CustomEvent(event, { detail })
    );
  }
}

export type FakeWistiaSdk = {
  // What the adapter's `loadWistiaPlayer` is mocked to.
  readonly load: () => Promise<CustomElementConstructor>;
  readonly elements: FakeWistiaPlayerElement[];
};

export const installFakeWistiaPlayer = (
  options: FakePlayerOptions = {}
): FakeWistiaSdk => {
  nextOptions = options;
  created = [];
  // A custom-element name can be registered once per window, and vitest shares
  // one window across a file's tests, so the definition is reused rather than
  // redefined.
  if (!customElements.get('wistia-player')) {
    customElements.define('wistia-player', FakeWistiaPlayerElement);
  }
  return {
    load: () =>
      Promise.resolve(
        customElements.get('wistia-player') as CustomElementConstructor
      ),
    elements: created
  };
};

export const namedError = (name: string, message: string): Error =>
  Object.assign(new Error(message), { name });
