/*
 * The ten controls `BenchIsland.tsx` mounts inside `Player.Controls`, and
 * `bench-composition.ts` prints in the same order: one tuple, mapped over by
 * both, rather than two hand-kept lists that can drift.
 *
 * The order is the companion spec's own control-bar contract -- `SeekSlider`
 * alone is row one, and row two is everything else in this sequence. Two
 * entries name a shared component under two configurations (`Player.Time` with
 * `type="current"` and `type="duration"`) rather than one entry for `Time`,
 * because what a consumer composes is two distinct elements and the tuple is a
 * list of composed things, not of component names.
 *
 * `Record<BenchControlName, ...>` is what a name added here or removed forces.
 * `ControlBar` in `BenchIsland.tsx` and the line table in
 * `bench-composition.ts` each keep one, and TypeScript's missing-key checking
 * on an object literal assigned to a `Record` type fails a build the moment the
 * two stop agreeing -- the same discipline `bySource` in `bench-sources.ts`
 * already uses for provider entries. A test that diffed the two lists after the
 * fact would catch drift once it had already shipped; an exhaustive type stops
 * it compiling.
 */
export const BENCH_CONTROLS = [
  'seekSlider',
  'playButton',
  'muteButton',
  'volumeSlider',
  'timeCurrent',
  'timeDuration',
  'captionsButton',
  'settingsMenu',
  'pipButton',
  'fullscreenButton'
] as const;

export type BenchControlName = (typeof BENCH_CONTROLS)[number];
