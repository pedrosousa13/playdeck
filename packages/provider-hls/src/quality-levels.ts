import type {
  Availability,
  CommandResult,
  PlayerQuality,
  ProviderStatePatch
} from '@reely/core';
import type {
  EmitProviderState,
  HlsInstanceLike,
  HlsLevelLike
} from './adapter-values.js';

// Content-derived, never index-derived: hls.js removes levels from `levels`
// after repeated errors, so an index-keyed id would silently repoint a held
// selection at a different rung. `HlsLevelLike`'s fields are all optional
// (audio-only renditions carry no dimensions), so a missing one renders as
// `-` rather than the string "undefined".
// `== null` rather than `=== undefined`: the sibling mapping below uses
// `?? null`, and the two must agree about what a missing dimension is, or a
// null from hls.js would read `hls:nullx…` in the id while the exposed field
// read `null`.
const hlsLevelToken = (value: number | null | undefined): string =>
  value == null ? '-' : String(value);

const hlsQualityBaseId = (level: HlsLevelLike): string =>
  `hls:${hlsLevelToken(level.height)}x${hlsLevelToken(level.width)}` +
  `@${hlsLevelToken(level.bitrate)}`;

// Rungs identical on every field this contract exposes are separated by a
// `:<idx>` suffix. That suffix moves when the collision set changes — and
// the id also loses it entirely when a pair collapses to one — so a held
// selection is re-matched by `baseId`, never by the suffixed id alone. See
// `refresh`.
const hlsQualityEntries = (
  levels: ReadonlyArray<HlsLevelLike>
): ReadonlyArray<{
  readonly quality: PlayerQuality;
  readonly baseId: string;
}> => {
  const rungs = levels.map((level) => ({
    level,
    baseId: hlsQualityBaseId(level)
  }));
  const collisions = new Map<string, number>();
  rungs.forEach(({ baseId }) =>
    collisions.set(baseId, (collisions.get(baseId) ?? 0) + 1)
  );
  const assigned = new Map<string, number>();
  return rungs.map(({ baseId, level }) => {
    let id = baseId;
    if ((collisions.get(baseId) ?? 0) > 1) {
      const ordinal = assigned.get(baseId) ?? 0;
      assigned.set(baseId, ordinal + 1);
      id = `${baseId}:${ordinal}`;
    }
    return {
      baseId,
      quality: {
        id,
        height: level.height ?? null,
        width: level.width ?? null,
        bitrate: level.bitrate ?? null
      }
    };
  });
};

const hlsQualities = (levels: ReadonlyArray<HlsLevelLike>): PlayerQuality[] =>
  hlsQualityEntries(levels).map((entry) => entry.quality);

export type HlsQualityLevelsDeps = {
  readonly emit: EmitProviderState;
  readonly isDestroyed: () => boolean;
  // The live engine instance selections are pushed into; undefined until the
  // hls.js engine has started.
  readonly getInstance: () =>
    Pick<HlsInstanceLike, 'levels' | 'currentLevel'> | undefined;
  // The host's re-decorated capabilities, as a spreadable patch fragment —
  // empty until the first capabilities snapshot has been seen.
  readonly capabilitiesPatch: () => ProviderStatePatch;
};

// The quality-levels seam: the ladder derived from hls.js's `levels` and the
// held selection (`null` is auto). Unlike captions there is no "explicitly
// chosen" flag — see `refresh` for why quality needs no default-track rule.
// The host wires `refresh` and `onLevelSwitched` to the engine's events,
// guarding staleness itself.
export type HlsQualityLevels = {
  readonly selectQuality: (id: string | null) => Promise<CommandResult>;
  readonly refresh: (instance: Pick<HlsInstanceLike, 'levels'>) => void;
  readonly onLevelSwitched: (
    instance: Pick<HlsInstanceLike, 'levels'>,
    data: unknown
  ) => void;
  // Publishes an empty ladder for a brand-new engine instance, so state
  // stops advertising a dead instance's rungs; called on every engine start.
  readonly prepareForStart: () => void;
  // Drops the ladder without emitting; the host folds the cleared fields
  // into its fatal error patch.
  readonly clearForFatal: () => void;
  // Returns the availability verdict to undecided; called on retry.
  readonly reset: () => void;
  // The `selectQuality` facet of the host's capabilities on the hls.js
  // engine.
  readonly selectQualityAvailability: () => Availability;
};

export const createHlsQualityLevels = ({
  emit,
  isDestroyed,
  getInstance,
  capabilitiesPatch
}: HlsQualityLevelsDeps): HlsQualityLevels => {
  let selectQualityAvailability: Availability = {
    status: 'unknown',
    reason: 'provider-check'
  };
  let hlsQualityList: PlayerQuality[] = [];
  let hlsSelectedQualityId: string | null = null;
  // The held selection's collision-free base id, kept so a selection can be
  // re-matched after its `:<idx>` suffix shifts or collapses.
  let hlsSelectedQualityBaseId: string | null = null;

  return {
    selectQuality: async (id) => {
      const instance = getInstance();
      if (isDestroyed() || !instance) {
        return { ok: false, reason: 'not-ready' };
      }
      if (id === null) {
        instance.currentLevel = -1;
        hlsSelectedQualityId = null;
        hlsSelectedQualityBaseId = null;
        emit({ selectedQualityId: null });
        return { ok: true };
      }
      // Resolved against a fresh derivation over the live `levels`
      // array, so a rung hls.js has pruned is `unsupported` rather than
      // a silent switch to whatever now occupies that index.
      // Deliberately NOT `hlsQualityList`, which is what the mirrored
      // `selectTextTrack` checks: hls.js mutates `levels` through
      // `removeLevel` and only then fires `LEVELS_UPDATED`, so the live
      // array is the authority and the published list can lag it.
      const entries = hlsQualityEntries(instance.levels);
      const index = entries.findIndex((entry) => entry.quality.id === id);
      if (index === -1) return { ok: false, reason: 'unsupported' };
      instance.currentLevel = index;
      hlsSelectedQualityId = id;
      hlsSelectedQualityBaseId = entries[index]?.baseId ?? null;
      emit({ selectedQualityId: id });
      return { ok: true };
    },
    // Gated on list length, the way the text-track seam's caption-rendering
    // verdict gates on track count. An empty list once the manifest has
    // parsed is `unavailable/source`, never `unknown` — a verdict that
    // cannot resolve is the same defect this change fixes in
    // provider-native.
    refresh: (instance) => {
      const entries = hlsQualityEntries(instance.levels);
      hlsQualityList = entries.map((entry) => entry.quality);
      selectQualityAvailability =
        hlsQualityList.length === 0
          ? { status: 'unavailable', reason: 'source' }
          : { status: 'available' };
      // A held selection may not outlive the rung it names — but it must also
      // survive a rung that still exists under a different id. Pruning one of
      // a pair of indistinguishable rungs collapses the survivor's `:<idx>`
      // suffix away, so an id-only membership test would drop a selection
      // whose rung is still right there, while the engine stays pinned to it:
      // state would report auto while playback was locked to one level, with
      // no way back. Matching on `baseId` re-adopts the survivor under its
      // new id. Rungs sharing a baseId are identical on every field this
      // contract exposes, so which one is adopted is not observable.
      if (hlsSelectedQualityId !== null) {
        const held =
          entries.find((entry) => entry.quality.id === hlsSelectedQualityId) ??
          entries.find((entry) => entry.baseId === hlsSelectedQualityBaseId);
        hlsSelectedQualityId = held?.quality.id ?? null;
        hlsSelectedQualityBaseId = held?.baseId ?? null;
      }
      // `currentLevel` is deliberately not written: hls.js prunes levels as
      // part of its own error recovery and reindexes `currentLevel` itself,
      // so writing into the middle of that fights the engine over state it
      // is still repairing.
      emit({
        qualities: hlsQualityList,
        selectedQualityId: hlsSelectedQualityId,
        ...capabilitiesPatch()
      });
    },
    onLevelSwitched: (instance, data) => {
      const index = (data as { level: number }).level;
      // Resolved through the same derivation as the list, so the active
      // level's id and its list entry's id cannot drift apart.
      emit({ quality: hlsQualities(instance.levels)[index] ?? null });
    },
    // Both `load()` and `retry()` route through the engine start, so this is
    // the one place a new engine instance's empty ladder has to be
    // published: without it, state would keep advertising a dead instance's
    // rungs until the new manifest parsed. Guarded because on a first load
    // there is nothing to clear, and an unconditional patch would publish a
    // no-op change. Also fires on a stale verdict alone: a previous instance
    // that parsed an empty manifest left `unavailable/source`, which is too
    // confident for a brand-new instance whose manifest has not been read
    // yet.
    prepareForStart: () => {
      if (
        hlsQualityList.length > 0 ||
        hlsSelectedQualityId !== null ||
        selectQualityAvailability.status !== 'unknown'
      ) {
        hlsQualityList = [];
        hlsSelectedQualityId = null;
        hlsSelectedQualityBaseId = null;
        // The capability and the list are one claim and may not disagree,
        // even for the window before the new manifest parses. `retry()`
        // already sets this same verdict; a plain second `load()` does not,
        // so it is set here rather than left to the caller.
        selectQualityAvailability = {
          status: 'unknown',
          reason: 'provider-check'
        };
        emit({
          qualities: [],
          selectedQualityId: null,
          ...capabilitiesPatch()
        });
      }
    },
    clearForFatal: () => {
      selectQualityAvailability = { status: 'unavailable', reason: 'provider' };
      hlsQualityList = [];
      hlsSelectedQualityId = null;
      hlsSelectedQualityBaseId = null;
    },
    reset: () => {
      selectQualityAvailability = {
        status: 'unknown',
        reason: 'provider-check'
      };
    },
    selectQualityAvailability: () => selectQualityAvailability
  };
};
