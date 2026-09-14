import { useEffect, useRef, useState } from 'react';
import type {
  AudioTrack,
  CommandResult,
  ProviderAdapter
} from '@playdeck/core';
import { createHlsProvider } from '@playdeck/provider-hls';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { assetUrl } from './asset-url';

// Mounts the HLS adapter directly, the same choice `HlsBuildFixture`
// (`hls-build.stories.tsx`) makes and for the same reason: `selectAudioTrack`
// has no route through `@playdeck/react` -- no UI part calls it -- so there
// is nothing for `Player.Root` to add here. What this drives is hls.js's own
// alternate-audio surface on a real manifest in a real browser:
// `hls/audio.m3u8` (#656) declares two `EXT-X-MEDIA:TYPE=AUDIO` renditions,
// English and Spanish, and a button per discovered track calls the
// adapter's own `selectAudioTrack` so a switch between them is observable
// end-to-end.
const HlsAudioTracksFixture = () => {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const adapterRef = useRef<ProviderAdapter | null>(null);
  const [audioTracks, setAudioTracks] = useState<readonly AudioTrack[]>([]);
  const [selectResult, setSelectResult] = useState<CommandResult | null>(null);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const adapter = createHlsProvider(media, {
      type: 'hls',
      src: assetUrl('hls/audio.m3u8'),
      engine: 'hls.js'
    });
    adapterRef.current = adapter;
    const unsubscribe = adapter.subscribe((patch) => {
      if (patch.audioTracks) setAudioTracks(patch.audioTracks);
    });
    // `attach()` before `load()`, the order `PlayerController` uses, with the
    // same cancellation guard `HlsBuildFixture` uses to stop a torn-down
    // adapter loading onto a `<video>` a live one now owns.
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
  }, []);

  const selectTrack = async (id: string) => {
    const outcome = await adapterRef.current?.selectAudioTrack?.(id);
    if (outcome) setSelectResult(outcome);
  };

  return (
    <>
      <video
        muted
        playsInline
        ref={mediaRef}
        style={{ maxWidth: '48rem', width: '100%' }}
      />
      <ul data-testid="audio-tracks">
        {audioTracks.map((track) => (
          <li
            data-active={track.active ? 'true' : 'false'}
            data-language={track.language}
            data-testid={`audio-track-${track.id}`}
            key={track.id}
          >
            <button onClick={() => void selectTrack(track.id)} type="button">
              {track.label}
            </button>
          </li>
        ))}
      </ul>
      <p
        data-ok={
          selectResult ? (selectResult.ok ? 'true' : 'false') : undefined
        }
        data-testid="select-audio-track-result"
      >
        selectAudioTrack:{' '}
        {selectResult
          ? selectResult.ok
            ? 'ok'
            : selectResult.reason
          : 'unset'}
      </p>
    </>
  );
};

const meta: Meta<typeof HlsAudioTracksFixture> = {
  title: 'Fixtures/HlsAudioTracksFixture',
  tags: ['real-playback', '!test'],
  parameters: {
    docs: {
      description: {
        component: [
          'Loads `hls/audio.m3u8` (two alternate-audio renditions) through the hls.js adapter and publishes the discovered `audioTracks`, with a button per track that calls `selectAudioTrack`. Real hls.js, real manifest, real network — excluded from the deterministic story test suite (tagged `!test`).',
          '',
          '**Do not rename or remove this story.** Its ID is derived from its export name and `e2e/hls-audio-tracks.spec.ts` addresses it by URL, so a rename is a CI break with no compile error in front of it.'
        ].join('\n')
      }
    }
  },
  render: () => <HlsAudioTracksFixture />
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
