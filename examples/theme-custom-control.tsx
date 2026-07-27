import * as Player from '@reely/react';

// The theme targets parts, not components: a control you build yourself is
// themed by carrying the part attribute, and skips the theme entirely if it
// does not.
export const MyPlayButton = () => {
  const { togglePlayback } = Player.usePlayerActions();
  const playback = Player.usePlayerState((state) => state.playback);

  return (
    <button data-reely-part="play-button" onClick={togglePlayback}>
      {playback === 'playing' ? 'Pause' : 'Play'}
    </button>
  );
};
