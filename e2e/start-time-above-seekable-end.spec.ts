import { expect, test, type Page } from '@playwright/test';

// #466: a `startTime` inside the media's real length but above the end of the
// seekable window at the moment metadata first arrives.
//
// `apps/storybook/public/tracer.mp4` is a 1.000s clip, so the shape #466
// describes -- `startTime: 9` against `[[0, 8.734]]` with a duration of 10 --
// is reproduced here scaled onto that clip's real duration: a requested start
// of 0.9 against a window that ends at 0.7. The start keeps #466's ratio; the
// window end is rounded rather than scaled, since 0.8734 buys nothing here.
const SEEKABLE_END = 0.7;
const START_TIME = 0.9;

const STORY =
  '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story&args=startTime:0.9';

// The window is imposed rather than waited for, and that is the one part of
// this path that is not real. #466's measurement is a delivery-timing artefact
// -- a progressively parsed file whose `seekable` trails the duration the
// container already declares -- and the 7KB fixture this workbench serves
// arrives whole well before `loadedmetadata`, so that race cannot be lost on
// purpose here. Everything downstream of the window is real: the real
// provider, a real `<video>`, and a real React consumer reading the published
// `PlayerState`.
//
// Two limits follow from imposing it, and neither is visible from the results.
//
// It overrides what JS reads, not the engine's seek algorithm: asked to seek to
// 0.9 this element would happily land there, where a real #466 element would
// clamp to 0.7. That is unobservable while the provider refuses before writing,
// but it means these tests pin the provider's own pre-check and nothing else.
// A future fix that dropped that pre-check and leaned on engine clamping would
// still pass here and still be wrong in the field.
//
// And imposing the window cannot answer #466's other question -- whether
// engines other than the one it was measured on ever *produce* this shape under
// their own delivery timing. These tests prove the provider's response to the
// shape, on every engine. Whether a given engine reaches it is still open.
//
// It is dynamic so the latch below has something to fail to retry into: the
// window widens back to the element's own once `widenSeekable()` runs.
const narrowSeekableWindow = async (page: Page, end: number): Promise<void> => {
  await page.addInitScript((windowEnd: number) => {
    const real = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'seekable'
    );
    if (!real?.get)
      throw new Error('HTMLMediaElement.seekable is not a getter');
    Object.defineProperty(HTMLMediaElement.prototype, 'seekable', {
      configurable: true,
      get(this: HTMLMediaElement): TimeRanges {
        if ((window as unknown as Record<string, unknown>).playdeckWideSeekable)
          return real.get!.call(this) as TimeRanges;
        return {
          length: 1,
          start: () => 0,
          end: () => windowEnd
        } as unknown as TimeRanges;
      }
    });
  }, end);
};

// Widens the window and makes the provider look at it again. The `progress`
// dispatch is what a still-downloading element fires on its own; here the
// fixture finished downloading long ago, so nothing would fire it and the
// provider would keep republishing the narrow window purely for want of an
// event. The handler it reaches is the real one.
const widenSeekable = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).playdeckWideSeekable = true;
    document.querySelector('video')?.dispatchEvent(new Event('progress'));
  });
};

// `loadedmetadata` is when `applyInitialPosition` runs, and a published
// duration is the consumer-visible signal that it has been and gone.
const metadataArrived = async (page: Page): Promise<void> => {
  await expect
    .poll(() => page.evaluate(() => window.playdeckHandle?.getState().duration))
    .toBeGreaterThan(0);
};

const currentTime = (page: Page): Promise<number | undefined> =>
  page.evaluate(() => window.playdeckHandle?.getState().currentTime);

// The control. Nothing about the window is touched, so this is the same story,
// the same arg and the same code path with only the defect's precondition
// removed -- which is what makes the failure below attributable to the window
// shape rather than to a `startTime` that never reached the player at all.
test('applies a startTime the seekable window already covers', async ({
  page
}) => {
  await page.goto(STORY);
  await metadataArrived(page);

  expect(await currentTime(page)).toBeCloseTo(START_TIME, 2);
});

// THE REPRODUCTION, and it documents today's behaviour rather than endorsing
// it. #466 asks for the offset to be honoured -- or refused observably -- and
// today it is the second of those: the playhead stays where the load left it,
// and the consumer is told why. Change this test deliberately when #466's
// remedy lands; that is the point of having it.
//
// It is NOT silent, which corrects #466's body. The `startTime` is dropped, but
// #418's `configuration` notice fires on exactly this shape.
//
// Which arm of that notice fires is worth naming, because two of the three
// cannot. `applyInitialPosition` bounds on the declared length, and the clip is
// 1.000s, so the requested 0.9 survives `withinDeclaredBounds` untouched and
// `target !== startTime` is dead here. The refusal comes one step later, from
// `declinesSeekTo` inside `playheadAfterMovingTo`, which answers `undefined`
// because the seekable window does not contain 0.9. So `reached === undefined`
// is the live arm, and it is the one a mutation has to break to move this test.
test('drops a startTime above the seekable window end, with a notice (#466)', async ({
  page
}) => {
  await narrowSeekableWindow(page, SEEKABLE_END);
  await page.goto(STORY);
  await metadataArrived(page);

  expect(await currentTime(page)).toBe(0);
  expect(
    await page.evaluate(() => window.playdeckHandle?.getState().error)
  ).toMatchObject({ category: 'configuration', fatal: false });
});

// The latch, stated explicitly. `applyInitialPosition` sets `positioned` before
// it has decided anything, so the refusal above is permanent for the load: a
// window that later grows past the requested start is never reconsidered.
//
// This documents the gap rather than endorsing it, the same as the test above,
// and it is the one the follow-up issue is about. Change it deliberately when
// the re-attempt lands -- it goes red on that fix, and that is the point.
test('never reconsiders the startTime once the window widens (#466)', async ({
  page
}) => {
  await narrowSeekableWindow(page, SEEKABLE_END);
  await page.goto(STORY);
  await metadataArrived(page);
  expect(await currentTime(page)).toBe(0);

  await widenSeekable(page);
  // `progress` is what republishes the window here, so the provider does see
  // the wider one -- it just has nothing that re-applies the start. Not
  // `durationchange`: `onProgress` and the media-state emit are the only two
  // that carry a `seekable` key, and `attachment.ts` leaves it out of the
  // duration patch deliberately, because a duration changing says nothing about
  // the window that a `progress` has not already said.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(
          0,
          ...(window.playdeckHandle?.getState().seekable ?? []).map(
            (range) => range.end
          )
        )
      )
    )
    .toBeGreaterThan(SEEKABLE_END);

  expect(await currentTime(page)).toBe(0);
});
