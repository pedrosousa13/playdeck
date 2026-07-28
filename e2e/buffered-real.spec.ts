import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

// #91: buffered ranges, asserted against the live providers. Both adapters
// derive them from a third-party API whose behaviour is not documented
// accurately -- YouTube's `getVideoLoadedFraction()` reports the end of the
// range holding the playhead rather than how much is loaded, and Vimeo's
// `progress` event reports the same quantity while `getBuffered()` reports the
// ranges themselves. A unit test can only assert what our fake returns, so the
// guard against those APIs changing under us lives here.
//
// It only guards when someone runs it, though. The 05:17 UTC schedule that used
// to exercise it without being asked is retired (#118): on a runner, YouTube
// answers `/youtubei/v1/player` with a 200 and then serves no stream at all --
// zero `googlevideo.com/videoplayback` requests, against three from the same
// commit locally -- so playback never starts and the adapter reports a
// recoverable `blocked`. That measured GitHub's IP reputation, not the
// adapters. Run this by hand when either adapter changes.
//
// Tagged @real: nondeterministic, excluded from blocking runs. Run with
//   REELY_REAL_PROVIDERS=1 pnpm test:e2e --project=chromium --grep @real

type Range = { readonly start: number; readonly end: number };

const buffered = (page: Page): Promise<readonly Range[]> =>
  page.evaluate(() => window.reelyHandle?.getState().buffered ?? []);

const startPlayback = async (page: Page, story: string): Promise<void> => {
  await page.goto(`/iframe.html?id=${story}&viewMode=story`);
  const activation = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await activation.waitFor();
  await activation.click();
  await page.evaluate(() => window.reelyHandle?.whenReady());
  await page.evaluate(async () => {
    await window.reelyHandle?.mute();
    await window.reelyHandle?.play();
  });
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing', {
    timeout: 60_000
  });
};

// Seeking well ahead of the playhead is what separates a real range from a
// fabricated one: it leaves a hole no honest reporter paints over.
const seekAhead = async (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const duration = window.reelyHandle?.getState().duration ?? 0;
    const target = duration * 0.7;
    await window.reelyHandle?.seekTo(target);
    return target;
  });

test(
  'youtube anchors its buffered range where playback entered the buffer @real',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(120_000);
    await startPlayback(page, 'fixtures-playerfixture--interaction-youtube');

    await expect
      .poll(() => buffered(page), { timeout: 30_000 })
      .not.toEqual([]);

    const target = await seekAhead(page);
    expect(target).toBeGreaterThan(1);

    await expect
      .poll(
        async () => {
          const ranges = await buffered(page);
          return ranges.length === 1 && ranges[0]!.start > 1;
        },
        { timeout: 30_000 }
      )
      .toBe(true);

    const [entered] = await buffered(page);
    // The one range is what the API can back: it runs from where playback
    // entered this buffer to the buffer's edge. A range from zero would be a
    // claim about 0-to-the-seek-target that nothing has loaded.
    expect(entered!.start).toBeGreaterThan(target - 5);

    // And it stays put as playback moves on. A range re-anchored on the
    // playhead every poll would follow the thumb instead.
    await expect
      .poll(
        () =>
          page.evaluate(() => window.reelyHandle?.getState().currentTime ?? 0),
        { timeout: 30_000 }
      )
      .toBeGreaterThan(entered!.start + 3);

    const [held] = await buffered(page);
    const currentTime = await page.evaluate(
      () => window.reelyHandle?.getState().currentTime ?? 0
    );
    expect(held!.start).toBeCloseTo(entered!.start, 1);
    expect(held!.end).toBeGreaterThan(currentTime);
  }
);

test(
  'vimeo reports the real, disjoint buffered ranges @real',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(120_000);
    await startPlayback(
      page,
      'fixtures-playerfixture--vimeo-interaction-muted'
    );

    await expect
      .poll(() => buffered(page), { timeout: 30_000 })
      .not.toEqual([]);
    const beforeSeek = await buffered(page);
    expect(beforeSeek[0]!.start).toBeCloseTo(0, 1);

    await seekAhead(page);

    // Vimeo does not backfill the skipped region, so the gap survives: a
    // reporter deriving ranges from the progress event would collapse both
    // sides into one span from zero and hide it.
    await expect
      .poll(
        async () => {
          const ranges = await buffered(page);
          return ranges.some((range) => range.start > 1);
        },
        { timeout: 30_000 }
      )
      .toBe(true);

    const ranges = await buffered(page);
    const duration = await page.evaluate(
      () => window.reelyHandle?.getState().duration ?? 0
    );
    ranges.forEach((range) => {
      expect(range.end).toBeGreaterThan(range.start);
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(duration + 1);
    });
  }
);
