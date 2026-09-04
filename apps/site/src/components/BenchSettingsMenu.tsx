/*
 * What the bench's settings menu holds: the quality group, the rate group,
 * and Restart -- everything `Player.SettingsMenuContent` renders, so
 * `BenchIsland.tsx` mounts one component rather than the printed panel
 * showing a menu wider than what actually renders.
 *
 * Lifted out of `examples/react-menus.tsx`'s `RateMenu` rather than
 * imported: that file's whole job is to show a consumer the menu built from
 * the library's own parts, wrapping `Player.SettingsMenu` and its trigger
 * around this same content, and a bench that mounted it directly would have
 * no way to print a shorter tree than the one it actually renders --
 * `bench-composition.ts` prints `<QualityAndRateMenu />` where the panel used
 * to transcribe every line of the menu by hand, which is what makes this
 * extraction the fix for the panel's own length. The two files are two
 * copies of the same reasoning on purpose: `RateMenu` is what a reader of the
 * examples sees, this is what the bench mounts, and neither owes the other an
 * import.
 */
import * as Player from '@playdeck/react';

/** The label a quality rung prints: its height. Not a promise the *library*
 * makes about every provider -- `PlayerQuality`'s `height` field is nullable
 * -- so the rung's own id stands in for the one entry that carries none. The
 * bitrate is not printed here; the stats readout under the player already
 * shows it. */
const qualityLabel = (quality: {
  readonly id: string;
  readonly height: number | null;
}): string => (quality.height === null ? quality.id : `${quality.height}p`);

/**
 * The quality group (gated on `capabilities.selectQuality`), the playback
 * rate group, and Restart -- meant to sit inside a
 * `Player.SettingsMenuContent`, which owns the open state and returns focus
 * to the trigger on every close path.
 */
export const QualityAndRateMenu = () => {
  const actions = Player.usePlayerActions();
  const { rate, qualityStatus, qualities, selectedQualityId } =
    Player.usePlayerState((state) => ({
      rate: state.playbackRate,
      qualityStatus: state.capabilities.selectQuality.status,
      qualities: state.qualities,
      selectedQualityId: state.selectedQualityId
    }));

  return (
    <>
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
    </>
  );
};
