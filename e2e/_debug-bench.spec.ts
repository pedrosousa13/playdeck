import { expect, test } from '@playwright/test';
import { activationButton, controls } from './locators';

const landing = 'http://127.0.0.1:4322/';

test('debug webkit hls stall', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'webkit-only diagnostic');

  const consoleMessages: string[] = [];
  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleMessages.push(`[pageerror] ${err.message}`);
  });
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/hls|\.m3u8|\.ts(\?|$)|\.m4s(\?|$)|\.mp4(\?|$)/.test(url)) {
      requests.push(`REQ ${request.method()} ${url}`);
    }
  });
  page.on('requestfailed', (request) => {
    requests.push(
      `FAILED ${request.url()} ${request.failure()?.errorText ?? ''}`
    );
  });
  page.on('response', (response) => {
    const url = response.url();
    if (/hls|\.m3u8|\.ts(\?|$)|\.m4s(\?|$)|\.mp4(\?|$)/.test(url)) {
      requests.push(`RES ${response.status()} ${url}`);
    }
  });

  await page.goto(landing);
  await activationButton(page).click();
  await expect(controls(page)).toBeVisible({ timeout: 20_000 });

  const snapshots: unknown[] = [];
  for (let i = 0; i < 20; i += 1) {
    const snap = await page.evaluate(() => {
      const state = window.playdeckHandle?.getState();
      if (!state) return null;
      return {
        activation: state.activation,
        playback: state.playback,
        buffering: state.buffering,
        error: state.error,
        quality: state.quality,
        qualities: state.qualities,
        selectedQualityId: state.selectedQualityId,
        currentTime: state.currentTime,
        readyState: (
          document.querySelector(
            '[data-playdeck-part="media"]'
          ) as HTMLVideoElement | null
        )?.readyState,
        networkState: (
          document.querySelector(
            '[data-playdeck-part="media"]'
          ) as HTMLVideoElement | null
        )?.networkState,
        paused: (
          document.querySelector(
            '[data-playdeck-part="media"]'
          ) as HTMLVideoElement | null
        )?.paused,
        currentSrc: (
          document.querySelector(
            '[data-playdeck-part="media"]'
          ) as HTMLVideoElement | null
        )?.currentSrc
      };
    });
    snapshots.push(snap);
    await page.waitForTimeout(1000);
  }

  console.log('SNAPSHOTS', JSON.stringify(snapshots, null, 2));
  console.log('CONSOLE', JSON.stringify(consoleMessages, null, 2));
  console.log('REQUESTS', JSON.stringify(requests, null, 2));
});
