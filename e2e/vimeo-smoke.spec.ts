import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

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
      pause: () => Promise<{ ok: boolean }>;
      setCaptionRenderer: (mode: 'custom' | 'native') => void;
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
    const activation = page.getByRole('button', {
      name: 'Play video',
      exact: true
    });
    await activation.waitFor();
    await activation.click();

    const iframe = page.locator('[data-reely-part="media"] iframe');
    await expect(iframe).toHaveAttribute(
      'src',
      /^https:\/\/player\.vimeo\.com\/video\/76979871\?/
    );
    await expect(playButton(page)).toHaveAttribute('data-state', 'playing', {
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

    const cues = page.locator('[data-reely-part="caption-cue"]');
    await expect(cues.first()).toHaveText(/\S/, { timeout: 30_000 });
    // Normalization ran: neither a WebVTT tag nor Vimeo's U+21B5 line
    // separator survives into what the viewer reads. Only `<` is checked, not
    // `>`: a correctly escaped `&gt;` decodes to a literal `>` that belongs in
    // the text, whereas a surviving tag always brings a `<` with it.
    const text = (await cues.first().textContent()) ?? '';
    expect(text).not.toMatch(/[<↵]/);

    // Cue exit, not just entry. The payload carries no timings, so a cue can
    // only be retired by Vimeo signalling an empty cue list — if it ever
    // stopped doing that, every cue would stay on screen through the silence
    // after it, and nothing else here would notice.
    await expect(cues).toHaveCount(0, { timeout: 60_000 });
    // ...and the pipeline survived the exit. Clearing on its own would also
    // happen if the provider errored or the player were torn down, which is not
    // what this is meant to prove.
    await expect(cues.first()).toHaveText(/\S/, { timeout: 60_000 });
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
    await page.getByRole('button', { name: 'Play video', exact: true }).click();
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
    await page.getByRole('button', { name: 'Play video', exact: true }).click();
    await expect
      .poll(() => capability(page, 'customControls'), { timeout: 60_000 })
      .toEqual({ status: 'available' });
  }
);

// #62: Reely's Vimeo captions rest entirely on one empirical guarantee —
// `enableTextTrack(language, kind, false)` makes Vimeo fire `cuechange` WITHOUT
// drawing the cues itself. If that ever changed, every Vimeo consumer would see
// two sets of captions and nothing in the suite would notice: the cue text
// still arrives, the state still says 'custom', and only the pixels differ.
// So the assertion has to be on pixels. The renderer is flipped in-page rather
// than by reloading, so both frames come from the same decode of the same
// paused position.
test(
  'showing:false keeps Vimeo from drawing the cues it hands over',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(
      '/iframe.html?id=fixtures-playerfixture--vimeo-interaction-muted&viewMode=story'
    );
    await page.getByRole('button', { name: 'Play video', exact: true }).click();
    await expect(playButton(page)).toHaveAttribute('data-state', 'playing', {
      timeout: 60_000
    });

    await expect
      .poll(() => capability(page, 'selectTextTrack'), { timeout: 30_000 })
      .toEqual({ status: 'available' });
    await page.evaluate(() => window.reelyHandle?.selectTextTrack('vimeo:en'));

    const frame = page.locator('[data-reely-part="media"] iframe');
    const cues = page.locator('[data-reely-part="caption-cue"]');
    // Only the custom renderer puts cues in Reely's overlay; under 'native'
    // the overlay is empty by design, which is the whole point of the
    // comparison, so the wait for it is conditional.
    const settleOnCue = async (overlayDrawsCues: boolean) => {
      await page.evaluate(() => window.reelyHandle?.seekTo(10));
      if (overlayDrawsCues) {
        await expect(cues.first()).toHaveText(/\S/, { timeout: 30_000 });
      }
      await page.evaluate(() => window.reelyHandle?.pause());
      // A paused frame takes a beat to be the frame on screen, and Vimeo's own
      // renderer takes another to paint over it.
      await page.waitForTimeout(2_000);
    };

    await settleOnCue(true);

    // Reely's own overlay sits ON TOP of the iframe, so an element screenshot
    // captures it too — and then the two frames differ because of OUR cues, not
    // Vimeo's. Measured: without this, the comparison passes even when custom
    // mode is forced to enable with showing: true, which is precisely the
    // regression the test exists to catch. Hidden via a stylesheet rather than
    // an inline style, which React would overwrite on the next cue render.
    await page.addStyleTag({
      content: '[data-reely-part="captions"] { display: none !important; }'
    });
    await page.waitForTimeout(500);
    const custom = await frame.screenshot();
    // Control pair: prove the paused frame is stable, otherwise a decode
    // difference downstream would read as a caption difference.
    await page.waitForTimeout(1_000);
    expect(await frame.screenshot()).toEqual(custom);

    // Flip the renderer WITHOUT seeking or resuming: the video stays paused on
    // the very same frame, so the only thing that can change in the iframe is
    // whether Vimeo draws the cue. Re-seeking instead made the comparison
    // vacuous — measured, the frames differed on jitter alone and the test
    // passed even with custom mode forced to showing: true.
    await page.evaluate(() => window.reelyHandle?.setCaptionRenderer('native'));
    await expect
      .poll(
        () =>
          page.evaluate(() => window.reelyHandle?.getState().captionRendering),
        { timeout: 30_000 }
      )
      .toBe('provider');
    await page.waitForTimeout(2_000);

    expect(await frame.screenshot()).not.toEqual(custom);
  }
);
