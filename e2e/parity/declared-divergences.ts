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
// pass. The plan's decision "Known divergences live in one declared list,
// keyed by pair and measurement" puts the standard this way, verbatim: "Each
// entry carries the reason, and the reason cites the matrix row or the ADR.
// An unexplained divergence fails."
//
// Each `reason` below is this file's own summary of a `docs/backpack-parity.md`
// entry, not a quotation of one — the section it names in quotes is a real
// heading in that file, and the prose after the colon is a paraphrase to read
// alongside the row, not instead of it.

const ACCESSIBLE_NAME_REASON =
  '"Where Reely is better" (docs/backpack-parity.md): both sides expose the ' +
  "caller's `alt` to assistive technology since SIDEPRO-214, on different " +
  'elements and composed differently, which is the narrower divergence that ' +
  'remains. Backpack names the cover container itself — `VideoCoverImage` ' +
  'puts `role="button"` + `aria-label={alt}` on it, so the name is the ' +
  'picture alone, and an absent `alt` leaves that container an unnamed ' +
  "button (the axe `button-name` half of the same doc entry). Reely's cover " +
  'sits inside `Player.Poster`, which is `aria-hidden`, so the name is on ' +
  'the real button underneath and leads with the action: "Play video" / ' +
  '"Pause video", with the `alt` appended after a colon wherever there is ' +
  'one (`backpack-video.tsx:388-390`, its `const ariaLabel`). So the sweep ' +
  'compares a `DIV` named after the still against a `BUTTON` named after ' +
  'the action, and no `alt` makes those two strings agree. Declared only ' +
  'for the rows where the sweep actually observes it — a Backpack cover ' +
  'container carrying `role="button"` on screen at the same moment — never ' +
  'for a row that merely mentions a placeholder image in its note.';

const PLAY_ICON_REASON =
  '"Deliberate divergences" (docs/backpack-parity.md): under `controls: ' +
  "true`, Backpack still draws its own play icon over the provider's chrome " +
  'until playback has started once; Reely draws the icon only where it owns ' +
  'the surface, so `controls: true` gets neither the icon nor the toggle, ' +
  'at any point. Both declared rows set `controls: true`. `WithControls` is ' +
  '`partial` for exactly this; `Loop` is `partial` for SIDEPRO-210 instead ' +
  '(its `loop` never reaches a Vimeo or YouTube provider) and carries this ' +
  'divergence on top of that, through the same `controls: true`.';

// Two entries that were on this list before any sweep had run were removed
// once one had, because neither survived the evidence:
//
// - `Video.stories.tsx` → `CustomCoverImage`. That row does not resolve at
//   all — the matrix's shorthand omits a qualifier Backpack's real story name
//   carries ("Custom Cover Image (Vimeo)"), so it is one of the two unresolved
//   rows the resolver reports. The sweep has never measured it, so nothing has
//   ever shown this divergence to be real there.
// - `AutoplayVideo.stories.tsx` → `WithCustomPlaceholderImage`. The sweep
//   measures `cover.present` as `false` on BOTH sides of that row:
//   `AutoplayVideo` forces `light={false}` and starts muted playback, so no
//   Backpack cover container renders and there is no labelled cover to
//   diverge about. What the entry actually silenced was
//   `backpack=[] reely=["BUTTON[Pause video]"]` — Backpack exposing no
//   affordance at all under the player — which is a different divergence, and
//   one the sibling `AutoplayVideo` → `Default` row reports as an undeclared
//   finding on identical values. An entry that turns the same observation
//   green on one row and red on the next is not describing anything.

const DECLARED: readonly DeclaredDivergence[] = [
  // Video.stories.tsx: the rows where the sweep observes Backpack's cover
  // container on screen as a `role="button"` while Reely's named affordance is
  // the play button underneath. Backpack's measured values, in order below:
  // `["DIV[custom cover image]"]`, `["DIV[]"]` (the `renderCustomImage` path
  // leaves the container unnamed, the axe `button-name` half of the same doc
  // entry) and `["DIV[custom cover image]"]`. Reely measured
  // `["BUTTON[Play video]"]` on all three when those were taken, before
  // SIDEPRO-214 folded the `alt` into that button's name. The first and third
  // rows pass an `alt` (`custom cover image`, on both the Mock and Real
  // stories), so what the sweep reads there now is a `BUTTON` whose name
  // carries that text after the action rather than the action alone.
  // `WithRenderCustomImage` passes no `alt` to the component on either side —
  // its `alt` is set inside the consumer's own `<img>` — so that row is
  // unchanged by SIDEPRO-214 and still reads `["BUTTON[Play video]"]`. None
  // of the three stops diverging for it: a `DIV` against a `BUTTON` differs
  // whatever the names turn out to be.
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
  // The two `controls: true` rows. The sweep observes `backpack=true
  // reely=false` on both, in both the pre- and post-activation states.
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
