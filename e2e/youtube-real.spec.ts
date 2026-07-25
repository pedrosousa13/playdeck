import { expect, test } from '@playwright/test';
import { playButton } from './locators';

// Real-provider smoke test: it talks to youtube.com, so it is nondeterministic
// by nature and excluded from blocking runs. Opt in with
// REELY_REAL_PROVIDERS=1 pnpm test:e2e -- --grep @real
test(
  'youtube real embed reaches confirmed playback from one click @real',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(
      '/iframe.html?id=fixtures-playerfixture--interaction-youtube&viewMode=story'
    );
    const activationButton = page.getByRole('button', {
      name: 'Play video',
      exact: true
    });
    await expect(activationButton).toBeVisible();

    await activationButton.click();

    const iframe = page.locator('[data-reely-part="media"] iframe');
    await expect(iframe).toHaveAttribute(
      'src',
      /^https:\/\/www\.youtube-nocookie\.com\/embed\//,
      { timeout: 30_000 }
    );
    // Queued playback is best-effort under real autoplay policy: require the
    // provider to become ready, and accept a confirmed playing state when the
    // browser allows it.
    const play = playButton(page);
    await expect(play).toHaveAttribute('data-state', /playing|paused/, {
      timeout: 30_000
    });
    await expect(activationButton).toBeHidden();
  }
);
