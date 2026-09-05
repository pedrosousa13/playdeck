import { useEffect, useRef, useState } from 'react';
import type { Availability } from '@playdeck/core';
import { createHlsProvider, type HlsBuild } from '@playdeck/provider-hls';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { assetUrl } from './asset-url';

// `hls.js/light` compiles out the subtitle controllers, and the two stories
// below drive that difference in a browser rather than leaving it inferred: on
// a manifest that does declare subtitle renditions, the light build makes
// `selectTextTrack` settle to `unavailable` / `provider-build`, and the full
// build makes it `available`.
//
// hls.js's export map carries no `types` condition for `./light`, so the
// specifier is untyped until something declares it. `stories/hls-light.d.ts`
// does, for this project; a consumer without one gets `any` on a parameter
// `loadHls` already types as `HlsModuleLoader`.
const loaders = {
  full: () => import('hls.js'),
  light: () => import('hls.js/light')
} satisfies Record<HlsBuild, () => Promise<unknown>>;

// Mounts the HLS adapter itself rather than `Player.Root`, and that is now a
// choice rather than the only route there was. `PlayerProviderOptions` carries
// an `hls` bag since #579 (`providerOptions={{ hls: { build: 'light' } }}`),
// and `loadProvider` maps its `build` name onto `createHlsProvider`'s own
// `build` option -- reachable through `Player.Root` without a function ever
// crossing that boundary, which is what kept `loadHls` itself off the bag:
// `providerBagEqual` compares bag values with `Object.is`
// (`packages/react/src/use-activation.ts`), and a `loadHls` written inline is
// a new function every render.
//
// What this fixture drives is a level below that plumbing regardless: the two
// hls.js builds' own behaviour on a real manifest in a real browser --
// `hlsBuildSupportsSubtitles` reads the constructor this loader returns, and
// `text-tracks.ts` settles the answer from `MANIFEST_PARSED`. Whether
// `Player.Root`'s `build` option reaches `createHlsProvider` at all is
// `loadProvider`'s own claim to keep
// (`packages/react/test/provider-loaders.test.ts`, "forwards the hls build
// option to the hls adapter"); mounting the adapter directly here keeps this
// comparison about the two builds, not about two ways of reaching them.
const HlsBuildFixture = ({ build }: { readonly build: HlsBuild }) => {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [selectTextTrack, setSelectTextTrack] = useState<Availability | null>(
    null
  );

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const adapter = createHlsProvider(
      media,
      // The subtitled fixture, deliberately: `provider-build` means "the media
      // has subtitles and this build cannot show them", so a manifest without
      // renditions could never produce it.
      { type: 'hls', src: assetUrl('hls/master.m3u8'), engine: 'hls.js' },
      { loadHls: loaders[build] }
    );
    const unsubscribe = adapter.subscribe((patch) => {
      if (patch.capabilities) {
        setSelectTextTrack(patch.capabilities.selectTextTrack);
      }
    });
    // `attach()` before `load()`, the order `PlayerController` uses: the engine
    // is only started by `load()`, and `MANIFEST_PARSED` follows from there.
    // Both are awaited, so cleanup can win the race — `cancelled` is what stops
    // a torn-down adapter loading onto a `<video>` a live one now owns.
    let cancelled = false;
    void (async () => {
      await adapter.attach();
      if (cancelled) return;
      await adapter.load();
    })();
    return () => {
      cancelled = true;
      unsubscribe();
      void adapter.destroy();
    };
  }, [build]);

  return (
    <>
      <video
        muted
        playsInline
        ref={mediaRef}
        style={{ maxWidth: '48rem', width: '100%' }}
      />
      <p
        data-reason={
          selectTextTrack && 'reason' in selectTextTrack
            ? selectTextTrack.reason
            : undefined
        }
        data-status={selectTextTrack?.status}
        data-testid="select-text-track"
      >
        selectTextTrack: {selectTextTrack?.status ?? 'unpublished'}
      </p>
    </>
  );
};

const meta: Meta<typeof HlsBuildFixture> = {
  title: 'Fixtures/HlsBuildFixture',
  tags: ['real-playback', '!test'],
  parameters: {
    docs: {
      description: {
        component: [
          'Loads the local HLS fixture through each hls.js build and publishes what `selectTextTrack` settles to. Real hls.js, real manifest, real network — excluded from the deterministic story test suite (tagged `!test`).',
          '',
          '**Do not rename or remove a story here.** Its ID is derived from its export name and the spec addresses it by URL, so a rename is a CI break with no compile error in front of it.'
        ].join('\n')
      }
    }
  },
  render: (args) => <HlsBuildFixture {...args} />
};

export default meta;

type Story = StoryObj<typeof meta>;

/** The control: the stock build ships the subtitle controllers, so the fixture's
 * declared rendition reaches `selectTextTrack: available`. */
export const Full: Story = {
  args: { build: 'full' }
};

/** The same manifest through `hls.js/light`, whose missing subtitle controllers
 * turn a declared rendition into `unavailable` / `provider-build`. */
export const Light: Story = {
  args: { build: 'light' }
};
