import type {
  HlsConfigLike,
  HlsInstanceLike,
  HlsLevelLike,
  HlsParsedCueLike,
  HlsSubtitleTrackLike
} from '../../src/index';

type FakeHlsListener = (event: string, data: unknown) => void;

export class FakeHls implements HlsInstanceLike {
  static instances: FakeHls[] = [];
  static supported = true;
  static readonly Events = {
    ERROR: 'hlsError',
    LEVEL_SWITCHED: 'hlsLevelSwitched',
    LEVEL_UPDATED: 'hlsLevelUpdated',
    LEVELS_UPDATED: 'hlsLevelsUpdated',
    MANIFEST_PARSED: 'hlsManifestParsed',
    SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
    SUBTITLE_TRACK_SWITCH: 'hlsSubtitleTrackSwitch',
    CUES_PARSED: 'hlsCuesParsed'
  };
  static readonly ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError'
  };
  static isSupported = (): boolean => FakeHls.supported;
  static reset = (): void => {
    FakeHls.instances = [];
    FakeHls.supported = true;
  };

  levels: HlsLevelLike[] = [];
  currentLevel = -1;
  liveSyncPosition: number | null = null;
  destroyed = false;
  attachedMedia: HTMLMediaElement | undefined;
  loadedSource: string | undefined;
  startLoadCalls = 0;
  recoverMediaErrorCalls = 0;
  swapAudioCodecCalls = 0;
  subtitleTracks: HlsSubtitleTrackLike[] = [];
  config: HlsConfigLike | undefined;
  readonly #listeners = new Map<string, Set<FakeHlsListener>>();

  constructor(config?: HlsConfigLike) {
    this.config = config;
    FakeHls.instances.push(this);
  }

  // Mirrors the real hls.js `subtitleTrack` getter/setter: switching tracks
  // fires `SUBTITLE_TRACK_SWITCH`. With `renderTextTracksNatively: false`
  // (what the provider constructs this with, see index.ts's `startHlsJs`),
  // real hls.js does not touch `media.textTracks` for this at all — it only
  // starts loading/parsing the newly selected subtitle's fragments, whose
  // cues later arrive via `CUES_PARSED` (drive that with `emitCuesParsed`).
  #subtitleTrack = -1;

  get subtitleTrack(): number {
    return this.#subtitleTrack;
  }

  set subtitleTrack(value: number) {
    this.#subtitleTrack = value;
    this.emit(FakeHls.Events.SUBTITLE_TRACK_SWITCH, { id: value });
  }

  emitSubtitleTracksUpdated = (): void => {
    this.emit(FakeHls.Events.SUBTITLE_TRACKS_UPDATED, {
      subtitleTracks: this.subtitleTracks
    });
  };

  emitCuesParsed = (
    cues: readonly HlsParsedCueLike[],
    type: 'captions' | 'subtitles' = 'subtitles'
  ): void => {
    this.emit(FakeHls.Events.CUES_PARSED, { type, cues, track: 'default' });
  };

  on = (event: string, listener: FakeHlsListener): void => {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  };

  emit = (event: string, data: unknown): void => {
    this.#listeners.get(event)?.forEach((listener) => listener(event, data));
  };

  emitFatalError = (type: string, details = 'fatal'): void => {
    this.emit(FakeHls.Events.ERROR, { type, details, fatal: true });
  };

  emitLevelUpdated = (live: boolean, liveSyncPosition?: number): void => {
    if (liveSyncPosition !== undefined)
      this.liveSyncPosition = liveSyncPosition;
    this.emit(FakeHls.Events.LEVEL_UPDATED, { details: { live } });
  };

  // Fired by real hls.js when the level *array* changes — notably when
  // `removeLevel` prunes a rung after repeated errors. Distinct from
  // `emitLevelUpdated` above, whose event carries one level's details.
  emitLevelsUpdated = (): void => {
    this.emit(FakeHls.Events.LEVELS_UPDATED, { levels: this.levels });
  };

  startLoad = (): void => {
    this.startLoadCalls += 1;
  };

  recoverMediaError = (): void => {
    this.recoverMediaErrorCalls += 1;
  };

  swapAudioCodec = (): void => {
    this.swapAudioCodecCalls += 1;
  };

  attachMedia = (media: HTMLMediaElement): void => {
    this.attachedMedia = media;
  };

  loadSource = (url: string): void => {
    this.loadedSource = url;
  };

  destroy = (): void => {
    this.destroyed = true;
    this.#listeners.clear();
  };
}

export const fakeHlsLoader = () => {
  let calls = 0;
  const loadHls = async () => {
    calls += 1;
    return { default: FakeHls };
  };
  return { loadHls, calls: () => calls };
};
