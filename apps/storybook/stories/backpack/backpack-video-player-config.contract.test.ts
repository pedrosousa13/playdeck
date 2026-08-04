import { describe, expect, it } from 'vitest';
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
