import { expect, test } from '@playwright/test';

test('custom captions render the discovered track once playing', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-custom&viewMode=story'
  );

  await page.locator('[data-reely-part="play-button"]').click();

  const captionsButton = page.locator('[data-reely-part="captions-button"]');
  await expect(captionsButton).toHaveAttribute('data-state', 'on');

  const captions = page.locator('[data-reely-part="captions"]');
  await expect(captions).toContainText('Reely caption one');
});

test('the captions button toggles the overlay off and back on', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-custom&viewMode=story'
  );

  await page.locator('[data-reely-part="play-button"]').click();

  const captionsButton = page.locator('[data-reely-part="captions-button"]');
  const captions = page.locator('[data-reely-part="captions"]');
  await expect(captions).toContainText('Reely caption one');

  await captionsButton.click();
  await expect(captionsButton).toHaveAttribute('data-state', 'off');
  await expect(captions.locator('[data-reely-part="caption-cue"]')).toHaveCount(
    0
  );

  await captionsButton.click();
  await expect(captionsButton).toHaveAttribute('data-state', 'on');
  await expect(captions).toContainText('Reely caption one');
});

test('native caption rendering leaves the custom overlay empty', async ({
  page
}) => {
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--captions-native&viewMode=story'
  );

  await page.locator('[data-reely-part="play-button"]').click();

  const captionsButton = page.locator('[data-reely-part="captions-button"]');
  await expect(captionsButton).toHaveAttribute('data-state', 'on');

  await expect(page.locator('[data-reely-part="captions"]')).toHaveCount(0);
});
