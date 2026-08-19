import type { Page } from '@playwright/test';

// Playdeck controls are located by the part contract consumers are told to style
// and query against, never by accessible name: Playwright matches names as
// substrings, so `{ name: 'Play' }` also resolves "AirPlay" and "Play video"
// (#73). An eslint rule guards the same thing at the call sites.
export const playButton = (page: Page) =>
  page.locator('[data-playdeck-part="play-button"]');

export const activationButton = (page: Page) =>
  page.locator('[data-playdeck-part="activation"]');

export const media = (page: Page) =>
  page.locator('[data-playdeck-part="media"]');

export const seekSliderInput = (page: Page) =>
  page.locator('[data-playdeck-part="seek-slider-input"]');

// `VolumeSlider` puts the part on the range control itself, so there is no
// `volume-slider-input` to pair with `seek-slider-input`: the seek control is a
// wrapper element around its input, and this one is the input.
export const volumeSlider = (page: Page) =>
  page.locator('[data-playdeck-part="volume-slider"]');

export const muteButton = (page: Page) =>
  page.locator('[data-playdeck-part="mute-button"]');

export const captionsButton = (page: Page) =>
  page.locator('[data-playdeck-part="captions-button"]');

// `CaptionsMenu` is a preset assembly over `SettingsMenu`, so TWO elements
// carry `data-playdeck-part="settings-menu-trigger"` in this composition. The
// part alone is a strict-mode ambiguity; the aria-label disambiguates without
// falling back to Playwright's substring name matching.
export const settingsTrigger = (page: Page) =>
  page.locator(
    '[data-playdeck-part="settings-menu-trigger"][aria-label="Settings"]'
  );

export const captionsTrigger = (page: Page) =>
  page.locator(
    '[data-playdeck-part="settings-menu-trigger"][aria-label="Captions"]'
  );

export const settingsMenu = (page: Page) =>
  page.locator('[data-playdeck-part="settings-menu"]');

export const controls = (page: Page) =>
  page.locator('[data-playdeck-part="controls"]');

export const pipButton = (page: Page) =>
  page.locator('[data-playdeck-part="pip-button"]');

export const airPlayButton = (page: Page) =>
  page.locator('[data-playdeck-part="airplay-button"]');
