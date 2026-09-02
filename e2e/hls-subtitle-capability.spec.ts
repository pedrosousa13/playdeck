import { expect, test, type Page } from '@playwright/test';

// `selectTextTrack` settles from `MANIFEST_PARSED`
// (`packages/provider-hls/src/text-tracks.ts`), and these join the two ends
// measured apart elsewhere: what hls.js reports on a real manifest (#508's
// probes) and what the adapter makes of that payload (the unit tests).
//
// `hls/nosubs.m3u8` (#510) is the fixture tree's master playlist with the
// subtitle rendition removed, and the assertion below is what it exists for:
// `hls/master.m3u8` declares one, so it can only ever take the `available`
// branch.

// The capability is settled by the manifest, well before any frame decodes, so
// these read it rather than playing anything.
const selectTextTrack = (page: Page) =>
  expect.poll(() =>
    page.evaluate(
      () => window.playdeckHandle?.getState().capabilities.selectTextTrack
    )
  );

test('reports a subtitle-less manifest as an absence in the source', async ({
  browserName,
  page
}) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--hls-no-subtitles&viewMode=story'
  );

  await expect(page.getByTestId('hls-engine')).toHaveText('hls.js');

  // Not `unknown`/`provider-check`, which is what this reported for a whole
  // session before #507: the manifest's empty rendition list is an answer, and
  // the capability has to stop claiming to still be checking.
  await selectTextTrack(page).toEqual({
    status: 'unavailable',
    reason: 'source'
  });
});

// The awkward branch. `hls.js/light` compiles out the subtitle controllers, so
// it parses a manifest's renditions, reports them once on `MANIFEST_PARSED`,
// and then never emits `SUBTITLE_TRACKS_UPDATED` — tracks that can be counted
// and never selected. The adapter answers `provider-build` rather than
// `provider` (the provider is willing) or `source` (the media has subtitles).
//
// It runs against the SUBTITLED fixture on purpose: `provider-build` is only
// reachable when the manifest declares renditions, so `nosubs.m3u8` would send
// the same build down the `source` branch above and prove nothing about it.
//
// Driven through `HlsBuildFixture`, which mounts the adapter directly, because
// `loadHls` has no route through `@playdeck/react` — see that story's own
// comment.
test('reports subtitles a light hls.js build cannot show as a build absence', async ({
  browserName,
  page
}) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-hlsbuildfixture--light&viewMode=story'
  );

  const capability = page.getByTestId('select-text-track');
  await expect(capability).toHaveAttribute('data-status', 'unavailable');
  await expect(capability).toHaveAttribute('data-reason', 'provider-build');
});

// The control, on the same fixture and the same mount: the full build reaches
// `available`. Without it, the assertion above would still pass if the light
// story had silently stopped loading a manifest at all.
test('reports the same manifest as selectable on the full hls.js build', async ({
  browserName,
  page
}) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  await page.goto(
    '/iframe.html?id=fixtures-hlsbuildfixture--full&viewMode=story'
  );

  const capability = page.getByTestId('select-text-track');
  await expect(capability).toHaveAttribute('data-status', 'available');
});
