import type {
  Availability,
  CommandResult,
  PlayerQuality,
  ProviderStatePatch
} from '@playdeck/core';
import {
  asRecord,
  available,
  providerCheck,
  runVimeoCommand,
  type EmitProviderState
} from './adapter-values.js';
import type { VimeoSdkPlayer, VimeoSdkQuality } from './loader.js';

const stringField = (data: unknown, field: string): string | undefined => {
  const value = asRecord(data)[field];
  return typeof value === 'string' ? value : undefined;
};

// Vimeo's rung ids are its own stable keys, so they double as the Playdeck id
// under the `vimeo:` prefix the text tracks already use. `auto` is one of them,
// but it is a mode rather than a rung: the state contract carries that as
// `selectedQualityId: null`, the way it does for hls.js, so it is filtered out
// of the published list instead of appearing as something to pick.
const vimeoQualityId = (id: string): string => `vimeo:${id}`;

const isVimeoRung = (quality: VimeoSdkQuality): boolean =>
  quality.id !== 'auto';

// An embed that does not implement `getQualities` still answers it, so what
// comes back is not guaranteed to be a list of rungs at all. Same rule as the
// buffered ranges: a shape we cannot vouch for is dropped, not guessed at.
const toVimeoQualities = (value: unknown): ReadonlyArray<VimeoSdkQuality> =>
  Array.isArray(value)
    ? (value as ReadonlyArray<VimeoSdkQuality>).filter(
        (quality) => typeof quality?.id === 'string'
      )
    : [];

// The rung label is Vimeo's nominal name for it, not a measurement — the rung
// it calls `240p` renders at 480x270 (#82). It is still the name Vimeo's own
// menu shows, so it is the honest thing to label with; width and bitrate the
// SDK does not report at all.
const vimeoQualityHeight = (id: string): number | null => {
  const match = /^(\d+)p$/.exec(id);
  return match ? Number(match[1]) : null;
};

const toCoreQualities = (
  qualities: ReadonlyArray<VimeoSdkQuality>
): PlayerQuality[] =>
  qualities.filter(isVimeoRung).map((quality) => ({
    id: vimeoQualityId(quality.id),
    height: vimeoQualityHeight(quality.id),
    width: null,
    bitrate: null
  }));

const resolveVimeoQuality = (
  id: string,
  qualities: ReadonlyArray<VimeoSdkQuality>
): VimeoSdkQuality | undefined =>
  qualities
    .filter(isVimeoRung)
    .find((quality) => vimeoQualityId(quality.id) === id);

// `active` marks the entry the player is honouring, which under adaptive
// playback is `auto` itself — the rung actually rendering is not identified,
// and `null` says exactly that.
const activeVimeoQualityId = (
  qualities: ReadonlyArray<VimeoSdkQuality>
): string | null => {
  const active = qualities
    .filter(isVimeoRung)
    .find((quality) => quality.active);
  return active ? vimeoQualityId(active.id) : null;
};

// The slice of the player this seam drives: the one setter, nothing else.
export type VimeoQualityPlayer = Pick<VimeoSdkPlayer, 'setQuality'>;

export type VimeoQualityLevelsDeps = {
  readonly emit: EmitProviderState;
  readonly getPlayer: () => VimeoQualityPlayer | undefined;
};

// The quality-selection seam: the ladder the embed published, the held
// selection (`null` is auto) and the `selectQuality` command. Vimeo reports
// only the rung a viewer or this adapter pinned, never the one adaptive
// playback is rendering, so nothing here tracks the live rendition.
export type VimeoQualityLevels = {
  readonly selectQuality: (id: string | null) => Promise<CommandResult>;
  // Adopts the ladder read at attach, returning the patch fragment the
  // attachment seam folds into its ready state.
  readonly adopt: (qualities: unknown) => ProviderStatePatch;
  readonly handlers: {
    readonly onQualityChange: (data?: unknown) => void;
  };
  // The `selectQuality` facet of the host's capabilities.
  readonly selectQualityAvailability: () => Availability;
};

export const createVimeoQualityLevels = ({
  emit,
  getPlayer
}: VimeoQualityLevelsDeps): VimeoQualityLevels => {
  let qualities: ReadonlyArray<VimeoSdkQuality> = [];
  let selectedQualityId: string | null = null;
  let selectQualityAvailability: Availability = providerCheck;

  return {
    // Resolved against the list the player published before the SDK is called:
    // an id it never offered never settles at all, so an unchecked pass-through
    // is a command that hangs rather than one that fails (#82).
    selectQuality: (id) => {
      const target =
        id === null
          ? qualities.find((quality) => !isVimeoRung(quality))
          : resolveVimeoQuality(id, qualities);
      if (!target) return Promise.resolve({ ok: false, reason: 'unsupported' });
      return runVimeoCommand(getPlayer(), (player) =>
        player.setQuality(target.id)
      ).then((result) => {
        if (result.ok) {
          selectedQualityId = id;
          emit({ selectedQualityId: id });
        }
        return result;
      });
    },
    adopt: (value) => {
      qualities = toVimeoQualities(value);
      // Re-derived from the player in hand, never carried over: a retry builds
      // an embed with nothing pinned, and a stale id would report a rung it is
      // not honouring.
      selectedQualityId = activeVimeoQualityId(qualities);
      const rungs = toCoreQualities(qualities);
      selectQualityAvailability =
        rungs.length > 0
          ? available
          : { status: 'unavailable', reason: 'source' };
      return { qualities: rungs, selectedQualityId };
    },
    handlers: {
      // Vimeo's own settings menu can pin a rung too, on an embed that shows
      // it. The event reports the *selection*, not the rung adaptive playback
      // is on: under auto the rendition moved 720 -> 540 with nothing fired
      // (#82).
      onQualityChange: (data) => {
        const quality = stringField(data, 'quality');
        if (quality === undefined) return;
        const next = quality === 'auto' ? null : vimeoQualityId(quality);
        if (next !== null && !resolveVimeoQuality(next, qualities)) return;
        if (next === selectedQualityId) return;
        selectedQualityId = next;
        emit({ selectedQualityId: next });
      }
    },
    selectQualityAvailability: () => selectQualityAvailability
  };
};
