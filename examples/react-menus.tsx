import * as Player from '@playdeck/react';

// A playback-rate menu built from the menu parts. `SettingsMenu` owns the open
// state and returns focus to the trigger on every close path.
export const RateMenu = () => {
  const actions = Player.usePlayerActions();
  const rate = Player.usePlayerState((state) => state.playbackRate);

  return (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger aria-label="Settings" />
      <Player.SettingsMenuContent>
        <Player.MenuRadioGroup
          value={String(rate)}
          onValueChange={(value) => void actions.setPlaybackRate(Number(value))}
        >
          {[0.5, 1, 1.5, 2].map((option) => (
            <Player.MenuRadioItem key={option} value={String(option)}>
              {option}×
            </Player.MenuRadioItem>
          ))}
        </Player.MenuRadioGroup>
        <Player.MenuItem onSelect={() => void actions.seekTo(0)}>
          Restart
        </Player.MenuItem>
      </Player.SettingsMenuContent>
    </Player.SettingsMenu>
  );
};

// The caption track list, already wired to the player's own tracks.
export const Captions = () => <Player.CaptionsMenu />;
