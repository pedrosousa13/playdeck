import { expect, type Page } from '@playwright/test';

// When a `startTime` has been applied, for the specs that assert where the
// playhead ends up after one.
//
// A published duration is NOT that signal, which is what both start-offset
// specs used to wait for. A native `<video>` is rendered with its `<source>`
// children, so the element begins its own resource selection at mount, while
// the provider module is still being fetched. `NativeAttachment.attach()` then
// publishes a media snapshot of the element as it finds it -- `lifecycle:
// 'ready'` and the real duration, when that first load already reached metadata
// -- and only afterwards does `load()` call `media.load()`, which puts the
// element back to `HAVE_NOTHING` and starts a second load.
// `attachment.ts`'s `onLoadedMetadata` calls `applyInitialPosition` on every
// `loadedmetadata`; the `positioned` latch inside it (`playback.ts`) is what
// makes the offset apply on the first one only, which in a workbench story is
// the one from that second load. So between the attach snapshot and it there is
// a window in which the duration is published, the position has provably not
// been applied, and the playhead still reads 0.
// `packages/core/src/player-controller.ts` states the same ordering from the
// other side, on `#loadedGeneration`: a provider may report ready from inside
// `attach()`, while `load()` is only queued once `attach()` returns.
//
// Firefox is the engine that opens that window widest here: it reaches
// `HAVE_METADATA` on the pre-provider load of a 7KB clip before the provider's
// dynamic import resolves, so the attach snapshot carries a duration.
//
// Measured on 2026-09-02 on the maintainer's machine: the firefox project over
// both start-offset specs -- five tests -- run 20 times each with
// `--retries=0 --workers=1`, 100 runs per gate. On the duration gate 7 of 100
// failed: four in `applies a startTime the seekable window already covers`,
// two in `never reconsiders the startTime once the window widens`, one in
// `drops a startTime above the seekable window end`, while
// `native-start-time.spec.ts`'s two tests passed 40 of 40. On this gate, 100 of
// 100 passed.
//
// Serialise to re-measure that: at Playwright's default worker count the same
// pre-fix specs are far quieter, and two independent 50-run samples the same
// day failed 0 and 3 -- the 3 all in `applies a startTime the seekable window
// already covers`. So the rate above is the rate on an unloaded machine, which
// is where the pre-provider load wins the race most often.
//
// So the gate counts explicit loads, and waits for one of them to have been
// handled to completion.

type LoadCounts = {
  // How many explicit `media.load()` calls the page has made. It does not
  // attribute them and does not need to: the load an element starts by itself
  // at mount does not go through `load()`, so the pre-provider load above --
  // the one whose metadata the attach snapshot publishes -- is never counted,
  // and the `loadedmetadata` of any load that is counted reaches the provider's
  // handler. It is raised synchronously with the call, so a read that sees this
  // go up is a read after the element went back to `HAVE_NOTHING`: the previous
  // load's metadata cannot be mistaken for this load's.
  playdeckProviderLoads?: number;
  // The load whose `loadedmetadata` has been dispatched to every listener.
  playdeckPositionedLoad?: number;
};

// Install before `page.goto`: the element is created, loaded and positioned
// during the navigation, so a listener added afterwards can miss all of it.
export const countProviderLoads = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const counts = window as unknown as LoadCounts;
    counts.playdeckProviderLoads = 0;
    counts.playdeckPositionedLoad = 0;

    const load = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
      counts.playdeckProviderLoads = (counts.playdeckProviderLoads ?? 0) + 1;
      return load.call(this);
    };

    // Capture phase on the document, because `loadedmetadata` does not bubble
    // and this listener has to exist before the element does. It therefore runs
    // BEFORE the provider's own handler, so the count is raised from a task
    // queued here rather than in the listener itself: a task queued during a
    // dispatch runs after the whole dispatch, once every listener including the
    // provider's has returned. A microtask would not -- the checkpoint between
    // two listeners of one event would run it while `applyInitialPosition` was
    // still to come.
    document.addEventListener(
      'loadedmetadata',
      () => {
        const started = counts.playdeckProviderLoads ?? 0;
        setTimeout(() => {
          counts.playdeckPositionedLoad = started;
        }, 0);
      },
      true
    );
  });
};

// Resolves once the provider has handled the `loadedmetadata` of an explicit
// load, which is the dispatch `applyInitialPosition` runs in. After
// it, the playhead is where this load is going to leave it and any refusal
// notice has been published.
export const initialPositionApplied = (page: Page): Promise<void> =>
  expect
    .poll(
      () =>
        page.evaluate(() => {
          const counts = window as unknown as LoadCounts;
          const started = counts.playdeckProviderLoads ?? 0;
          return started > 0 && counts.playdeckPositionedLoad === started;
        }),
      { timeout: 15_000 }
    )
    .toBe(true);
