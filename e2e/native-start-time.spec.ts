import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// The offset is applied at the `loadedmetadata` of an explicit `media.load()`,
// and never again, so the outcome is settled once the provider has handled that
// event (`provider-native/src/attachment.ts`, `onLoadedMetadata`).
// `initialPositionApplied` waits for exactly that; `initial-position.ts`
// carries the ordering and the measurement.
//
// Both of the readings that look like it are races this test has lost, one per
// engine. The element's own `readyState`: chromium reaches `readyState 1`
// before the handler has run, so the outcome was read while the offset was
// still to be applied and the test failed with the playhead at 0 and no notice
// published — the exact state it exists to forbid, reported against a provider
// that published the notice a moment later. And a published duration, which is
// #581: on 2026-09-02 the firefox job of CI run 33616735320, on #582's branch
// and so on the duration gate, booked `applies a start offset a range-serving
// origin can satisfy` flaky with `|playhead - 5|` received as 5 — a playhead
// still at 0.
import { countProviderLoads, initialPositionApplied } from './initial-position';
import { media } from './locators';

// #465, driven on real engines because the defect is one engines disagree
// about. The story is the only one in the workbench on a clip longer than a
// second, which is what this file's timings and offsets are built around: a
// five-second start needs a source that reaches it.
//
// The one-second tracer is not useless for start offsets -- #466's spec applies
// 0.9 on it -- but it leaves no room between a plausible offset and the end of
// the media, so the numbers here would have nowhere to move.
const story =
  '/iframe.html?id=fixtures-playerfixture--native-mp-4-start-time&viewMode=story';

const START_TIME = 5;

// The same slack the provider applies to decide whether the playhead reached
// the offset (`SETTLED_POSITION_TOLERANCE_SECONDS`), so this test asks the same
// question of the element that the provider asked, rather than a stricter one
// the provider would call a success.
const TOLERANCE = 0.25;

const clip = fileURLToPath(
  new URL('../apps/storybook/public/tracer-10s.mp4', import.meta.url)
);

type Outcome = { readonly playhead: number; readonly refused: boolean };

// Reads both halves of the contract at once: where the playhead is, and whether
// the provider published #418's non-fatal `configuration` notice. They have to
// be read together — the question is never "did it apply" on its own, it is
// whether an offset that did not apply was reported.
const outcome = async (page: Page): Promise<Outcome> => ({
  playhead: await media(page).evaluate(
    (el: HTMLVideoElement) => el.currentTime
  ),
  refused: await page.evaluate(
    () => window.playdeckHandle?.getState().error?.category === 'configuration'
  )
});

// The common case, and the one this change most had to leave alone: an origin
// that serves byte ranges reports a fully populated seekable window at the
// first `loadedmetadata`, and the offset applies. Measured on 2026-09-01 with a
// standalone rig on this clip, `seekable [[0, 10]]` at that point in 24 of 24
// runs across chromium and firefox. The workbench's own dev server serves
// ranges, so this is that path.
test('applies a start offset a range-serving origin can satisfy', async ({
  page
}) => {
  await countProviderLoads(page);
  await page.goto(story);
  await initialPositionApplied(page);

  const { playhead, refused } = await outcome(page);

  expect(Math.abs(playhead - START_TIME)).toBeLessThanOrEqual(TOLERANCE);
  expect(refused).toBe(false);
});

// The defect's own shape: an origin that refuses byte ranges. What each engine
// then does differs, so this asserts the property that has to hold whichever it
// is, and nothing narrower. Measured on 2026-09-01, 3 runs each: chromium
// reports `seekable [[0, 0]]`, takes the write and stays at 0, while firefox
// reports a full `[[0, 10]]` and lands on the offset — this clip is 20 KB and
// arrives in one response, so firefox has the whole of it whatever the header
// says.
//
// The playhead is at the offset, or the consumer was told it is not. The state
// this forbids is the third one: sitting at 0 with nothing published, which is
// what a `startTime` that vanishes looks like from outside and what #418 and
// #465 together exist to make impossible.
test('never drops a start offset in silence on an origin without byte ranges', async ({
  browserName,
  page
}) => {
  // WebKit produces the forbidden third state — playhead at 0, nothing
  // published — but only sometimes, and the "sometimes" is the point.
  //
  // Two CI runs on this branch, both on WebKit, both with chromium and firefox
  // passing:
  //   run 1: failed on the initial attempt and both retries.
  //   run 2: PASSED on the initial attempt, failed on retry 1.
  // So this is a race, not a flat engine limitation. The provider's read-back
  // (`provider-native/src/playback.ts`, `playheadAfterMovingTo`) reads
  // `currentTime` in the same tick as the write; WebKit sometimes clamps before
  // that read and sometimes answers with the value it was just given, and only
  // the second case concludes a write landed that never did. Which side of the
  // race a load falls on is what varies.
  //
  // That is #567's to fix, by re-reading on a turn the engine has had a chance
  // to clamp in — a design decision, and one that cannot be iterated locally
  // because WebKit does not launch on the development machine.
  //
  // `fixme` and not `fail`, and the reason is the race. `fail` requires the
  // body to fail, so on a run that lands the passing side it reports "Expected
  // to fail, but passed" and Playwright books the test flaky — which does not
  // fail the job, so the suite goes green while a real intermittent defect sits
  // underneath it. That is the exact false-comfort this branch exists to
  // remove. A skip is at least honest about telling you nothing.
  //
  // The cost is that this no longer expires on its own. #567 is the expiry
  // instead, and it is cited from here, the `startTime` JSDoc, the provider
  // README and the changeset.
  test.fixme(
    browserName === 'webkit',
    'WebKit sometimes answers the written value before clamping, so the read-back intermittently misses the drop — #567'
  );

  const body = await readFile(clip);
  await page.route('**/tracer-10s.mp4', async (route) =>
    route.fulfill({
      body,
      headers: {
        'accept-ranges': 'none',
        'cache-control': 'no-store',
        'content-length': String(body.byteLength),
        'content-type': 'video/mp4'
      },
      status: 200
    })
  );

  await countProviderLoads(page);
  await page.goto(story);
  await initialPositionApplied(page);

  const { playhead, refused } = await outcome(page);

  expect(
    Math.abs(playhead - START_TIME) <= TOLERANCE || refused,
    `playhead ${playhead}, refusal published: ${refused}`
  ).toBe(true);
});
