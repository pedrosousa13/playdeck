import * as Player from '@reely/react';

// No stylesheet imported: the primitives ship structure, behaviour and
// accessibility semantics, and every visual rule is yours.
export const HeadlessPlayer = () => (
  <Player.Root source="/video.mp4">
    <Player.Viewport className="my-viewport">
      <Player.Media />
      <Player.Controls className="my-controls">
        <Player.PlayButton className="my-button" />
        <Player.SeekSlider className="my-slider" />
        <Player.MuteButton className="my-button" />
        <Player.FullscreenButton className="my-button" />
      </Player.Controls>
    </Player.Viewport>
  </Player.Root>
);
