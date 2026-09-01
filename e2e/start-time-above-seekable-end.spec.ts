import { expect, test, type Page } from '@playwright/test';

// #466: a `startTime` inside the media's real length but above the end of the
// seekable window at the moment metadata first arrives.
//
// `apps/storybook/public/tracer.mp4` is a 1.000s clip, so the shape #466
// describes -- `startTime: 9` against `[[0, 8.734]]` with a duration of 10 --
// is reproduced here at the same ratio against that clip's real duration: a
// requested start of 0.9 against a window that ends at 0.7.
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
// The route it fires by changed under #465, and this test was written before
// that landed. It used to be that `withinMediaBounds` answered `undefined` and
// nothing was written. Now `applyInitialPosition` bounds on the declared length
// (`withinDeclaredBounds`), so the target survives as the requested 0.9 -- the
// clip really is 1.000s -- and the refusal comes one step later, from
// `declinesSeekTo` inside `playheadAfterMovingTo`, which returns `undefined`
// because the seekable window does not contain 0.9. The `reached === undefined`
// arm of the notice condition is the live one here.
//
// The observable outcome is identical either way, which is why this test still
// passes unchanged on top of #465. The mechanism is named because a test that
// keeps passing for a changed reason is worth less than one that says which
// reason it is pinning.
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
test('never reconsiders the startTime once the window widens (#466)', async ({
  page
}) => {
  await narrowSeekableWindow(page, SEEKABLE_END);
  await page.goto(STORY);
  await metadataArrived(page);
  expect(await currentTime(page)).toBe(0);

  await widenSeekable(page);
  // `progress` and `durationchange` both republish the window from here on, so
  // the provider does see the wider one -- it just has nothing that re-applies
  // the start.
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
