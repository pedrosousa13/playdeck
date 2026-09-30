// The same composition as playdeck.tsx, plus a control bar built from the
// Playdeck parts that correspond to Media Chrome's seven
// (media-chrome.tsx): a play button, a mute button, a volume slider, a seek
// slider, and a fullscreen button -- five of the seven, because Playdeck
// ships no seek-backward or seek-forward button part. `SeekBackwardIcon` and
// `SeekForwardIcon` exist (packages/react/src/icons.tsx, re-exported from
// packages/react/src/index.tsx) with no `SeekBackwardButton` or
// `SeekForwardButton` beside them to hold one, confirmed by reading
// packages/react/src/index.tsx and transport-controls.tsx rather than
// assumed -- `docs/comparison/method.md` records this as a place Media
// Chrome ships a part Playdeck does not. `Time` is included too, because the
// reference composition never pairs a seek slider without one, though it
// answers nothing on Media Chrome's own bar (built with `MediaTimeRange`
// alone, no `MediaTimeDisplay`) and is not part of the five-of-seven count.
//
// Every part and every prop shape below is copied from
// apps/storybook/stories/reference/reference-player.tsx's own control bar --
// the icon-swap pattern read from `usePlayerState`, `Time`'s `type` prop, the
// `Controls` wrapper -- rather than invented for this fixture. Layout-only
// props (`className`, the wrapping `<div>`s) are the reference's own; the
// `aria-label` and `global` props that composition also passes to `Controls`
// are dropped, since neither changes what a bundler resolves.
import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

const ControlBar = () => {
  const state = Player.usePlayerState((snapshot) => ({
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    fullscreen: snapshot.fullscreen
  }));

  return (
    <Player.Controls>
      <Player.Time type="current" />
      <Player.SeekSlider />
      <Player.Time type="duration" />
      <Player.PlayButton>
        {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
      </Player.PlayButton>
      <Player.MuteButton>
        {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
      </Player.MuteButton>
      <Player.VolumeSlider />
      <Player.FullscreenButton>
        {state.fullscreen ? (
          <Player.FullscreenExitIcon />
        ) : (
          <Player.FullscreenEnterIcon />
        )}
      </Player.FullscreenButton>
    </Player.Controls>
  );
};

const Fixture = () => (
  <Player.Root loading="interaction" source="https://example.com/video.mp4">
    <Player.Viewport style={{ aspectRatio: '16 / 9', width: '320px' }}>
      <Player.Media />
      <Player.ActivationButton>
        <Player.PlayIcon />
      </Player.ActivationButton>
      <ControlBar />
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
