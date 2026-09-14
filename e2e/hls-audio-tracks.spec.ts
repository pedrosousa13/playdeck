import { expect, test, type Locator, type Page } from '@playwright/test';

// `hls/audio.m3u8` (#656) declares two `EXT-X-MEDIA:TYPE=AUDIO` renditions --
// English (`DEFAULT=YES`) and Spanish -- the only shape in which hls.js has
// more than one audio track to switch between; `hls/master.m3u8` carries
// none. `HlsAudioTracksFixture` (`hls-audio-tracks.stories.tsx`) mounts the
// hls.js adapter directly rather than `Player.Root`, and that is now a
// choice rather than the only route there was: `Player.AudioTrackMenu`
// (`e2e/audio-tracks.spec.ts`) drives `selectAudioTrack` through
// `@playdeck/react`. What this file drives is a level below that plumbing
// regardless: hls.js's own alternate-audio discovery and switching on a real
// manifest, isolated from whatever a menu built on top of it does with the
// result -- the same split `HlsBuildFixture`'s own comment draws for the two
// hls.js builds.
const trackByLanguage = (page: Page, language: string): Locator =>
  page.locator(`[data-testid^="audio-track-"][data-language="${language}"]`);

// Demonstrated red (docs/agents/demonstrated-red.md): the provider fix this
// test exercises (`AUDIO_TRACK_SWITCHING` settling `active`,
// `packages/provider-hls/src/{adapter-values,audio-tracks,attachment}.ts`)
// was reverted to its pre-fix state and this test run against it on
// chromium:
//
//   Error: expect(locator).toHaveAttribute(expected) failed
//   Locator:  locator('[data-testid^="audio-track-"][data-language="en"]')
//   Expected: "true"
//   Received: "false"
//   Timeout:  5000ms
//   Call log:
//     - Expect "toHaveAttribute" with timeout 5000ms
//     - waiting for locator('[data-testid^="audio-track-"][data-language="en"]')
//       14 × locator resolved to <li data-language="en" data-active="false" data-testid="audio-track-hls:0">…</li>
//          - unexpected value "false"
//
//   1 failed
//     [chromium] › e2e/hls-audio-tracks.spec.ts:14:1 › lists both alternate-audio renditions, English active by default
//
// Reverted, and it passed again.
test('lists both alternate-audio renditions, English active by default', async ({
  browserName,
  page
}) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-hlsaudiotracksfixture--default&viewMode=story'
  );

  await expect(page.getByTestId('audio-tracks').locator('li')).toHaveCount(2);
  await expect(trackByLanguage(page, 'en')).toHaveAttribute(
    'data-active',
    'true'
  );
  await expect(trackByLanguage(page, 'es')).toHaveAttribute(
    'data-active',
    'false'
  );
});

// The acceptance criterion itself (#656): a real hls.js engine, on a real
// multi-audio manifest, actually switches tracks.
//
// Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
// the command is additive, so there is no unfixed state to revert it to --
// `HlsAudioTracks.selectAudioTrack` (`packages/provider-hls/src/audio-tracks.ts`)
// was changed to return `{ ok: false, reason: 'unsupported' }` unconditionally
// before touching the engine, and this test run against it on chromium:
//
//   Error: expect(locator).toHaveAttribute(expected) failed
//   Locator:  getByTestId('select-audio-track-result')
//   Expected: "true"
//   Received: "false"
//   Timeout:  5000ms
//   Call log:
//     - Expect "toHaveAttribute" with timeout 5000ms
//     - waiting for getByTestId('select-audio-track-result')
//       14 × locator resolved to <p data-ok="false" data-testid="select-audio-track-result">selectAudioTrack: unsupported</p>
//          - unexpected value "false"
//
//   1 failed
//     [chromium] › e2e/hls-audio-tracks.spec.ts:58:1 › selects a track on hls.js
//
// Reverted, and it passed again.
test('selects a track on hls.js', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-hlsaudiotracksfixture--default&viewMode=story'
  );

  await expect(trackByLanguage(page, 'es')).toHaveAttribute(
    'data-active',
    'false'
  );

  await trackByLanguage(page, 'es').getByRole('button').click();

  await expect(page.getByTestId('select-audio-track-result')).toHaveAttribute(
    'data-ok',
    'true'
  );
  await expect(trackByLanguage(page, 'es')).toHaveAttribute(
    'data-active',
    'true'
  );
  await expect(trackByLanguage(page, 'en')).toHaveAttribute(
    'data-active',
    'false'
  );
});
