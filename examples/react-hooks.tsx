import * as Player from '@playdeck/react';

// `usePlayerState` takes a selector and re-renders only when the selected
// value changes — not on every time update.
export const PlaybackLabel = () => {
  const playback = Player.usePlayerState((state) => state.playback);
  return <span>{playback}</span>;
};

// Commands are answered: `whenReady` tells you when one will land, instead of
// issuing it and hoping.
export const SlowMotionButton = () => {
  const actions = Player.usePlayerActions();
  return (
    <button
      onClick={async () => {
        if (await actions.whenReady()) await actions.setPlaybackRate(0.75);
      }}
    >
      0.75×
    </button>
  );
};

// The cues active right now, for rendering captions yourself.
export const CueText = () => {
  const cues = Player.useActiveCues();
  return <p>{cues.map((cue) => cue.text).join(' ')}</p>;
};
