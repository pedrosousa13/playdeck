import { expect, test } from '@playwright/test';
import { activationButton, controls } from './locators';

const landing = 'http://127.0.0.1:4322/';

// Hypothesis (#632): Playwright's Linux WebKit has no H.264 decoder, so hls.js
// downloads and appends segments via MediaSource but the <video> element never
// reaches readyState > 1, so hls.js never fires LEVEL_SWITCHED and the bench's
// "Playing" stat stays "-". This spec captures evidence for that hypothesis
// and asserts nothing beyond the activation flow already required to reach a
// player, so the log is emitted without retries. WebKit-only: local WebKit
// cannot launch here, so this only ever runs on CI.
type MediaEvent = string;

test('debug webkit hls stall', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'webkit-only diagnostic');
  test.setTimeout(60_000);

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

  // Step 1: before navigating, patch MediaSource/SourceBuffer so every
  // buffer append and codec probe lands in window.__mseLog.
  await page.addInitScript(() => {
    const w = window as unknown as {
      __mseLog: unknown[];
      __mediaLog: unknown[];
    };
    w.__mseLog = [];
    w.__mediaLog = [];

    w.__mseLog.push({
      t: performance.now(),
      kind: 'env',
      hasManagedMediaSource:
        typeof (window as unknown as { ManagedMediaSource?: unknown })
          .ManagedMediaSource !== 'undefined',
      hasMediaSource: typeof MediaSource !== 'undefined'
    });

    if (typeof MediaSource === 'undefined') return;

    const originalIsTypeSupported =
      MediaSource.isTypeSupported.bind(MediaSource);
    MediaSource.isTypeSupported = (type: string) => {
      const supported = originalIsTypeSupported(type);
      w.__mseLog.push({
        t: performance.now(),
        kind: 'isTypeSupported',
        arg: type,
        supported
      });
      return supported;
    };

    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (type: string) {
      w.__mseLog.push({
        t: performance.now(),
        kind: 'addSourceBuffer',
        arg: type
      });
      return originalAddSourceBuffer.call(this, type);
    };

    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data: BufferSource) {
      w.__mseLog.push({
        t: performance.now(),
        kind: 'appendBuffer',
        arg: data.byteLength
      });
      return originalAppendBuffer.call(this, data);
    };
  });

  await page.goto(landing);

  // Step 2: capabilities, logged once, up front.
  const capabilities = await page.evaluate(() => {
    const video = document.createElement('video');
    const canPlayType = (type: string) => video.canPlayType(type);
    const isTypeSupported = (type: string) =>
      typeof MediaSource !== 'undefined'
        ? MediaSource.isTypeSupported(type)
        : null;
    return {
      userAgent: navigator.userAgent,
      canPlayType: {
        'video/mp4': canPlayType('video/mp4'),
        'video/mp4; codecs="avc1.64001f"': canPlayType(
          'video/mp4; codecs="avc1.64001f"'
        ),
        'video/mp4; codecs="avc1.42E01E, mp4a.40.2"': canPlayType(
          'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        ),
        'video/webm; codecs="vp8"': canPlayType('video/webm; codecs="vp8"'),
        'application/vnd.apple.mpegurl': canPlayType(
          'application/vnd.apple.mpegurl'
        )
      },
      isTypeSupported: {
        'video/mp4; codecs="avc1.64001f"': isTypeSupported(
          'video/mp4; codecs="avc1.64001f"'
        ),
        'video/mp4; codecs="avc1.42E01E"': isTypeSupported(
          'video/mp4; codecs="avc1.42E01E"'
        ),
        'video/mp4; codecs="avc1.640028"': isTypeSupported(
          'video/mp4; codecs="avc1.640028"'
        ),
        'audio/mp4; codecs="mp4a.40.2"': isTypeSupported(
          'audio/mp4; codecs="mp4a.40.2"'
        ),
        'video/mp4; codecs="avc1.64001f,mp4a.40.2"': isTypeSupported(
          'video/mp4; codecs="avc1.64001f,mp4a.40.2"'
        ),
        'video/webm; codecs="vp8"': isTypeSupported('video/webm; codecs="vp8"'),
        'video/webm; codecs="vp9,opus"': isTypeSupported(
          'video/webm; codecs="vp9,opus"'
        )
      }
    };
  });

  // Step 3: the manifest, so the CODECS the ladder declares are on record.
  const manifestResponse = await page.request.get(
    'http://127.0.0.1:4322/media/sprite-fright/master.m3u8'
  );
  const manifestText = await manifestResponse.text();

  // Step 4: activate, attach the media element listeners before waiting for
  // controls, then snapshot the live stats readout once a second.
  await activationButton(page).click();
  await page.waitForSelector('[data-playdeck-part="media"]');
  await page.evaluate(() => {
    const video = document.querySelector(
      '[data-playdeck-part="media"]'
    ) as HTMLVideoElement | null;
    if (!video) return;
    const w = window as unknown as { __mediaLog: unknown[] };
    const rangesToArray = (ranges: TimeRanges): [number, number][] => {
      const out: [number, number][] = [];
      for (let i = 0; i < ranges.length; i += 1) {
        out.push([ranges.start(i), ranges.end(i)]);
      }
      return out;
    };
    const log = (eventName: MediaEvent) => {
      w.__mediaLog.push({
        t: performance.now(),
        event: eventName,
        readyState: video.readyState,
        networkState: video.networkState,
        currentTime: video.currentTime,
        paused: video.paused,
        error: video.error && {
          code: video.error.code,
          message: video.error.message
        },
        buffered: rangesToArray(video.buffered)
      });
    };
    const events: MediaEvent[] = [
      'loadstart',
      'loadedmetadata',
      'loadeddata',
      'canplay',
      'canplaythrough',
      'playing',
      'play',
      'pause',
      'waiting',
      'stalled',
      'error',
      'abort',
      'emptied',
      'durationchange',
      'resize',
      'seeking',
      'seeked'
    ];
    for (const eventName of events) {
      video.addEventListener(eventName, () => log(eventName));
    }
    let timeupdateCount = 0;
    video.addEventListener('timeupdate', () => {
      if (timeupdateCount >= 3) return;
      timeupdateCount += 1;
      log('timeupdate');
    });
  });
  await expect(controls(page)).toBeVisible({ timeout: 20_000 });

  const snapshots: unknown[] = [];
  for (let i = 0; i < 25; i += 1) {
    const snap = await page.evaluate(() => {
      const video = document.querySelector(
        '[data-playdeck-part="media"]'
      ) as HTMLVideoElement | null;
      const stats = document.querySelector(
        '[data-bench-stats]'
      ) as HTMLElement | null;
      const rangesToArray = (ranges: TimeRanges): [number, number][] => {
        const out: [number, number][] = [];
        for (let j = 0; j < ranges.length; j += 1) {
          out.push([ranges.start(j), ranges.end(j)]);
        }
        return out;
      };
      return {
        t: performance.now(),
        stats: stats?.innerText ?? null,
        readyState: video?.readyState ?? null,
        networkState: video?.networkState ?? null,
        currentTime: video?.currentTime ?? null,
        paused: video?.paused ?? null,
        ended: video?.ended ?? null,
        error: video?.error
          ? { code: video.error.code, message: video.error.message }
          : null,
        buffered: video ? rangesToArray(video.buffered) : null,
        seekable: video ? rangesToArray(video.seekable) : null,
        videoWidth: video?.videoWidth ?? null,
        videoHeight: video?.videoHeight ?? null,
        currentSrc: video?.currentSrc.slice(0, 80) ?? null,
        visibilityState: document.visibilityState
      };
    });
    snapshots.push(snap);
    await page.waitForTimeout(1000);
  }

  const mediaLog = await page.evaluate(
    () => (window as unknown as { __mediaLog: unknown[] }).__mediaLog
  );
  const mseLog = await page.evaluate(
    () => (window as unknown as { __mseLog: unknown[] }).__mseLog
  );

  console.log('CAPABILITIES', JSON.stringify(capabilities));
  console.log('MANIFEST', manifestText);
  console.log('SNAPSHOTS', JSON.stringify(snapshots));
  console.log('MEDIA_EVENTS', JSON.stringify(mediaLog));
  console.log('MSE_LOG', JSON.stringify(mseLog));
  console.log('CONSOLE', JSON.stringify(consoleMessages));
  console.log('REQUESTS', JSON.stringify(requests));
});
