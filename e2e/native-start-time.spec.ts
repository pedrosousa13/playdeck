import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { media } from './locators';

// #465, driven on real engines because the defect is one engines disagree
// about. The story is the only one in the workbench on a clip longer than a
// second: at one second every offset worth configuring is past the end of the
// media, so the one-second tracer can express the refusal and nothing else.
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

// The offset is applied at the first `loadedmetadata` and never again, so the
// outcome is settled once the provider has handled that event — and the
// published duration is the signal for it, because the provider's handler
// applies the position and then publishes the media snapshot the duration comes
// from (`provider-native/src/attachment.ts`, `onLoadedMetadata`).
//
// The element's own `readyState` is NOT that signal, and reading it here is a
// race this test lost: chromium reaches `readyState 1` before the handler has
// run, so the outcome was read while the offset was still to be applied and the
// test failed with the playhead at 0 and no notice published — the exact state
// it exists to forbid, reported against a provider that then published the
// notice a moment later.
const metadataApplied = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => window.playdeckHandle?.getState().duration),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0);

// The common case, and the one this change most had to leave alone: an origin
// that serves byte ranges reports a fully populated seekable window at the
// first `loadedmetadata`, and the offset applies. Measured on 2026-09-01 with a
// standalone rig on this clip, `seekable [[0, 10]]` at that point in 24 of 24
// runs across chromium and firefox. The workbench's own dev server serves
// ranges, so this is that path.
test('applies a start offset a range-serving origin can satisfy', async ({
  page
}) => {
  await page.goto(story);
  await metadataApplied(page);

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
  page
}) => {
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

  await page.goto(story);
  await metadataApplied(page);

  const { playhead, refused } = await outcome(page);

  expect(
    Math.abs(playhead - START_TIME) <= TOLERANCE || refused,
    `playhead ${playhead}, refusal published: ${refused}`
  ).toBe(true);
});
