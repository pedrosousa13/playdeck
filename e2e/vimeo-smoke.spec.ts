import { expect, test, type Page } from '@playwright/test';

// Real-provider smoke tests: tagged @real so they never block CI (see
// grepInvert in playwright.config.ts). Run with:
//   REELY_REAL_PROVIDERS=1 pnpm test:e2e -- --grep @real

type CapabilityValue = {
  readonly status: string;
  readonly reason?: string;
};

declare global {
  interface Window {
    reelyHandle?: {
      getState: () => {
        activation: string;
        playback: string;
        captionRendering: string;
        capabilities: Record<string, CapabilityValue>;
      };
      selectTextTrack: (track: string | null) => Promise<{ ok: boolean }>;
      seekTo: (seconds: number) => Promise<{ ok: boolean }>;
    };
  }
}

const capability = (
  page: Page,
  name: string
): Promise<CapabilityValue | undefined> =>
  page.evaluate(
    (capabilityName) =>
      window.reelyHandle?.getState().capabilities[capabilityName],
    name
  );

test(
  'plays a real Vimeo video chromeless and delivers caption cue text',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(
      '/iframe.html?id=fixtures-playerfixture--vimeo-interaction-muted&viewMode=story'
    );
    const activation = page.getByRole('button', { name: 'Play video' });
    await activation.waitFor();
    await activation.click();

    const iframe = page.locator('[data-reely-part="media"] iframe');
    await expect(iframe).toHaveAttribute(
      'src',
      /^https:\/\/player\.vimeo\.com\/video\/76979871\?/
    );
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({
      timeout: 60_000
    });

    // 76979871 carries de/es/en/fr subtitles; discovery must surface them.
    await expect
      .poll(() => capability(page, 'selectTextTrack'), { timeout: 30_000 })
      .toEqual({ status: 'available' });
    const selection = await page.evaluate(() =>
      window.reelyHandle?.selectTextTrack('vimeo:en')
    );
    expect(selection).toMatchObject({ ok: true });

    // #16: Vimeo hands its cues over rather than drawing them, so the whole
    // chain has to work on the real embed — `cuechange` fires with the track
    // enabled `showing: false`, the payload's markup normalizes to plain text,
    // and the result reaches Reely's own overlay. Asserting on the overlay
    // covers all three at once, and avoids a second Vimeo Player instance
    // competing with the adapter for ownership of the same track.
    await expect
      .poll(
        () =>
          page.evaluate(() => window.reelyHandle?.getState().captionRendering),
        { timeout: 30_000 }
      )
      .toBe('custom');
    await page.evaluate(() => window.reelyHandle?.seekTo(10));

    const cue = page.locator('[data-reely-part="caption-cue"]').first();
    await expect(cue).toHaveText(/\S/, { timeout: 30_000 });
    // Normalization ran: no WebVTT tag or Vimeo's U+21B5 line separator
    // survives into what the viewer reads.
    const text = (await cue.textContent()) ?? '';
    expect(text).not.toMatch(/[<>↵]/);
  }
);

test(
  'reports provider-plan for chromeless controls on a free-plan video',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(
      '/iframe.html?id=fixtures-playerfixture--vimeo-free-plan&viewMode=story'
    );
    await page.getByRole('button', { name: 'Play video' }).click();
    await expect
      .poll(() => capability(page, 'customControls'), { timeout: 60_000 })
      .toEqual({ status: 'unavailable', reason: 'provider-plan' });
  }
);

test(
  'reports chromeless controls available on a paid-plan video',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(
      '/iframe.html?id=fixtures-playerfixture--vimeo-paid-plan&viewMode=story'
    );
    await page.getByRole('button', { name: 'Play video' }).click();
    await expect
      .poll(() => capability(page, 'customControls'), { timeout: 60_000 })
      .toEqual({ status: 'available' });
  }
);
