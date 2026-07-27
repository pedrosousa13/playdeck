import * as Player from '@reely/react';
import { useEffect } from 'react';

// Declaratively: `commandsReady` means a command issued now is accepted and
// will not be undone by a load that has yet to run.
export const RateOnReady = () => {
  const actions = Player.usePlayerActions();
  const commandsReady = Player.usePlayerState((state) => state.commandsReady);

  useEffect(() => {
    if (commandsReady) void actions.setPlaybackRate(0.75);
  }, [commandsReady, actions]);

  return null;
};

// Imperatively: `whenReady()` resolves `true` at that same moment, and `false`
// if the player detaches, is swapped, or fails fatally. It never rejects and
// never hangs, and a call made before a provider attaches waits rather than
// answering `false`.
export const RateWhenReady = () => {
  const actions = Player.usePlayerActions();

  return (
    <button
      onClick={async () => {
        if (await actions.whenReady()) void actions.setPlaybackRate(0.75);
      }}
    >
      Slow down
    </button>
  );
};
