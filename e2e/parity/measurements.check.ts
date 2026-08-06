import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  declaredDivergence,
  type DeclarableMeasurement
} from './declared-divergences';
import {
  activate,
  measure,
  measureHoverZoom,
  ROOT_SELECTOR,
  story,
  type HoverMeasurement,
  type Measurement
} from './measure';
import { BACKPACK_ORIGIN, REELY_ORIGIN } from './origins';
import {
  parseParityMatrix,
  resolveParityPairs,
  type ParityRow
} from './parity-matrix';
import { fetchStoryIndex } from './story-index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(__dirname, '../../docs/backpack-parity.md');

// Generous on purpose: up to 36 resolvable pairs, each driving two page loads
// plus a hover and a click, several of them against Backpack's own real
// network (Vimeo/YouTube/Wistia/oEmbed) rather than a mock. The plan warns to
// expect slowness there rather than tighten this — a flaky per-story timeout
// would fail pairs that are fine, just slow.
const SUITE_TIMEOUT_MS = 25 * 60 * 1000;

// One navigation's budget. Above the config's `actionTimeout` because a
// navigation does strictly more than an action does on these servers: both
// Storybooks are `storybook dev`, which compiles a story module on first
// request (`playwright.config.ts`'s own comment on its 30s test timeout says
// the same thing about the same server). Bounded at all so a story that can
// never load costs this pair and no more — the alternative is Playwright's
// own default, which is the config's `navigationTimeout`, unset here and
// therefore 30s, doubling the worst case for the same information.
const NAVIGATION_TIMEOUT_MS = 15_000;

// How long a side gets to put a laid-out `.ef-video-player` on screen before
// the pair is reported unmeasurable. It has to clear the same cold on-demand
// compile as the navigation above, and it is paid in full by every pair that
// legitimately never shows one: 10 of the 36 resolved pairs today (8
// `VideoHoverPreview` rows whose Backpack root sits at `display: none` until
// the preview runs, plus 2 `DefaultThemeConfig` rows that render JSON on both
// sides), which the two sequential waits below turn into roughly two minutes
// of the sweep's nine. 10s is the balance struck between those two:
// comfortably past a compiled story's mount, short enough that ten rows with
// nothing to show do not dominate the run.
const ROOT_WAIT_MS = 10_000;

// A flat wait, not a condition, and that is the point: the thing being waited
// for is a cover image whose *absence* is itself one of the measurements (see
// `cover.present` below), so there is no state to wait for that would not
// prejudge the reading. What it has to outlast is one oEmbed round trip on
// each side (`useVideoThumbnail` on Reely's, react-player's own light-mode
// fetch on Backpack's, both third-party over the open internet). 3s is the
// budget: an order of magnitude over a warm same-continent HTTP round trip,
// while costing the sweep 2 x 26 x 3s ≈ 2.6 minutes at most, which a ~9-minute
// hand-run sweep can pay. Under-waiting is the expensive error here — it
// invents a cover divergence out of timing — and over-waiting only costs time.
const COVER_SETTLE_MS = 3_000;

// The same trade as `COVER_SETTLE_MS`, after activation instead of before it:
// "no provider attached" is a legitimate post-activation reading (the Mock
// suite never commits a source at all), so there is nothing to wait *for*, and
// a side that does attach one needs a provider fetch and a mount to land.
const POST_CLICK_WAIT_MS = 3_000;

// 0.02 on a ratio, i.e. about 1.1% at 16/9. Sized from both ends. Below: the
// real difference this has to stay able to see is one of Backpack's own
// aspect-ratio tokens rendered where another was asked for, and the tightest
// distinct pair in that map (`useAspectRatio.tsx:13-36`) is `3-4` at 0.75
// against `4-5` at 0.8 — 0.05 apart, more than twice this. Above: a box
// measured in fractional CSS pixels moves its ratio by roughly
// `ratio / height` per pixel of rounding, which at these stories' ~340px-tall
// players is ~0.005, so this absorbs about four pixels of layout rounding and
// nothing a viewer could see.
const ASPECT_RATIO_TOLERANCE = 0.02;

// The effect under measurement is `scale(1.05)` against `scale(1)` — a
// difference of 0.05 — so a tolerance of 0.02 is under half of it and can
// never report a missing hover zoom as a match, which is the failure mode that
// would matter. What it does absorb is the tail of an easing curve: the read
// happens one transition-duration plus 100ms after the pointer lands, and the
// two stylesheets do not share an easing function, so the last percent of the
// animation is not guaranteed to have resolved identically on both sides.
const SCALE_TOLERANCE = 0.02;

// Both sides target the same 200ms/`duration-system-medium` transition, but
// neither guarantees sub-frame precision, so a generous absolute tolerance
// beats a relative one at small values.
const DURATION_TOLERANCE_MS = 60;

interface Finding {
  pair: string;
  measurement: string;
  backpack: unknown;
  reely: unknown;
  detail: string;
}

interface PairOutcome {
  label: string;
  status: 'measured' | 'unmeasurable';
  reason?: string;
}

/**
 * One pair's identity, carried as a unit because every comparison below needs
 * all four of these and none of them changes within a pair: where a finding
 * goes, what to call the pair when it does, which matrix row to ask
 * `declared-divergences.ts` about, and which Reely suite is on the other side.
 * They travelled as four positional parameters through three functions before,
 * one of which took eight.
 */
interface PairContext {
  findings: Finding[];
  label: string;
  row: ParityRow;
  /** Whether the Reely story chosen for this row is from the `Mock` suite —
   * read off {@link pickReelyStory}'s own answer rather than sniffed out of
   * {@link PairContext.label}, which is a display string a reword would
   * silently change the meaning of. `mounted` is the measurement that turns
   * on it; see {@link compareMeasurements}. */
  reelyIsMock: boolean;
}

/** The `Mock` suite's own title segment, and the one place this string is
 * written: `pickReelyStory` selects on it and `PairContext.reelyIsMock`
 * records the outcome. */
const MOCK_SUITE_SEGMENT = '/Mock/';

/**
 * Picks which Reely story stands in for a matrix row's Backpack story. The
 * `Mock` suite is preferred wherever the row has one: it needs no network to
 * reach a stable pre-activation state, so it is the more reliable geometry
 * source (the plan's own preference for "pre-activation geometry, which
 * needs no successful media load"). Rows with only a `Real` story (`Light`,
 * `VimeoCoverImage`, `YouTubeCoverImage`, `WithSound`) fall back to it —
 * those need real network on Backpack's side too, so there is nothing more
 * reliable to prefer.
 */
function pickReelyStory(
  row: ParityRow,
  reelyIds: string[]
): { id: string; title: string; name: string; isMock: boolean } {
  const mockIndex = row.reelyStories.findIndex((s) =>
    s.title.includes(MOCK_SUITE_SEGMENT)
  );
  const index = mockIndex === -1 ? 0 : mockIndex;
  return {
    id: reelyIds[index],
    ...row.reelyStories[index],
    isMock: mockIndex !== -1
  };
}

const fmt = (value: unknown): string => JSON.stringify(value);

/** Logs one comparison line and returns whether it needs to be recorded as a
 * finding. `declarable` names the measurement in `declared-divergences.ts`
 * terms when a mismatch there is allowed to be a known, cited divergence
 * rather than a fresh one; omitted for measurements the plan gives no
 * mechanism to declare (a numeric geometry mismatch always has to be real). */
function compare(
  pair: PairContext,
  measurementName: string,
  backpackValue: unknown,
  reelyValue: unknown,
  equal: boolean,
  declarable?: DeclarableMeasurement
): void {
  if (equal) {
    console.log(
      `    ${measurementName}: MATCH backpack=${fmt(backpackValue)} reely=${fmt(reelyValue)}`
    );
    return;
  }
  const reason = declarable
    ? declaredDivergence(pair.row, declarable)
    : undefined;
  if (reason !== undefined) {
    console.log(
      `    ${measurementName}: DECLARED backpack=${fmt(backpackValue)} reely=${fmt(reelyValue)} — ${reason}`
    );
    return;
  }
  console.log(
    `    ${measurementName}: FINDING backpack=${fmt(backpackValue)} reely=${fmt(reelyValue)}`
  );
  pair.findings.push({
    pair: pair.label,
    measurement: measurementName,
    backpack: backpackValue,
    reely: reelyValue,
    detail: `${pair.label} — ${measurementName} differs and is not a declared divergence: backpack=${fmt(backpackValue)} reely=${fmt(reelyValue)}`
  });
}

const nearly = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(a - b) <= tolerance;

/** Why one side's player root did not become visible, in that side's own
 * terms — absent from the document, or present and hidden, and by what. */
async function describeRoot(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (el === null) return 'no .ef-video-player in the document';
    const { width, height } = el.getBoundingClientRect();
    const { display, visibility, opacity } = getComputedStyle(el);
    return `.ef-video-player is in the document but not visible: display=${display}, visibility=${visibility}, opacity=${opacity}, box=${width}×${height}`;
  }, ROOT_SELECTOR);
}

function compareMeasurements(
  pair: PairContext,
  phase: 'pre' | 'post',
  backpack: Measurement,
  reely: Measurement
): void {
  if (backpack.root === null || reely.root === null) {
    console.log(
      `    root[${phase}]: backpack=${backpack.root === null ? 'absent' : 'present'} reely=${reely.root === null ? 'absent' : 'present'}`
    );
    if ((backpack.root === null) !== (reely.root === null)) {
      pair.findings.push({
        pair: pair.label,
        measurement: `root.present[${phase}]`,
        backpack: backpack.root !== null,
        reely: reely.root !== null,
        detail: `${pair.label} — one side has no ${ROOT_SELECTOR} at all in the ${phase}-activation state while the other does`
      });
    }
    return;
  }

  compare(
    pair,
    `root.aspectRatio[${phase}]`,
    backpack.root.aspectRatio,
    reely.root.aspectRatio,
    nearly(
      backpack.root.aspectRatio,
      reely.root.aspectRatio,
      ASPECT_RATIO_TOLERANCE
    )
  );
  // Informational only, never compared for equality: each story picks its
  // own outer decorator (Backpack's own stories wrap most rows in a
  // `TestWrapper maxWidth='...'`; Reely's stories decide their own, entirely
  // unrelated to it — the docs table itself treats a maxWidth wrapper as
  // presentation to reproduce only where the row calls it out, e.g.
  // `YouTubeShortsVideo`'s). The immediate parent element is therefore not
  // the same *kind* of container on both sides, so comparing the raw
  // fraction would measure two different things wearing the same number —
  // exactly what "measure both sides through the same function" is meant to
  // rule out. Logged so the actual boxes are on record either way.
  console.log(
    `    root.widthFractionOfParent[${phase}] (informational — see comment): backpack=${backpack.root.widthFractionOfParent} reely=${reely.root.widthFractionOfParent}`
  );

  compare(
    pair,
    `cover.present[${phase}]`,
    backpack.cover !== null,
    reely.cover !== null,
    (backpack.cover === null) === (reely.cover === null)
  );
  if (backpack.cover !== null && reely.cover !== null) {
    compare(
      pair,
      `cover.objectFit[${phase}]`,
      backpack.cover.objectFit,
      reely.cover.objectFit,
      backpack.cover.objectFit === reely.cover.objectFit
    );
  }

  compare(
    pair,
    `playIcon.present[${phase}]`,
    backpack.playIcon !== null,
    reely.playIcon !== null,
    (backpack.playIcon === null) === (reely.playIcon === null),
    'playIconPresence'
  );
  if (backpack.playIcon !== null && reely.playIcon !== null) {
    compare(
      pair,
      `playIcon.centered[${phase}]`,
      backpack.playIcon.centered,
      reely.playIcon.centered,
      backpack.playIcon.centered === reely.playIcon.centered
    );
  }

  // `mounted` is genuinely asymmetric by construction on the Mock suite:
  // its stories stage `activation: 'ready'` but never commit a source
  // (`backpack-video.stories.tsx`'s own file-header comment), so
  // `Player.Media` renders nothing at any point — not a real geometry
  // finding, just what "deterministic and offline" means. Logged either way,
  // asserted only when the Reely side is the `Real` suite, where a real
  // provider is expected to attach the same way Backpack's does. Which suite
  // it is comes from the resolved story (`pickReelyStory`), not from reading
  // the pair's display label back.
  console.log(
    `    mounted[${phase}]: backpack=${backpack.mounted} reely=${reely.mounted}${pair.reelyIsMock ? ' (reely: Mock suite never commits a source — informational only)' : ''}`
  );
  if (!pair.reelyIsMock) {
    compare(
      pair,
      `mounted[${phase}]`,
      backpack.mounted,
      reely.mounted,
      backpack.mounted === reely.mounted
    );
  }

  compare(
    pair,
    `accessibleTargets[${phase}]`,
    backpack.accessibleTargets,
    reely.accessibleTargets,
    JSON.stringify(backpack.accessibleTargets) ===
      JSON.stringify(reely.accessibleTargets),
    'accessibleName'
  );
}

function compareHover(
  pair: PairContext,
  backpack: HoverMeasurement,
  reely: HoverMeasurement
): void {
  for (const slot of ['cover', 'root'] as const) {
    const b = backpack[slot];
    const r = reely[slot];
    console.log(`    hover.${slot}: backpack=${fmt(b)} reely=${fmt(r)}`);
    if ((b === null) !== (r === null)) {
      // Real, and specifically expected for `root`: Backpack's compound
      // variant zooms `playerWrapper` (the box around the media, not only
      // the cover) whenever `hoverEffect` is on, with or without a custom
      // cover; Reely's stylesheet has no rule that zooms the root or its
      // media wrapper, only `.ef-video-cover-image`. Not declared in
      // `docs/backpack-parity.md` today, so it is reported as a finding
      // rather than silently allowed — see the report's own note on it.
      pair.findings.push({
        pair: pair.label,
        measurement: `hover.${slot}.present`,
        backpack: b !== null,
        reely: r !== null,
        detail: `${pair.label} — hover.${slot}: one side has a hoverable element, the other has none (backpack=${fmt(b)} reely=${fmt(r)})`
      });
      continue;
    }
    if (b === null || r === null) continue;
    compare(
      pair,
      `hover.${slot}.scale`,
      b.scale,
      r.scale,
      nearly(b.scale, r.scale, SCALE_TOLERANCE)
    );
    compare(
      pair,
      `hover.${slot}.transitionDurationMs`,
      b.transitionDurationMs,
      r.transitionDurationMs,
      nearly(
        b.transitionDurationMs,
        r.transitionDurationMs,
        DURATION_TOLERANCE_MS
      )
    );
  }
}

/**
 * The measurement pass this whole harness exists for: every resolvable
 * matrix pair, driven through Backpack's real Storybook and Reely's, and
 * compared through the one set of functions in `measure.ts`. Per the plan:
 * report every pair whether it passes or not, fail only on an undeclared
 * divergence, and report anything that cannot be measured reliably as
 * unmeasurable rather than loosen an assertion to always pass.
 */
test('every resolvable parity pair is measured through one function, and every divergence is declared or reported', async ({
  browser
}) => {
  test.setTimeout(SUITE_TIMEOUT_MS);

  const markdown = readFileSync(DOC_PATH, 'utf-8');
  const rows = parseParityMatrix(markdown);
  const [reelyIndex, backpackIndex] = await Promise.all([
    fetchStoryIndex(REELY_ORIGIN),
    fetchStoryIndex(BACKPACK_ORIGIN)
  ]);
  const { resolved, unresolved } = resolveParityPairs(
    rows,
    backpackIndex,
    reelyIndex
  );

  console.log(
    `\n=== Parity matrix: ${rows.length} rows, ${resolved.length} resolved, ${unresolved.length} unresolved ===`
  );
  if (unresolved.length > 0) {
    console.log('Unresolved (matrix drift — this run FAILS on it, see below):');
    for (const name of unresolved) console.log(`  - ${name}`);
  }

  // Operational escape hatch, not a feature of the harness itself: the full
  // sweep drives ~36 pairs against Backpack's real network, which is long
  // enough that running it as one foreground command risks a shell/tool
  // timeout or memory pressure from an unrelated process on the machine
  // starving the one Chromium instance this test needs. `PARITY_PAIR_RANGE`
  // (e.g. `0-12`) lets a hand-run invocation slice the same resolved list
  // into batches without touching what gets measured or how; unset, it runs
  // every resolved pair, which is what CI-equivalent local runs and the
  // verification the plan asks for both do.
  const range = process.env.PARITY_PAIR_RANGE;
  const batch = range
    ? (() => {
        const [start, end] = range.split('-').map(Number);
        return resolved.slice(start, end);
      })()
    : resolved;
  if (range) {
    console.log(
      `Running batch ${range} of ${resolved.length} resolved pairs (${batch.length} in this batch).`
    );
  }

  const backpackPage = await browser.newPage();
  const reelyPage = await browser.newPage();

  const findings: Finding[] = [];
  const outcomes: PairOutcome[] = [];

  for (const resolvedPair of batch) {
    const { row, backpackId } = resolvedPair;
    const reelyStory = pickReelyStory(row, resolvedPair.reelyIds);
    const label = `${row.section} / \`${row.backpackStoryName}\` ↔ ${reelyStory.title} → ${reelyStory.name}`;
    const pair: PairContext = {
      findings,
      label,
      row,
      reelyIsMock: reelyStory.isMock
    };
    console.log(`\n--- ${label} [${row.status}] ---`);

    try {
      await backpackPage.goto(`${BACKPACK_ORIGIN}${story(backpackId)}`, {
        timeout: NAVIGATION_TIMEOUT_MS
      });
      await reelyPage.goto(`${REELY_ORIGIN}${story(reelyStory.id)}`, {
        timeout: NAVIGATION_TIMEOUT_MS
      });
    } catch (error) {
      console.log(
        `    UNMEASURABLE: navigation failed — ${(error as Error).message}`
      );
      outcomes.push({
        label,
        status: 'unmeasurable',
        reason: `navigation failed: ${(error as Error).message}`
      });
      continue;
    }

    const backpackRootVisible = await backpackPage
      .locator(ROOT_SELECTOR)
      .first()
      .waitFor({ state: 'visible', timeout: ROOT_WAIT_MS })
      .then(() => true)
      .catch(() => false);
    const reelyRootVisible = await reelyPage
      .locator(ROOT_SELECTOR)
      .first()
      .waitFor({ state: 'visible', timeout: ROOT_WAIT_MS })
      .then(() => true)
      .catch(() => false);

    if (!backpackRootVisible && !reelyRootVisible) {
      // Both sides render no player at all for this row — the
      // `DefaultThemeConfig` shape, a JSON dump rather than a player. Not a
      // finding: there is nothing to measure on either side.
      console.log(
        `    UNMEASURABLE: neither side renders ${ROOT_SELECTOR} (a JSON-dump story, not a player)`
      );
      outcomes.push({
        label,
        status: 'unmeasurable',
        reason: `neither side renders ${ROOT_SELECTOR}`
      });
      continue;
    }
    if (!backpackRootVisible || !reelyRootVisible) {
      const which = backpackRootVisible ? 'reely' : 'backpack';
      // "Not visible within the wait" and "not in the document" are different
      // facts, and saying the first when the second is false misreports the
      // component. Backpack's `VideoHoverPreview` is the case that forced this
      // apart: it renders `.ef-video-player` at rest and hides it with
      // `display: none` until the preview runs, so the first wording of this
      // message ("never rendered") was untrue of all nine of its rows. The
      // pair stays unmeasurable either way — a `display: none` box has no
      // geometry to compare against a laid-out one — but the report now names
      // what was on the page.
      const detail = await describeRoot(
        backpackRootVisible ? reelyPage : backpackPage
      );
      const reason = `${which}'s ${ROOT_SELECTOR} was not visible within ${ROOT_WAIT_MS}ms — ${detail}`;
      console.log(`    UNMEASURABLE: ${reason}`);
      outcomes.push({ label, status: 'unmeasurable', reason });
      continue;
    }

    // A cover image is not always present the instant the root is: on the
    // `Real` suite (and on Backpack whenever a row leaves `light` at its own
    // default `true`), the image comes from an oEmbed lookup that resolves
    // after mount (`useVideoThumbnail` on Reely's side, react-player's own
    // light-mode fetch on Backpack's). `.ef-video-player` being visible says
    // nothing about that fetch having settled, so a fixed settle wait runs
    // before the first measurement rather than trusting first paint —
    // otherwise a real cover would be measured as absent purely on timing.
    await backpackPage.waitForTimeout(COVER_SETTLE_MS);
    await reelyPage.waitForTimeout(COVER_SETTLE_MS);

    // 1-3, 5-6: pre-activation geometry and structure. Needs no successful
    // media load on either side, which is why the plan prefers it.
    const backpackPre = await measure(backpackPage);
    const reelyPre = await measure(reelyPage);
    compareMeasurements(pair, 'pre', backpackPre, reelyPre);

    // 4: hover zoom and transition duration, both the cover and the root.
    const backpackHover = await measureHoverZoom(backpackPage);
    const reelyHover = await measureHoverZoom(reelyPage);
    compareHover(pair, backpackHover, reelyHover);

    // 5 continued: whether a player region mounts once the surface is
    // activated. Best-effort — a click that never leads anywhere within the
    // wait is reported through the `post` measurement rather than failing
    // the pair outright, since Backpack's own click may depend on real
    // network the plan already warns is slow.
    const backpackClicked = await activate(backpackPage);
    const reelyClicked = await activate(reelyPage);
    await backpackPage.waitForTimeout(POST_CLICK_WAIT_MS);
    await reelyPage.waitForTimeout(POST_CLICK_WAIT_MS);
    console.log(
      `    clicked: backpack=${backpackClicked} reely=${reelyClicked}`
    );

    const backpackPost = await measure(backpackPage);
    const reelyPost = await measure(reelyPage);
    compareMeasurements(pair, 'post', backpackPost, reelyPost);

    outcomes.push({ label, status: 'measured' });
  }

  await backpackPage.close();
  await reelyPage.close();

  const measuredCount = outcomes.filter((o) => o.status === 'measured').length;
  const unmeasurableCount = outcomes.filter(
    (o) => o.status === 'unmeasurable'
  ).length;

  console.log(
    `\n=== Summary: ${measuredCount}/${batch.length} pairs measured (of ${resolved.length} resolved overall), ${unmeasurableCount} unmeasurable, ${unresolved.length} unresolved, ${findings.length} undeclared findings ===`
  );
  for (const outcome of outcomes.filter((o) => o.status === 'unmeasurable')) {
    console.log(`  UNMEASURABLE: ${outcome.label} — ${outcome.reason}`);
  }
  for (const name of unresolved) {
    console.log(`  UNRESOLVED: ${name}`);
  }
  for (const finding of findings) {
    console.log(`  FINDING: ${finding.detail}`);
  }

  // An unresolvable matrix name fails the run — the plan's own decision under
  // "Resolve story ids from `index.json`, never hand-write them": "An
  // unresolvable name fails the run — that is matrix drift, and catching it is
  // half the point of deriving the pair list from the matrix at all."
  //
  // `expect.soft` and placed here, after the sweep rather than before it, for
  // two reasons. A run that aborts before measuring anything tells a
  // maintainer about drift and nothing else, where the same run finished tells
  // them about drift *and* every divergence — and the drift is not a
  // prerequisite for measuring the 36 rows that do resolve. And soft means
  // this and the hard assertion below both report: a hard `expect` here would
  // end the test on the first drifted name and hide the findings entirely.
  // `parity-matrix.check.ts` covers the resolver's own behaviour against
  // fixtures; this is the one place the REAL matrix is held to it.
  expect
    .soft(
      unresolved,
      `${unresolved.length} matrix name(s) resolve to no story in either Storybook's /index.json. This is matrix drift in docs/backpack-parity.md:\n${unresolved.map((name) => `  - ${name}`).join('\n')}`
    )
    .toEqual([]);

  expect(findings, findings.map((f) => f.detail).join('\n')).toEqual([]);
});
