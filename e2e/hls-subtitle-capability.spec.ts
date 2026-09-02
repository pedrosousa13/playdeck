import { expect, test, type Page } from '@playwright/test';

// #510. `selectTextTrack` settles from `MANIFEST_PARSED`
// (`packages/provider-hls/src/text-tracks.ts`), and two of the three answers it
// can give had never been driven in a browser: the probes in #508 measured what
// hls.js reports, and the unit tests measured what the adapter does with those
// payloads, but nothing joined the two ends on a real manifest.
//
// The gap was the fixture tree, not the wiring: `hls/master.m3u8` declares a
// subtitle rendition, so every e2e that loaded it took the `available` branch.
// `hls/nosubs.m3u8` is the same tree with the rendition removed.

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
