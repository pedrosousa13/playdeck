import { expectTypeOf, test } from 'vitest';
import type { NativePlaybackOptions } from '@playdeck/provider-native';
import type { RootProps } from '../src/root';

// `RootProps` lists every prop it accepts in one place so that an unknown prop
// produces an error a consumer can read. The cost is that `loop`, `startTime`
// and `endTime` are now declared there as well as in `NativePlaybackOptions`,
// which `RootProps` used to intersect: `Root` reads its own declaration and
// hands the three values on as a wider type, so the two can disagree with
// nothing failing.
//
// These are type-level claims, so they fail `pnpm typecheck` rather than the
// runtime run -- the same way `provider-loaders.test.ts` states a claim about
// the per-provider option bags.
test('Root accepts exactly the props it accepted as an intersection', () => {
  // The accepted surface itself. Adding a prop to `Root` or removing one is a
  // change to the published API, and this is the line that says so.
  expectTypeOf<keyof RootProps>().toEqualTypeOf<
    | 'autoplay'
    | 'captionRenderer'
    | 'children'
    | 'controls'
    | 'defaultMuted'
    | 'defaultPlaybackRate'
    | 'defaultVolume'
    | 'endTime'
    | 'ignoreReducedMotion'
    | 'loadMargin'
    | 'loadThreshold'
    | 'loading'
    | 'loop'
    | 'mediaMetadata'
    | 'muted'
    | 'onMutedChange'
    | 'onPlaybackRateChange'
    | 'onVolumeChange'
    | 'playbackRate'
    | 'preload'
    | 'providerOptions'
    | 'ref'
    | 'source'
    | 'startTime'
    | 'volume'
  >();

  // Equality rather than assignability, so this catches drift from either
  // side: an intersection absorbs the narrower member, so a `RootProps` that
  // had merely stopped accepting everything `NativePlaybackOptions` declares
  // would still satisfy assignability in both directions. `Pick` also stops
  // compiling outright if one of the three keys leaves `RootProps`.
  expectTypeOf<
    Pick<RootProps, keyof NativePlaybackOptions>
  >().toEqualTypeOf<NativePlaybackOptions>();
});
