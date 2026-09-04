/*
 * The live readout under the bench's composition panel: what the mounted
 * controller reports about the rendition actually playing, not a capability
 * table and not a status grid -- one row of labelled values, the same
 * argument the quiet line makes about the player's own report being worth
 * trusting, pointed at the ladder instead of at the network.
 *
 * Every value reads `usePlayerState` directly and nothing else: no
 * subscription to hls.js, no second source of truth beside the controller
 * every other bench part already reads through. Where `PlayerState` has not
 * settled a field yet -- no active rendition, no quality ladder, no buffered
 * range under the playhead -- the value prints an en dash rather than a zero
 * or an empty string, so "unknown" and "measured as nothing" stay two
 * different readouts.
 */
import * as Player from '@playdeck/react';
import type { PlayerQuality, TimeRange } from '@playdeck/core';

const DASH = '–';

/** `m:ss`, or `h:mm:ss` past the hour -- the same shape `Player.Time` prints,
 * duplicated here rather than imported because the package exports no
 * formatter, only the component. */
const formatTime = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
};

const kbps = (bitrate: number): string => `${Math.round(bitrate / 1000)} kbps`;

/** What the "Playing" field prints: the active rendition's own height as a
 * familiar "804p" label, its full pixel size, and its bitrate where the type
 * carries one. */
const playingLabel = (quality: PlayerQuality | null): string => {
  if (quality === null || quality.width === null || quality.height === null) {
    return DASH;
  }
  const withDimensions = `${quality.height}p · ${quality.width}×${quality.height}`;
  return quality.bitrate === null
    ? withDimensions
    : `${withDimensions} · ${kbps(quality.bitrate)}`;
};

/** A rung's own label -- height first, the id as the last resort for the one
 * rendition that reports neither height nor bitrate. */
const rungLabel = (quality: PlayerQuality): string => {
  if (quality.height !== null) return `${quality.height}p`;
  if (quality.bitrate !== null) return kbps(quality.bitrate);
  return quality.id;
};

/** What the "Selected" field prints: "Auto" for a null selection, the chosen
 * rung's own label otherwise, or an en dash for a selection the current
 * ladder no longer carries (a rung the provider dropped since it was
 * chosen). */
const selectedLabel = (
  selectedQualityId: string | null,
  qualities: readonly PlayerQuality[]
): string => {
  if (selectedQualityId === null) return 'Auto';
  const match = qualities.find((quality) => quality.id === selectedQualityId);
  return match === undefined ? DASH : rungLabel(match);
};

/** What the "Ladder" field prints: the rung count, and every rung's own
 * height in ascending source order -- the order `state.qualities` already
 * publishes them in, not sorted here. */
const ladderLabel = (qualities: readonly PlayerQuality[]): string => {
  if (qualities.length === 0) return DASH;
  const heights = qualities.map((quality) =>
    quality.height === null ? '?' : `${quality.height}p`
  );
  return `${qualities.length} · ${heights.join(', ')}`;
};

/** Seconds between `currentTime` and the end of whichever buffered range
 * contains it -- an en dash where none does, which is a real state (nothing
 * buffered yet, or a seek that landed outside every range) and not zero
 * seconds of runway. */
const bufferedAheadLabel = (
  buffered: ReadonlyArray<TimeRange>,
  currentTime: number
): string => {
  const range = buffered.find(
    (candidate) =>
      candidate.start <= currentTime && currentTime <= candidate.end
  );
  return range === undefined
    ? DASH
    : `${(range.end - currentTime).toFixed(1)}s`;
};

type Field = { readonly label: string; readonly value: string };

export default function BenchStats() {
  // One selector, one subscription: every field below is read off the same
  // snapshot, the way `ControlBar` in `BenchIsland.tsx` reads its own row of
  // fields, so a press that moves none of them re-renders nothing here.
  const state = Player.usePlayerState((snapshot) => ({
    quality: snapshot.quality,
    qualities: snapshot.qualities,
    selectedQualityId: snapshot.selectedQualityId,
    buffered: snapshot.buffered,
    currentTime: snapshot.currentTime,
    duration: snapshot.duration,
    playbackRate: snapshot.playbackRate,
    playback: snapshot.playback
  }));

  const fields: readonly Field[] = [
    { label: 'Playing', value: playingLabel(state.quality) },
    {
      label: 'Selected',
      value: selectedLabel(state.selectedQualityId, state.qualities)
    },
    { label: 'Ladder', value: ladderLabel(state.qualities) },
    {
      label: 'Buffered ahead',
      value: bufferedAheadLabel(state.buffered, state.currentTime)
    },
    {
      label: 'Position',
      value: `${formatTime(state.currentTime)} / ${
        state.duration === null ? DASH : formatTime(state.duration)
      }`
    },
    { label: 'Rate', value: `${state.playbackRate}×` },
    { label: 'State', value: state.playback }
  ];

  return (
    // A single stacked column below 48rem, a wrapped row of label/value
    // stacks above it -- no animation either side: nothing here transitions,
    // so there is nothing `prefers-reduced-motion` needs to suppress.
    <dl
      className="m-0 flex flex-col gap-y-[var(--space-2)] font-mono text-[length:var(--text-fn)] tracking-[var(--tracking-fn)] md:flex-row md:flex-wrap md:gap-x-[var(--space-6)] md:gap-y-[var(--space-3)]"
      data-bench-stats
    >
      {fields.map((field) => (
        <div
          className="flex items-baseline justify-between gap-[var(--space-2)] md:flex-col md:items-start md:justify-normal md:gap-[var(--space-1)]"
          key={field.label}
        >
          <dt className="text-[var(--color-ink-subtle)] uppercase">
            {field.label}
          </dt>
          <dd className="m-0 text-[var(--color-ink-muted)]">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}
