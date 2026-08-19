export type {
  AutoplayConfigurationOptions,
  AutoplayMode,
  Availability,
  CaptionRendering,
  Chapter,
  CommandFailureReason,
  CommandResult,
  HlsEngine,
  HlsSource,
  MediaDimensions,
  PlaybackState,
  PlayerCapabilities,
  PlayerError,
  PlayerErrorCategory,
  PlayerEvent,
  PlayerEventDetailMap,
  PlayerEventFor,
  PlayerEventOrigin,
  PlayerEventType,
  PlayerLiveState,
  PlayerProvider,
  PlayerQuality,
  PlayerSource,
  PlayerState,
  PreProviderActivation,
  ProviderAdapter,
  ProviderEvent,
  ProviderEventFor,
  ProviderStateListener,
  ProviderStatePatch,
  RefusedUrlSurface,
  ResolvedPlayerSource,
  SourceDetectionFailure,
  SourceDetectionFailureReason,
  SourceDetectionResult,
  SourceDetectionSuccess,
  TextCue,
  TextTrack,
  TextTrackKind,
  TextTrackReadiness,
  TimeRange,
  VideoFileSource,
  VimeoSource,
  WistiaSource,
  YouTubeSource
} from './types.js';

export { chaptersEqual, deriveChapters } from './chapters.js';

export type { ChapterInput } from './chapters.js';

export { deriveLiveState, liveStateEqual } from './live-state.js';

export type { LiveDerivationInput } from './live-state.js';

// Public because every provider package fans out to its own subscribers and
// owes them the same isolation the controller gives its own (#233). The rest of
// `safety.ts` is controller-internal and stays unexported.
export { notifySafely } from './safety.js';

export {
  detectSource,
  isPermittedSourceUrl,
  isVimeoHash,
  isVimeoVideoId,
  isWistiaMediaId,
  isYouTubeVideoId,
  resolveNetworkPath
} from './source-detection.js';

export { textTrackLabel } from './text-tracks.js';

export { createTimeBoundary } from './time-boundary.js';

export type { TimeBoundary } from './time-boundary.js';

export {
  createInitialPlayerState,
  PlayerController
} from './player-controller.js';

export {
  bindMediaSession,
  getMediaSessionCoordinator
} from './media-session.js';

export type {
  MediaMetadataInput,
  MediaSessionActions,
  MediaSessionArtwork,
  MediaSessionBinding,
  MediaSessionCoordinator,
  MediaSessionLike,
  MediaSessionPositionState,
  MediaSessionRoot,
  MediaSessionRootConfig
} from './media-session.js';
