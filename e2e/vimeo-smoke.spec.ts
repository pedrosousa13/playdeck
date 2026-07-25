import { expect, test, type Page } from '@playwright/test';

// Real-provider smoke tests: tagged @real so they never block CI (see
// grepInvert in playwright.config.ts). Run with:
//   REELY_REAL_PROVIDERS=1 pnpm test:e2e -- --grep @real

type CapabilityValue = {
  readonly status: string;
  readonly reason?: string;
};

type SdkPlayerLike = {
  ready: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<unknown>;
  setCurrentTime: (seconds: number) => Promise<unknown>;
  enableTextTrack: (language: string) => Promise<unknown>;
  on: (event: string, listener: (data: unknown) => void) => void;
};

declare global {
  interface Window {
    reelyHandle?: {
      getState: () => {
        activation: string;
        playback: string;
        capabilities: Record<string, CapabilityValue>;
      };
      selectTextTrack: (track: string | null) => Promise<{ ok: boolean }>;
    };
    Vimeo?: {
      Player: new (element: Element) => SdkPlayerLike;
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

    // De-risk #16: prove cue text actually arrives over cuechange on the
    // exact chromeless embed the adapter builds.
    await page.addScriptTag({ url: 'https://player.vimeo.com/api/player.js' });
    const cue = await page.evaluate(async () => {
      const element = document.querySelector(
        '[data-reely-part="media"] iframe'
      );
      if (!element || !window.Vimeo) return undefined;
      const player = new window.Vimeo.Player(element);
      await player.ready();
      const cuePromise = new Promise<unknown>((resolve) => {
        player.on('cuechange', (data) => resolve(data));
      });
      await player.enableTextTrack('en');
      await player.setCurrentTime(10);
      return Promise.race([
        cuePromise,
        new Promise((resolve) => setTimeout(() => resolve(undefined), 30_000))
      ]);
    });
    expect(cue, 'cuechange must deliver cue payloads').toBeDefined();
    const cues = (cue as { cues?: Array<{ text?: string }> }).cues ?? [];
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0]?.text ?? '').not.toBe('');
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
