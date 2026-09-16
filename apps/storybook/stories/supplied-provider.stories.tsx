import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { exampleFileProvider } from '../../../examples/provider-setup-file-adapter';
import { assetUrl } from './asset-url';

declare global {
  interface Window {
    playdeckHandle?: Player.PlayerHandle;
  }
}

// Drives a full playback flow through a source kind this package ships no
// loader for -- `Player.Root`'s `providers` prop, resolved by
// `examples/provider-setup-file-adapter.tsx`'s real, working "example-file"
// registration. `loading: 'eager'` and no `Player.ActivationButton`,
// deliberately: `e2e/native-mp4.spec.ts` already covers the pre-ready
// refusal window that overlay exists for, and this fixture's own job is the
// seam a supplied kind reaches once attached -- play, pause, ended -- not
// activation timing a second time.
//
// This is the workbench half of `examples/provider-setup-file-adapter.tsx`,
// the same split `archetype-streaming.stories.tsx` uses for
// `examples/archetype-streaming-service.tsx`: the story imports the real
// adapter rather than rebuilding a second copy of it, and points it at the
// workbench's own local clip through `providerOptions` -- the one setting
// `examples/`'s own doc snippet cannot know, because it has no base path to
// resolve `assetUrl` against.
const SuppliedProviderFixture = () => (
  <Player.Root
    loading="eager"
    providerOptions={{ 'example-file': { src: assetUrl('tracer.mp4') } }}
    providers={{ 'example-file': exampleFileProvider }}
    ref={(handle) => {
      window.playdeckHandle = handle ?? undefined;
    }}
    source="https://files.example/clips/tracer"
  >
    <Player.Viewport
      data-testid="viewport"
      style={{ aspectRatio: '16 / 9', maxWidth: '48rem', width: '100%' }}
    >
      <Player.LoadingIndicator />
      <Player.Media />
    </Player.Viewport>
    <Player.PlayButton />
  </Player.Root>
);

const meta: Meta<typeof SuppliedProviderFixture> = {
  title: 'Fixtures/SuppliedProviderFixture',
  tags: ['real-playback', '!test'],
  parameters: {
    docs: {
      description: {
        component:
          'A source kind supplied through `providers` rather than one of the five this package ships a loader for -- `e2e/supplied-provider.spec.ts`’s own target. Local media, no network; excluded from the deterministic story test suite (tagged `!test`) the same way every other Playwright-only fixture here is.'
      }
    }
  },
  render: () => <SuppliedProviderFixture />
};

export default meta;

type Story = StoryObj<typeof meta>;

export const ExampleFileClip: Story = {};
