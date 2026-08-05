import type { ParityRow } from './parity-matrix';

/**
 * The measurements {@link measurements.check.ts} takes that a divergence can
 * be declared against. Deliberately the small set the six required
 * measurements reduce to when the geometry is expressed as pass/fail rather
 * than as a number: `docs/backpack-parity.md`'s own notes are about
 * accessibility and about which affordance renders, never about aspect
 * ratio or box geometry disagreeing, so there is nothing to declare for
 * those — a numeric mismatch there would always be a real finding.
 */
export type DeclarableMeasurement = 'accessibleName' | 'playIconPresence';

interface DeclaredDivergence {
  readonly section: string;
  readonly backpackStoryName: string;
  readonly measurement: DeclarableMeasurement;
  readonly reason: string;
}

// One entry per (row, measurement) the matrix or its own "Deliberate
// divergences" tables already record — never one invented to make a result
// pass. Per the plan: "Declared entries are only for what the matrix already
// records as `partial`, or for styling differences the plan calls
// deliberate." Both citations below are direct quotes from
// `docs/backpack-parity.md`.

const ACCESSIBLE_NAME_REASON =
  '"Where Reely is better" (docs/backpack-parity.md): ' +
  '`VideoCoverImage` puts `role="button"` + `aria-label={alt}` on the cover ' +
  "container; Reely's cover sits inside `Player.Poster`, which is " +
  '`aria-hidden`, so the labelled affordance there is the play button ' +
  'underneath instead ("Play video"/"Pause video"), not the cover. Tracked ' +
  'as SIDEPRO-214. Applies to every row with a custom placeholder cover — ' +
  'the row-level note repeats this same sentence.';

const PLAY_ICON_REASON =
  '"Deliberate divergences" (docs/backpack-parity.md): under `controls: ' +
  "true`, Backpack still draws its own play icon over the provider's chrome " +
  'until playback has started once; Reely draws the icon only where it owns ' +
  'the surface, so `controls: true` gets neither the icon nor the toggle, ' +
  'at any point. The `WithControls` and `Loop` rows are both `partial` for ' +
  'exactly this.';

const DECLARED: readonly DeclaredDivergence[] = [
  // Video.stories.tsx: rows with a custom placeholder cover image, whose own
  // notes read "alt reaches the DOM but not the accessibility tree".
  {
    section: 'Video.stories.tsx',
    backpackStoryName: 'CustomCoverImage',
    measurement: 'accessibleName',
    reason: ACCESSIBLE_NAME_REASON
  },
  {
    section: 'Video.stories.tsx',
    backpackStoryName: 'CustomCoverImageYouTube',
    measurement: 'accessibleName',
    reason: ACCESSIBLE_NAME_REASON
  },
  {
    section: 'Video.stories.tsx',
    backpackStoryName: 'WithRenderCustomImage',
    measurement: 'accessibleName',
    reason: ACCESSIBLE_NAME_REASON
  },
  {
    section: 'Video.stories.tsx',
    backpackStoryName: 'YouTubeShortsVideoAndCustomCoverImage',
    measurement: 'accessibleName',
    reason: ACCESSIBLE_NAME_REASON
  },
  // AutoplayVideo.stories.tsx's own custom-cover row carries the same note.
  {
    section: 'AutoplayVideo.stories.tsx',
    backpackStoryName: 'WithCustomPlaceholderImage',
    measurement: 'accessibleName',
    reason: ACCESSIBLE_NAME_REASON
  },
  // The two `partial` controls:true rows.
  {
    section: 'Video.stories.tsx',
    backpackStoryName: 'WithControls',
    measurement: 'playIconPresence',
    reason: PLAY_ICON_REASON
  },
  {
    section: 'Video.stories.tsx',
    backpackStoryName: 'Loop',
    measurement: 'playIconPresence',
    reason: PLAY_ICON_REASON
  }
];

/**
 * Whether `(row, measurement)` is a declared divergence, and why. Returns
 * `undefined` for anything not on the list above — which is the fail-closed
 * default the plan asks for: an unexplained divergence fails the run rather
 * than needing to be added to a growing allowlist to pass.
 */
export function declaredDivergence(
  row: Pick<ParityRow, 'section' | 'backpackStoryName'>,
  measurement: DeclarableMeasurement
): string | undefined {
  return DECLARED.find(
    (entry) =>
      entry.section === row.section &&
      entry.backpackStoryName === row.backpackStoryName &&
      entry.measurement === measurement
  )?.reason;
}
