import type { Page } from '@playwright/test';

// Reely controls are located by the part contract consumers are told to style
// and query against, never by accessible name: Playwright matches names as
// substrings, so `{ name: 'Play' }` also resolves "AirPlay" and "Play video"
// (#73). An eslint rule guards the same thing at the call sites.
export const playButton = (page: Page) =>
  page.locator('[data-reely-part="play-button"]');

export const activationButton = (page: Page) =>
  page.locator('[data-reely-part="activation"]');

export const media = (page: Page) => page.locator('[data-reely-part="media"]');

export const seekSliderInput = (page: Page) =>
  page.locator('[data-reely-part="seek-slider-input"]');

export const muteButton = (page: Page) =>
  page.locator('[data-reely-part="mute-button"]');

export const captionsButton = (page: Page) =>
  page.locator('[data-reely-part="captions-button"]');

// `CaptionsMenu` is a preset assembly over `SettingsMenu`, so TWO elements
// carry `data-reely-part="settings-menu-trigger"` in this composition. The
// part alone is a strict-mode ambiguity; the aria-label disambiguates without
// falling back to Playwright's substring name matching.
export const settingsTrigger = (page: Page) =>
  page.locator(
    '[data-reely-part="settings-menu-trigger"][aria-label="Settings"]'
  );

export const settingsMenu = (page: Page) =>
  page.locator('[data-reely-part="settings-menu"]');

export const controls = (page: Page) =>
  page.locator('[data-reely-part="controls"]');

export const pipButton = (page: Page) =>
  page.locator('[data-reely-part="pip-button"]');

export const airPlayButton = (page: Page) =>
  page.locator('[data-reely-part="airplay-button"]');
