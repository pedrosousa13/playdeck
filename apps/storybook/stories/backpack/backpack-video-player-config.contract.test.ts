import type * as Player from '@reely/react';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackpackVideo } from './backpack-video';
import {
  mergeWistiaPlayerConfig,
  translateWistiaPlayerConfig
} from './backpack-video-player-config';

/**
 * SIDEPRO-205's `playerConfig.wistia` translation table, pinned two ways: the
 * caller-then-default merge Backpack's own `mergePlayerConfig` performs
 * (`VideoPlayer.tsx:45-55`), and the four-key translation from Backpack's
 * option names to Reely's `WistiaProviderOptions`.
 */

const { capturedProviderOptions } = vi.hoisted(() => ({
  // Every `providerOptions` `Player.Root` was rendered with, in order --
  // `unknown[]` rather than `Player.PlayerProviderOptions[]` because the mock
  // factory below runs before this file's own type-only import of `Player` is
  // erased, and widening here keeps the two independent.
  capturedProviderOptions: [] as unknown[]
}));

// Backpack's `mergeWistiaPlayerConfig`/`translateWistiaPlayerConfig` above are
// pure functions, pinned directly by the two `describe` blocks above -- but
// nothing there proves `BackpackVideoInternal` actually calls them and hands
// the result to `Player.Root`. This intercepts `@reely/react`'s own `Root`,
// Backpack's real `Player.Root` call site, recording the `providerOptions`
// prop it receives and then rendering the genuine component underneath, so
// `BackpackVideoSurface`'s hooks still run against a real
// `PlayerContext.Provider`. This is the boundary because reaching one layer
// further -- a real `<wistia-player>` element's `swatch`/`player-color`
// attributes -- needs either a genuinely dormant activation reaching Reely's
// own, unmocked `loadProvider` (which would touch the network for a real
// `http(s)` Wistia source, forbidden in this suite) or reaching into
// `@reely/react`'s private `provider-loaders.ts` from outside the package it
// belongs to, which this repository does not do elsewhere
// (`external-control.contract.test.ts:28-38` turns down the same reach for
// the same reason). `packages/provider-wistia/test/index.test.ts` already
// pins the attribute mapping past this point, and `packages/react/test/activation.test.tsx`
// already pins `providerOptions` reaching `loadProvider` past this point too.
vi.mock('@reely/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reely/react')>();
  return {
    ...actual,
    Root: (props: Player.RootProps) => {
      capturedProviderOptions.push(props.providerOptions);
      return createElement(actual.Root, props);
    }
  };
});

describe('mergeWistiaPlayerConfig', () => {
  it('keeps the wrapper’s own swatch default when the caller omits playerConfig entirely', () => {
    expect(mergeWistiaPlayerConfig(undefined)).toEqual({ swatch: true });
  });

  it('keeps the swatch default when the caller’s wistia entry omits it', () => {
    expect(mergeWistiaPlayerConfig({ playerColor: 'ff0000' })).toEqual({
      playerColor: 'ff0000',
      swatch: true
    });
  });

  it('lets the caller win on swatch', () => {
    expect(mergeWistiaPlayerConfig({ swatch: false })).toEqual({
      swatch: false
    });
  });
});

describe('translateWistiaPlayerConfig', () => {
  it('translates playerColor straight across', () => {
    expect(
      translateWistiaPlayerConfig({ playerColor: 'ff0000', swatch: true })
    ).toMatchObject({ playerColor: 'ff0000' });
  });

  it('translates swatch straight across', () => {
    expect(translateWistiaPlayerConfig({ swatch: false })).toMatchObject({
      swatch: false
    });
  });

  it('translates stillUrl to poster', () => {
    expect(
      translateWistiaPlayerConfig({
        stillUrl: 'https://reely.dev/still.png',
        swatch: true
      })
    ).toMatchObject({ poster: 'https://reely.dev/still.png' });
  });

  it('translates wmode: transparent to transparentLetterbox: true', () => {
    expect(
      translateWistiaPlayerConfig({ swatch: true, wmode: 'transparent' })
    ).toMatchObject({ transparentLetterbox: true });
  });

  it('sets no attribute-backed option for a key the merged bag omits', () => {
    expect(translateWistiaPlayerConfig({ swatch: true })).toEqual({
      playerColor: undefined,
      poster: undefined,
      swatch: true,
      transparentLetterbox: undefined
    });
  });
});

// Closes the gap the two `describe` blocks above leave open on their own:
// each pins one of `mergeWistiaPlayerConfig`/`translateWistiaPlayerConfig` as
// a pure function, but neither renders `BackpackVideo` at all, so neither
// would notice `BackpackVideoInternal` failing to call them, or failing to
// hand the result to `Player.Root`'s `providerOptions` prop. These do.
describe('BackpackVideo playerConfig wiring', () => {
  afterEach(() => {
    cleanup();
    capturedProviderOptions.length = 0;
  });

  it('hands Player.Root the caller’s playerConfig, merged and translated', () => {
    render(
      createElement(BackpackVideo, {
        playerConfig: { wistia: { playerColor: 'ff0000', swatch: false } },
        url: 'https://reely.wistia.com/medias/oifkgmxnkb'
      })
    );

    expect(capturedProviderOptions.at(-1)).toEqual({
      wistia: {
        playerColor: 'ff0000',
        poster: undefined,
        swatch: false,
        transparentLetterbox: undefined
      }
    });
  });

  // The default merge (`swatch: true`) has to reach `Player.Root` too, for a
  // caller who never passes `playerConfig` at all -- the ordinary case for
  // every `BackpackVideo` today.
  it('hands Player.Root the wrapper’s own default when playerConfig is omitted', () => {
    render(
      createElement(BackpackVideo, { url: 'https://reely.dev/tracer.mp4' })
    );

    expect(capturedProviderOptions.at(-1)).toEqual({
      wistia: {
        playerColor: undefined,
        poster: undefined,
        swatch: true,
        transparentLetterbox: undefined
      }
    });
  });
});
