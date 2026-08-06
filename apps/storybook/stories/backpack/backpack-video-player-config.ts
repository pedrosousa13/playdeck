import type { WistiaProviderOptions } from '@reely/react';

/**
 * The four `playerConfig.wistia` keys `BackpackVideo` accepts, in Backpack's
 * own names. Backpack types this entry as react-player's `Config['wistia']`
 * (`Record<string, unknown>`); this wrapper keeps a typed surface instead,
 * narrowed to the keys its stories actually pass
 * (`VideoPlayer.tsx:45-55` for the shape, `AutoplayVideo.stories.tsx:67-85` and
 * `Video.stories.tsx:162-176` for the scenarios).
 *
 * `autoPlay`, `silentAutoPlay` and `preload` are refused by this type on
 * purpose: Reely owns activation through `Player.Root`'s own `autoplay` and
 * `preload` props, so `playerConfig.wistia` must not carry a second, competing
 * answer to the same question.
 */
export type BackpackWistiaPlayerConfig = {
  readonly playerColor?: string;
  readonly swatch?: boolean;
  readonly stillUrl?: string;
  readonly wmode?: 'transparent';
};

/**
 * Backpack's own `playerConfig` shape (`VideoPlayer.tsx:45-55`), narrowed to
 * the one provider this wrapper wires: a per-provider record with a typed
 * `wistia` entry. A future provider gets its own optional entry here when it
 * earns one; none does yet.
 */
export type BackpackVideoPlayerConfig = {
  readonly wistia?: BackpackWistiaPlayerConfig;
};

/**
 * The wrapper's own Wistia defaults: empty. `swatch: true` looked like a safe
 * default — `@wistia/wistia-player` shows a swatch unless told otherwise — but
 * "unless told otherwise" is exactly what an absent attribute already means to
 * the element: its `_getValueFromAttribute` returns `null` for a missing
 * attribute specifically so a project- or media-level swatch setting is not
 * overridden, and `defaultEmbedOptions` carries no `swatch` entry for
 * `_getSyncedEmbedOption` to fall back to either (verified against
 * `@wistia/wistia-player@0.7.12`'s `dist/wistia-player.js`). Defaulting to
 * `swatch: true` here would therefore emit a `swatch="true"` attribute that
 * can override a media-level setting the pre-`playerConfig` wrapper never
 * touched — `packages/provider-wistia/src/attachment.ts:212-220` already
 * relies on an omitted option setting no attribute for this reason. So no
 * default here either: only a caller who sets `swatch` explicitly produces an
 * attribute.
 */
const wistiaPlayerConfigDefaults: BackpackWistiaPlayerConfig = {};

/**
 * Backpack's own merge (`VideoPlayer.tsx:45-55`, `mergePlayerConfig`): a
 * shallow spread of the caller's `wistia` entry over the wrapper's own
 * defaults, so the caller wins on any key it sets and a key it omits keeps the
 * default.
 */
export const mergeWistiaPlayerConfig = (
  wistia: BackpackWistiaPlayerConfig | undefined
): BackpackWistiaPlayerConfig => ({
  ...wistiaPlayerConfigDefaults,
  ...wistia
});

/**
 * Translates a merged `playerConfig.wistia` bag — Backpack's own option names —
 * to Reely's `WistiaProviderOptions`. This table is the contract:
 *
 * | `playerConfig.wistia` key | Reely provider option         | Element attribute      |
 * | -------------------------- | ------------------------------ | ----------------------- |
 * | `playerColor: string`      | `playerColor`                   | `player-color`           |
 * | `swatch: boolean`          | `swatch`                         | `swatch`                  |
 * | `stillUrl: string`         | `poster`                         | `poster`                  |
 * | `wmode: 'transparent'`     | `transparentLetterbox: true`     | `transparent-letterbox`  |
 */
export const translateWistiaPlayerConfig = (
  wistia: BackpackWistiaPlayerConfig
): WistiaProviderOptions => ({
  playerColor: wistia.playerColor,
  poster: wistia.stillUrl,
  swatch: wistia.swatch,
  transparentLetterbox: wistia.wmode === 'transparent' ? true : undefined
});
