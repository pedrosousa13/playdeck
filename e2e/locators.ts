import type { Page } from '@playwright/test';

// Reely controls are located by the part contract consumers are told to style
// and query against, never by accessible name: Playwright matches names as
// substrings, so `{ name: 'Play' }` also resolves "AirPlay" and "Play video"
// (#73). An eslint rule guards the same thing at the call sites.
export const playButton = (page: Page) =>
  page.locator('[data-reely-part="play-button"]');
