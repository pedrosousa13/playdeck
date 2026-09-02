import { useEffect, useRef, useState } from 'react';
import type { Availability } from '@playdeck/core';
import { createHlsProvider } from '@playdeck/provider-hls';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { assetUrl } from './asset-url';

type HlsBuild = 'full' | 'light';

// `hls.js/light` compiles out the subtitle controllers, and #510 needs that
// difference driven in a browser rather than inferred: on a manifest that does
// declare subtitle renditions, the light build makes `selectTextTrack` settle
// to `unavailable` / `provider-build`, and the full build makes it `available`.
//
// hls.js's export map carries no `types` condition for `./light`, so this
// resolves to `any` — the same gap `packages/provider-hls/test/hls-light.d.ts`
// documents. It costs nothing here because `loadHls` is typed
// `HlsModuleLoader`, so the `any` lands on a typed parameter.
const loaders = {
  full: () => import('hls.js'),
  light: () => import('hls.js/light')
} satisfies Record<HlsBuild, () => Promise<unknown>>;

// Mounts the HLS adapter itself rather than `Player.Root`, and that is a
// limitation of the library rather than a preference. `loadHls` is a documented
// option on `createHlsProvider`, but `@playdeck/react` declares no `hls` bag on
// `PlayerProviderOptions` (`packages/react/src/provider-loaders.ts`) and
// `loadProvider` hands the HLS provider only the native options — so no prop, no
// story arg and no `providerOptions` key can route a build through `Player.Root`
// today. Wiring one is a public API change with a real question in it (a
// `loadHls` written inline is a new function each render, and `providerBagEqual`
// compares bag values with `Object.is`, so it would tear the engine down on
// every render), which is why it is not made here on the way past.
//
// What the capability is derived from is entirely below React anyway:
// `hlsBuildSupportsSubtitles` reads the constructor this loader returns, and
// `text-tracks.ts` settles the answer from `MANIFEST_PARSED`. Mounting the
// adapter drives exactly that path, on a real build, in a real browser.
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
    void (async () => {
      await adapter.attach();
      await adapter.load();
    })();
    return () => {
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
          '**Exempt from the per-story docs convention**, on the same terms as `Fixtures/PlayerFixture`: both stories exist to be driven by `e2e/hls-subtitle-capability.spec.ts`, and that spec states what each one is for.',
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

export const Full: Story = {
  args: { build: 'full' }
};

export const Light: Story = {
  args: { build: 'light' }
};
