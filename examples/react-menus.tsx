import * as Player from '@playdeck/react';

/**
 * The label a quality rung prints: its height. Not a promise the *library*
 * makes about every provider -- `PlayerQuality`'s `height` field is nullable
 * -- so the rung's own id stands in for the one entry that carries none. The
 * bitrate is not printed here; the stats readout under the player already
 * shows it.
 */
const qualityLabel = (quality: {
  readonly id: string;
  readonly height: number | null;
}): string => (quality.height === null ? quality.id : `${quality.height}p`);

// A settings menu built from the menu parts: quality, then playback rate.
// `SettingsMenu` owns the open state and returns focus to the trigger on
// every close path.
export const RateMenu = () => {
  const actions = Player.usePlayerActions();
  const { rate, qualityStatus, qualities, selectedQualityId } =
    Player.usePlayerState((state) => ({
      rate: state.playbackRate,
      qualityStatus: state.capabilities.selectQuality.status,
      qualities: state.qualities,
      selectedQualityId: state.selectedQualityId
    }));

  return (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger aria-label="Settings" />
      <Player.SettingsMenuContent>
        {/* Gated the same way the library gates its own controls: absent
            where the provider will not honour `selectQuality`, never present
            and empty -- a source with no ladder to choose from (YouTube)
            prints no group at all. */}
        {qualityStatus === 'available' && qualities.length > 0 && (
          <Player.MenuRadioGroup
            aria-label="Quality"
            value={selectedQualityId ?? ''}
            onValueChange={(value) =>
              void actions.selectQuality(value === '' ? null : value)
            }
          >
            <Player.MenuRadioItem value="">Auto</Player.MenuRadioItem>
            {qualities.map((quality) => (
              <Player.MenuRadioItem key={quality.id} value={quality.id}>
                {qualityLabel(quality)}
              </Player.MenuRadioItem>
            ))}
          </Player.MenuRadioGroup>
        )}
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
