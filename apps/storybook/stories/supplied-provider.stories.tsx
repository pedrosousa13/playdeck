import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { acmeProvider } from './supplied-provider-fixture';

declare global {
  interface Window {
    playdeckHandle?: Player.PlayerHandle;
  }
}

// Drives a full playback flow through a source kind this package ships no
// loader for -- `Player.Root`'s `providers` prop, resolved by
// `./supplied-provider-fixture`'s test-local "acme" registration. `loading:
// 'eager'` and no `Player.ActivationButton`, deliberately: `e2e/native-mp4.spec.ts`
// already covers the pre-ready refusal window that overlay exists for, and
// this fixture's own job is the seam a supplied kind reaches once attached --
// play, pause, ended -- not activation timing a second time.
const SuppliedProviderFixture = () => (
  <Player.Root
    loading="eager"
    providers={{ acme: acmeProvider }}
    ref={(handle) => {
      window.playdeckHandle = handle ?? undefined;
    }}
    source="https://acme.example/videos/tracer"
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

export const AcmeClip: Story = {};
