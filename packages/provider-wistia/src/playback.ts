import type {
  Availability,
  PlayerCapabilities,
  PlaybackState,
  ProviderAdapter,
  ProviderStatePatch
} from '@reely/core';
import {
  available,
  booleanField,
  numberField,
  providerEvent,
  runWistiaCommand,
  type EmitProviderState,
  type IsStalePlayer,
  type WistiaMountElement
} from './adapter-values.js';
import type {
  WistiaMuteChangeDetail,
  WistiaPlayerApi,
  WistiaPlayerState
} from './loader.js';

// Wistia reports `beforeplay` for a player that has never started, which core
// has no separate state for: nothing is playing and nothing has ended.
export const toPlaybackState = (state: WistiaPlayerState): PlaybackState =>
  state === 'playing' || state === 'ended' ? state : 'paused';

// The slice of the handle the transport commands drive and the player-reported
// state changes read: no fullscreen, measurement or teardown access.
export type WistiaPlaybackPlayer = Pick<
  WistiaPlayerApi,
  | 'play'
  | 'pause'
  | 'time'
  | 'mute'
  | 'unmute'
  | 'volume'
  | 'playbackRate'
  | 'duration'
>;

type WistiaPlaybackCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate';

// The player's own values as they read at attach, before any command has run.
export type WistiaPlaybackValues = {
  readonly duration: number | null;
  readonly muted: boolean;
  readonly volume: number;
  readonly playbackRate: number;
};

export type WistiaPlaybackDeps = {
  readonly emit: EmitProviderState;
  readonly isStale: IsStalePlayer;
  readonly getPlayer: () => WistiaPlaybackPlayer | undefined;
  // The host's capabilities snapshot, republished when a command proves a
  // capability this player does not have.
  readonly getCapabilities: () => PlayerCapabilities;
};

// The playback-command seam: the transport commands and the playhead, duration
// and volume the player reports back. Owns the two capabilities only a refused
// command can disprove — Aurora exposes `volume` and `playbackRate` on every
// player and only fails on the platform or media that withholds them.
export type WistiaPlayback = Required<
  Pick<ProviderAdapter, WistiaPlaybackCommand>
> & {
  readonly getCurrentTime: () => number;
  // Adopts the player's own values at attach and pushes the mount element's
  // overrides back into it, returning the patch fragment the attachment seam
  // folds into its ready state.
  readonly adopt: (
    player: Pick<WistiaPlaybackPlayer, 'volume' | 'playbackRate'>,
    values: WistiaPlaybackValues
  ) => ProviderStatePatch;
  readonly handlers: {
    readonly onPlay: (detail?: unknown) => void;
    readonly onPause: (detail?: unknown) => void;
    readonly onEnded: (
      player: Pick<WistiaPlaybackPlayer, 'time'>,
      detail?: unknown
    ) => void;
    readonly onTimeUpdate: (player: Pick<WistiaPlaybackPlayer, 'time'>) => void;
    // No `onSeeking` counterpart: the attachment seam does not bind Wistia's
    // `seeking`, because the live player dispatches it after its own `seeked`.
    readonly onSeeked: (
      player: Pick<WistiaPlaybackPlayer, 'time'>,
      detail?: unknown
    ) => void;
    readonly onVolumeChange: (detail?: unknown) => void;
    // `mute-change` carries `{ isMuted }` alone, so the volume it publishes is
    // the last one the player reported rather than a second read.
    readonly onMuteChange: (detail?: unknown) => void;
    readonly onRateChange: (detail?: unknown) => void;
    readonly onLoadedMetadata: (
      player: Pick<WistiaPlaybackPlayer, 'duration'>
    ) => void;
  };
  // The `setVolume` facet of the host's capabilities.
  readonly setVolumeAvailability: () => Availability;
  // The `setPlaybackRate` facet of the host's capabilities.
  readonly setPlaybackRateAvailability: () => Availability;
};

export const createWistiaPlayback = (
  mount: Pick<WistiaMountElement, 'volume' | 'playbackRate'>,
  { emit, isStale, getPlayer, getCapabilities }: WistiaPlaybackDeps
): WistiaPlayback => {
  let currentTime = 0;
  let duration: number | null = null;
  let volume = 1;
  let muted = false;
  let volumeAvailability: Availability = available;
  let playbackRateAvailability: Availability = available;

  const clampVolume = (level: number): number =>
    Math.min(1, Math.max(0, level));

  const seekTarget = (time: number): number =>
    Math.max(0, duration === null ? time : Math.min(duration, time));

  const readTime = (player: Pick<WistiaPlaybackPlayer, 'time'>): number => {
    const time = player.time();
    return Number.isFinite(time) ? time : currentTime;
  };

  // The state patch carries only what the player actually reported; the
  // provider event carries the whole pair, because core's `volumechange`
  // detail has no way to say "unchanged".
  const publishVolume = (
    nextVolume: number | undefined,
    nextMuted: boolean | undefined,
    detail: unknown
  ): void => {
    if (nextVolume === undefined && nextMuted === undefined) return;
    if (nextVolume !== undefined) volume = nextVolume;
    if (nextMuted !== undefined) muted = nextMuted;
    emit(
      {
        ...(nextVolume === undefined ? {} : { volume }),
        ...(nextMuted === undefined ? {} : { muted })
      },
      providerEvent('volumechange', { muted, volume }, detail)
    );
  };

  return {
    play: () => runWistiaCommand(getPlayer(), (player) => player.play()),
    pause: () => runWistiaCommand(getPlayer(), (player) => player.pause()),
    seekTo: (time) => {
      if (!Number.isFinite(time))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = seekTarget(time);
      return runWistiaCommand(getPlayer(), (player) => player.time(target));
    },
    seekBy: (offset) => {
      if (!Number.isFinite(offset))
        return Promise.resolve({ ok: false, reason: 'provider-error' });
      const target = seekTarget(currentTime + offset);
      return runWistiaCommand(getPlayer(), (player) => player.time(target));
    },
    mute: () => runWistiaCommand(getPlayer(), (player) => player.mute()),
    unmute: () => runWistiaCommand(getPlayer(), (player) => player.unmute()),
    setVolume: async (level) => {
      if (!Number.isFinite(level))
        return { ok: false, reason: 'provider-error' };
      const player = getPlayer();
      const result = await runWistiaCommand(player, (target) =>
        target.volume(clampVolume(level))
      );
      // A refusal describes the device this player is on, not the adapter, so
      // it is only worth republishing while that player is still the live one.
      if (
        !result.ok &&
        result.reason === 'unsupported' &&
        player &&
        !isStale(player)
      ) {
        // iOS pins the media volume to the hardware switch and refuses every
        // programmatic change — a browser limit, not one Wistia imposes.
        volumeAvailability = { status: 'unavailable', reason: 'browser' };
        emit({ capabilities: getCapabilities() });
      }
      return result;
    },
    setPlaybackRate: async (rate) => {
      if (!Number.isFinite(rate) || rate <= 0)
        return { ok: false, reason: 'provider-error' };
      const player = getPlayer();
      const result = await runWistiaCommand(player, (target) =>
        target.playbackRate(rate)
      );
      if (
        !result.ok &&
        result.reason === 'unsupported' &&
        player &&
        !isStale(player)
      ) {
        playbackRateAvailability = {
          status: 'unavailable',
          reason: 'provider'
        };
        emit({ capabilities: getCapabilities() });
      }
      return result;
    },
    getCurrentTime: () => currentTime,
    adopt: (player, values) => {
      duration = values.duration;
      muted = values.muted;
      // The overrides are pushed into the player, so the ready patch has to
      // carry what is in effect after them rather than what the player reported
      // before. Wistia confirms a volume override with its own `volume-change`
      // eventually, but nothing at all confirms a playback-rate one — so a
      // patch built from the pre-override reads would leave the host showing a
      // rate the player is not running at, indefinitely.
      let nextVolume = values.volume;
      let nextPlaybackRate = values.playbackRate;
      if (
        mount.volume !== undefined &&
        Number.isFinite(mount.volume) &&
        mount.volume !== values.volume
      ) {
        nextVolume = clampVolume(mount.volume);
        player.volume(nextVolume);
      }
      if (
        mount.playbackRate !== undefined &&
        Number.isFinite(mount.playbackRate) &&
        mount.playbackRate > 0 &&
        mount.playbackRate !== values.playbackRate
      ) {
        nextPlaybackRate = mount.playbackRate;
        player.playbackRate(nextPlaybackRate);
      }
      volume = nextVolume;
      return {
        currentTime,
        duration,
        muted: values.muted,
        volume: nextVolume,
        playbackRate: nextPlaybackRate,
        ...(duration === null
          ? {}
          : { seekable: [{ start: 0, end: duration }] })
      };
    },
    handlers: {
      onPlay: (detail) =>
        emit(
          { playback: 'playing', buffering: false },
          providerEvent('play', undefined, detail)
        ),
      onPause: (detail) =>
        emit({ playback: 'paused' }, providerEvent('pause', undefined, detail)),
      onEnded: (player, detail) => {
        currentTime = readTime(player);
        emit(
          { playback: 'ended', buffering: false, currentTime },
          providerEvent('ended', undefined, detail)
        );
      },
      // `time-update` carries no payload, so the playhead is read back off the
      // handle rather than taken from the event.
      onTimeUpdate: (player) => {
        currentTime = readTime(player);
        emit({ currentTime });
      },
      onSeeked: (player, detail) => {
        currentTime = readTime(player);
        emit(
          { seeking: false, currentTime },
          providerEvent('seeked', { currentTime }, detail)
        );
      },
      // Wistia declares no `volume-change` payload, so which halves of the
      // pair arrive is not something this can rely on. Whichever half is
      // there is published; the other is carried over from the last state the
      // player reported, which is what the event's own type requires. Only a
      // payload with neither is a report this cannot act on.
      onVolumeChange: (detail) =>
        publishVolume(
          numberField(detail, 'volume'),
          booleanField(detail, 'isMuted'),
          detail
        ),
      // `mute-change` is declared, and carries the mute state alone.
      onMuteChange: (detail) =>
        publishVolume(
          undefined,
          booleanField(
            detail,
            'isMuted' satisfies keyof WistiaMuteChangeDetail
          ),
          detail
        ),
      onRateChange: (detail) => {
        const playbackRate = numberField(detail, 'playbackRate');
        if (playbackRate === undefined) return;
        emit(
          { playbackRate },
          providerEvent('ratechange', { playbackRate }, detail)
        );
      },
      onLoadedMetadata: (player) => {
        const next = player.duration();
        duration = Number.isFinite(next) && next > 0 ? next : null;
        emit(
          duration === null
            ? { duration }
            : { duration, seekable: [{ start: 0, end: duration }] }
        );
      }
    },
    setVolumeAvailability: () => volumeAvailability,
    setPlaybackRateAvailability: () => playbackRateAvailability
  };
};
