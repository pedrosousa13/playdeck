import { expect, test, type Frame, type Page } from '@playwright/test';
import { playButton } from './locators';
import { readFile } from 'node:fs/promises';

declare global {
  interface Window {
    // Recorded by `fixtures/vimeo-embed.html`: every message the parent posted
    // to the stub embed, in arrival order.
    playdeckEmbedMessages?: unknown[];
    // The Vimeo SDK's own guard for its SEO-metadata handshake. Declared here
    // because these specs pre-set it on the page the way a consumer's own code
    // or a second copy of the SDK would.
    VimeoSeoMetadataAppended?: boolean;
  }
}

const embedHtml = readFile(
  new URL('./fixtures/vimeo-embed.html', import.meta.url),
  'utf8'
);

// Only the embed document — none of these stories opt into the chromeless
// probe, so no oEmbed request is made and nothing else needs a route.
const routeVimeoEmbed = async (page: Page): Promise<void> => {
  const body = await embedHtml;
  await page.route('https://player.vimeo.com/video/**', async (route) => {
    await route.fulfill({ body, contentType: 'text/html', status: 200 });
  });
};

// A path segment and a query the SDK could only know by reading
// `window.location.href` off the embedding page.
const story = (id: string): string =>
  `/iframe.html?id=fixtures-playerfixture--${id}&viewMode=story&playdeckProbe=leak-me`;

const embedFrame = (page: Page): Frame | undefined =>
  page
    .frames()
    .find((frame) => frame.url().startsWith('https://player.vimeo.com/video/'));

type EmbedMessage = { readonly method?: string; readonly value?: unknown };

const embedMessages = async (page: Page): Promise<EmbedMessage[]> => {
  const frame = embedFrame(page);
  if (!frame) return [];
  return frame.evaluate(
    () => (window.playdeckEmbedMessages ?? []) as EmbedMessage[]
  );
};

const appendedMetadata = async (page: Page): Promise<unknown> =>
  (await embedMessages(page)).find(
    (message) => message.method === 'appendVideoMetadata'
  )?.value;

// The non-fatal `configuration` Notice the player is standing on, if any. The
// real SDK is what decides these cases: it writes its own guard `true` while
// installing the listener, so nothing read off `window` after the load can tell
// a suppressed page from a sending one, and only a real evaluation proves the
// adapter is not answering from that write (#333).
const configurationNotice = async (page: Page): Promise<string | undefined> =>
  page.evaluate(() => {
    const error = window.playdeckHandle?.getState().error;
    return error?.category === 'configuration' ? error.message : undefined;
  });

// The embed has answered the SDK's readiness handshake and the adapter has
// published `ready` — the same point the SDK's own metadata listener fires
// from, so a metadata message that is going to arrive has arrived by now.
const settleAfterReady = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().activation)
    )
    .toBe('ready');
  await expect
    .poll(async () =>
      (await embedMessages(page)).some(
        (message) => message.method === 'getDuration'
      )
    )
    .toBe(true);
};

test('the Vimeo SDK sends the embedding page url to the embed by default', async ({
  page
}) => {
  await routeVimeoEmbed(page);
  await page.goto(story('vimeo-viewport'));
  await settleAfterReady(page);

  const href = await page.evaluate(() => window.location.href);
  expect(href).toContain('/iframe.html');
  expect(href).toContain('playdeckProbe=leak-me');
  await expect.poll(() => appendedMetadata(page)).toBe(href);
});

test('suppressSeoMetadata stops the SDK sending the page url', async ({
  page
}) => {
  await routeVimeoEmbed(page);
  await page.goto(story('vimeo-suppress-seo-metadata'));
  await settleAfterReady(page);

  expect(await appendedMetadata(page)).toBeUndefined();
  // The request took, so there is nothing to report.
  expect(await configurationNotice(page)).toBeUndefined();
});

test('suppressSeoMetadata leaves the rest of the Vimeo path alone', async ({
  page
}) => {
  await routeVimeoEmbed(page);
  await page.goto(story('vimeo-suppress-seo-metadata'));

  const iframe = page.locator('[data-playdeck-part="media"] iframe');
  await expect(iframe).toHaveAttribute(
    'src',
    /^https:\/\/player\.vimeo\.com\/video\/76979871\?/
  );
  await settleAfterReady(page);

  await page.evaluate(() => window.playdeckHandle?.play());
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');
});

// The guard belongs to the page, not to Playdeck. `false` is a value the page
// really set, not an absent one: the SDK reads the guard with a truthiness
// check (`player.js:996`), so a pre-set `false` means the handshake installs —
// and Playdeck turning that into `true` would be exactly the clobber the option
// is forbidden to make.
for (const suppress of [true, false] as const) {
  const storyId = suppress ? 'vimeo-suppress-seo-metadata' : 'vimeo-viewport';
  const label = suppress ? 'on' : 'off';

  test(`a page that already set the guard true keeps it, with the option ${label}`, async ({
    page
  }) => {
    await routeVimeoEmbed(page);
    await page.addInitScript(() => {
      window.VimeoSeoMetadataAppended = true;
    });
    await page.goto(story(storyId));
    await settleAfterReady(page);

    expect(await page.evaluate(() => window.VimeoSeoMetadataAppended)).toBe(
      true
    );
    expect(await appendedMetadata(page)).toBeUndefined();
    // Suppression is in effect, so a request for it was honoured — by the page
    // rather than by Playdeck, which is not a distinction a consumer needs to
    // hear about. Reporting here would be a false alarm on a page that is doing
    // exactly what was asked (#333).
    expect(await configurationNotice(page)).toBeUndefined();
  });

  test(`a page that already set the guard false keeps it, with the option ${label}`, async ({
    page
  }) => {
    await routeVimeoEmbed(page);
    await page.addInitScript(() => {
      window.VimeoSeoMetadataAppended = false;
    });
    await page.goto(story(storyId));
    await settleAfterReady(page);

    // Playdeck left the `false` alone, so the SDK installed its listener and sent
    // the url — the observable proof that nothing overwrote the page's value.
    const href = await page.evaluate(() => window.location.href);
    await expect.poll(() => appendedMetadata(page)).toBe(href);

    // And with the option on, that is a privacy request that did not take,
    // which has to be reported. This is the case the real SDK is needed for:
    // by the time the adapter looks, the SDK has overwritten the page's `false`
    // with `true` on its way to installing the listener above, so an adapter
    // reading the guard rather than what it held at evaluation sees
    // "suppressed" and says nothing (#333).
    if (suppress) {
      await expect
        .poll(() => configurationNotice(page))
        .toContain('did not take effect');
    } else {
      expect(await configurationNotice(page)).toBeUndefined();
    }
  });
}
