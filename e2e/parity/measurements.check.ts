import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  declaredDivergence,
  type DeclarableMeasurement
} from './declared-divergences';
import {
  AFFORDANCE_SELECTOR,
  measure,
  measureHoverZoom,
  story,
  type HoverMeasurement,
  type Measurement
} from './measure';
import {
  parseParityMatrix,
  resolveParityPairs,
  type ParityRow
} from './parity-matrix';
import { fetchStoryIndex } from './story-index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(__dirname, '../../docs/backpack-parity.md');

const BACKPACK_ORIGIN = 'http://127.0.0.1:6007';
const REELY_ORIGIN = 'http://127.0.0.1:4173';

// Generous on purpose: up to 36 resolvable pairs, each driving two page loads
// plus a hover and a click, several of them against Backpack's own real
// network (Vimeo/YouTube/Wistia/oEmbed) rather than a mock. The plan warns to
// expect slowness there rather than tighten this — a flaky per-story timeout
// would fail pairs that are fine, just slow.
const SUITE_TIMEOUT_MS = 25 * 60 * 1000;
const ROOT_WAIT_MS = 10_000;
const COVER_SETTLE_MS = 3_000;
const POST_CLICK_WAIT_MS = 3_000;
const ASPECT_RATIO_TOLERANCE = 0.02;
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
): { id: string; title: string; name: string } {
  const mockIndex = row.reelyStories.findIndex((s) =>
    s.title.includes('/Mock/')
  );
  const index = mockIndex === -1 ? 0 : mockIndex;
  return { id: reelyIds[index], ...row.reelyStories[index] };
}

const fmt = (value: unknown): string => JSON.stringify(value);

/** Logs one comparison line and returns whether it needs to be recorded as a
 * finding. `declarable` names the measurement in `declared-divergences.ts`
 * terms when a mismatch there is allowed to be a known, cited divergence
 * rather than a fresh one; omitted for measurements the plan gives no
 * mechanism to declare (a numeric geometry mismatch always has to be real). */
function compare(
  findings: Finding[],
  pairLabel: string,
  row: ParityRow,
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
  const reason = declarable ? declaredDivergence(row, declarable) : undefined;
  if (reason !== undefined) {
    console.log(
      `    ${measurementName}: DECLARED backpack=${fmt(backpackValue)} reely=${fmt(reelyValue)} — ${reason}`
    );
    return;
  }
  console.log(
    `    ${measurementName}: FINDING backpack=${fmt(backpackValue)} reely=${fmt(reelyValue)}`
  );
  findings.push({
    pair: pairLabel,
    measurement: measurementName,
    backpack: backpackValue,
    reely: reelyValue,
    detail: `${pairLabel} — ${measurementName} differs and is not a declared divergence: backpack=${fmt(backpackValue)} reely=${fmt(reelyValue)}`
  });
}

const nearly = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(a - b) <= tolerance;

async function clickFirstAffordance(page: Page): Promise<boolean> {
  const target = page.locator(AFFORDANCE_SELECTOR).first();
  if ((await target.count()) === 0) return false;
  try {
    await target.click({ timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function compareMeasurements(
  findings: Finding[],
  pairLabel: string,
  row: ParityRow,
  phase: 'pre' | 'post',
  backpack: Measurement,
  reely: Measurement
): void {
  if (backpack.root === null || reely.root === null) {
    console.log(
      `    root[${phase}]: backpack=${backpack.root === null ? 'absent' : 'present'} reely=${reely.root === null ? 'absent' : 'present'}`
    );
    if ((backpack.root === null) !== (reely.root === null)) {
      findings.push({
        pair: pairLabel,
        measurement: `root.present[${phase}]`,
        backpack: backpack.root !== null,
        reely: reely.root !== null,
        detail: `${pairLabel} — one side has no .ef-video-player at all in the ${phase}-activation state while the other does`
      });
    }
    return;
  }

  compare(
    findings,
    pairLabel,
    row,
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
    findings,
    pairLabel,
    row,
    `cover.present[${phase}]`,
    backpack.cover !== null,
    reely.cover !== null,
    (backpack.cover === null) === (reely.cover === null)
  );
  if (backpack.cover !== null && reely.cover !== null) {
    compare(
      findings,
      pairLabel,
      row,
      `cover.objectFit[${phase}]`,
      backpack.cover.objectFit,
      reely.cover.objectFit,
      backpack.cover.objectFit === reely.cover.objectFit
    );
  }

  compare(
    findings,
    pairLabel,
    row,
    `playIcon.present[${phase}]`,
    backpack.playIcon !== null,
    reely.playIcon !== null,
    (backpack.playIcon === null) === (reely.playIcon === null),
    'playIconPresence'
  );
  if (backpack.playIcon !== null && reely.playIcon !== null) {
    compare(
      findings,
      pairLabel,
      row,
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
  // provider is expected to attach the same way Backpack's does.
  const reelyIsMock = pairLabel.includes('Backpack parity/Mock/');
  console.log(
    `    mounted[${phase}]: backpack=${backpack.mounted} reely=${reely.mounted}${reelyIsMock ? ' (reely: Mock suite never commits a source — informational only)' : ''}`
  );
  if (!reelyIsMock) {
    compare(
      findings,
      pairLabel,
      row,
      `mounted[${phase}]`,
      backpack.mounted,
      reely.mounted,
      backpack.mounted === reely.mounted
    );
  }

  compare(
    findings,
    pairLabel,
    row,
    `accessibleTargets[${phase}]`,
    backpack.accessibleTargets,
    reely.accessibleTargets,
    JSON.stringify(backpack.accessibleTargets) ===
      JSON.stringify(reely.accessibleTargets),
    'accessibleName'
  );
}

function compareHover(
  findings: Finding[],
  pairLabel: string,
  row: ParityRow,
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
      findings.push({
        pair: pairLabel,
        measurement: `hover.${slot}.present`,
        backpack: b !== null,
        reely: r !== null,
        detail: `${pairLabel} — hover.${slot}: one side has a hoverable element, the other has none (backpack=${fmt(b)} reely=${fmt(r)})`
      });
      continue;
    }
    if (b === null || r === null) continue;
    compare(
      findings,
      pairLabel,
      row,
      `hover.${slot}.scale`,
      b.scale,
      r.scale,
      nearly(b.scale, r.scale, SCALE_TOLERANCE)
    );
    compare(
      findings,
      pairLabel,
      row,
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
    console.log(
      "Unresolved (matrix drift, not this task's to fix — see task-1-report.md):"
    );
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

  for (const pair of batch) {
    const { row, backpackId } = pair;
    const reelyStory = pickReelyStory(row, pair.reelyIds);
    const label = `${row.section} / \`${row.backpackStoryName}\` ↔ ${reelyStory.title} → ${reelyStory.name}`;
    console.log(`\n--- ${label} [${row.status}] ---`);

    try {
      await backpackPage.goto(`${BACKPACK_ORIGIN}${story(backpackId)}`, {
        timeout: 15_000
      });
      await reelyPage.goto(`${REELY_ORIGIN}${story(reelyStory.id)}`, {
        timeout: 15_000
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
      .locator('.ef-video-player')
      .first()
      .waitFor({ state: 'visible', timeout: ROOT_WAIT_MS })
      .then(() => true)
      .catch(() => false);
    const reelyRootVisible = await reelyPage
      .locator('.ef-video-player')
      .first()
      .waitFor({ state: 'visible', timeout: ROOT_WAIT_MS })
      .then(() => true)
      .catch(() => false);

    if (!backpackRootVisible && !reelyRootVisible) {
      // Both sides render no player at all for this row — the
      // `DefaultThemeConfig` shape, a JSON dump rather than a player. Not a
      // finding: there is nothing to measure on either side.
      console.log(
        '    UNMEASURABLE: neither side renders .ef-video-player (a JSON-dump story, not a player)'
      );
      outcomes.push({
        label,
        status: 'unmeasurable',
        reason: 'neither side renders .ef-video-player'
      });
      continue;
    }
    if (!backpackRootVisible || !reelyRootVisible) {
      const which = backpackRootVisible ? 'reely' : 'backpack';
      console.log(
        `    UNMEASURABLE: ${which} never rendered .ef-video-player within ${ROOT_WAIT_MS}ms`
      );
      outcomes.push({
        label,
        status: 'unmeasurable',
        reason: `${which} never rendered .ef-video-player within ${ROOT_WAIT_MS}ms`
      });
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
    compareMeasurements(findings, label, row, 'pre', backpackPre, reelyPre);

    // 4: hover zoom and transition duration, both the cover and the root.
    const backpackHover = await measureHoverZoom(backpackPage);
    const reelyHover = await measureHoverZoom(reelyPage);
    compareHover(findings, label, row, backpackHover, reelyHover);

    // 5 continued: whether a player region mounts once the surface is
    // activated. Best-effort — a click that never leads anywhere within the
    // wait is reported through the `post` measurement rather than failing
    // the pair outright, since Backpack's own click may depend on real
    // network the plan already warns is slow.
    const backpackClicked = await clickFirstAffordance(backpackPage);
    const reelyClicked = await clickFirstAffordance(reelyPage);
    await backpackPage.waitForTimeout(POST_CLICK_WAIT_MS);
    await reelyPage.waitForTimeout(POST_CLICK_WAIT_MS);
    console.log(
      `    clicked: backpack=${backpackClicked} reely=${reelyClicked}`
    );

    const backpackPost = await measure(backpackPage);
    const reelyPost = await measure(reelyPage);
    compareMeasurements(findings, label, row, 'post', backpackPost, reelyPost);

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
  for (const finding of findings) {
    console.log(`  FINDING: ${finding.detail}`);
  }

  expect(findings, findings.map((f) => f.detail).join('\n')).toEqual([]);
});
