import { expect, test } from 'vitest';
import Hls from 'hls.js';
import HlsLight from 'hls.js/light';
import {
  hlsBuildLoaders,
  hlsBuildSupportsSubtitles
} from '../src/adapter-values';

// `createHlsProvider`'s `build` option (#579) is a primitive stand-in for
// `loadHls`, so `@playdeck/react`'s `PlayerProviderOptions.hls` can carry it
// through `Player.Root` without ever passing a function across that boundary
// -- `providerBagEqual` (`packages/react/src/use-activation.ts`) compares
// every bag value with `Object.is`, which a function can never do meaningfully
// twice. `hlsBuildLoaders` is the map `build` resolves through, checked here
// against the real installed builds the same way `build-features.test.ts`
// checks `hlsBuildSupportsSubtitles`.
test('the build loaders resolve the matching installed hls.js build', async () => {
  const full = await hlsBuildLoaders.full();
  const light = await hlsBuildLoaders.light();

  expect(full.default).toBe(Hls);
  expect(light.default).toBe(HlsLight);
  expect(hlsBuildSupportsSubtitles(full.default)).toBe(true);
  expect(hlsBuildSupportsSubtitles(light.default)).toBe(false);
});
