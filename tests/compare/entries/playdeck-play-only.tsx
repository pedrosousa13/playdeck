// The number behind the "only what you use loads" claim: core, the native
// provider, and exactly one control part -- `Player.Controls` wrapping a
// single `Player.PlayButton`, nothing else from `playdeck-control-bar.tsx`'s
// five (no `Player.Time`, `Player.SeekSlider`, `Player.MuteButton`,
// `Player.VolumeSlider` or `Player.FullscreenButton`, and none of their
// `usePlayerState` subscription either). `PlayButton` renders with no
// children -- `PlayButtonProps` (`packages/react/src/transport-controls.tsx`)
// makes `children` optional, and this fixture asks a bundler what one control
// part costs, not what a finished-looking button looks like; playdeck.tsx and
// playdeck-control-bar.tsx already own the icon-swap pattern for a played/
// paused button and adding a copy of it here would measure `PlayIcon` and
// `PauseIcon` twice for one control that names neither in the issue's own
// composition.
//
// This row sits between `playdeck.tsx` (no control parts) and
// `playdeck-control-bar.tsx` (five parts): it is the composition that makes
// "only what you use loads" checkable against a number, rather than the
// direct comparison for any other library's own row -- see
// `docs/comparison/method.md`'s "Equivalent composition per library" for how
// this row and `playdeck-no-parts.tsx` fit beside the two existing ones.
import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

const Fixture = () => (
  <Player.Root loading="interaction" source="https://example.com/video.mp4">
    <Player.Viewport style={{ aspectRatio: '16 / 9', width: '320px' }}>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
      </Player.Controls>
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
