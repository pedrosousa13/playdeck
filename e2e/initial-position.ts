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
// `applyInitialPosition` runs on the `loadedmetadata` of that second load and
// of no other, so between the attach snapshot and it there is a window in which
// the duration is published, the position has provably not been applied, and
// the playhead still reads 0. `packages/core/src/player-controller.ts` states
// the same ordering from the other side, on `#loadedGeneration`: a provider may
// report ready from inside `attach()`, while `load()` is only queued once
// `attach()` returns.
//
// Firefox is the engine that opens that window widest here: it reaches
// `HAVE_METADATA` on the pre-provider load of a 7KB clip before the provider's
// dynamic import resolves, so the attach snapshot carries a duration. Measured
// on 2026-09-02 on the maintainer's machine, the four firefox tests across the
// two start-offset specs run 20 times each: 4 of those 100 runs read the state
// inside the window and failed -- twice at
// `start-time-above-seekable-end.spec.ts:92`, once at `:117` with no notice
// published yet, once at `:137`.
//
// So the gate counts the loads the provider starts itself, and waits for one of
// them to have been handled to completion.

type LoadCounts = {
  // Raised by `media.load()`, which in a workbench story is the provider's own
  // load and nothing else. It runs synchronously, so a read that sees this go
  // up is a read after the element went back to `HAVE_NOTHING`: the previous
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

// Resolves once the provider has handled the `loadedmetadata` of a load it
// started itself, which is the dispatch `applyInitialPosition` runs in. After
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
