import type { PlayerQuality } from '@playdeck/core';
import { usePlayer, usePlayerState } from './player-context.js';
import {
  MenuRadioGroup,
  MenuRadioItem,
  SettingsMenu,
  SettingsMenuContent,
  SettingsMenuTrigger
} from './settings-menu.js';
import type { ComponentPropsWithRef } from 'react';

// The label a quality rung prints: its height, falling back to bitrate and
// then id for a rung that carries neither -- `PlayerQuality.height` and
// `.bitrate` are both nullable.
const qualityLabel = (quality: PlayerQuality): string => {
  if (quality.height !== null) return `${quality.height}p`;
  if (quality.bitrate !== null)
    return `${Math.round(quality.bitrate / 1000)} kbps`;
  return quality.id;
};

// `selectedQualityId === null` means auto (types.ts, above `qualities`); the
// auto row's own label names the level actually playing rather than just
// saying "Auto", e.g. "Auto (1080p)", falling back to "Auto" before a level
// is known.
const autoLabel = (playing: PlayerQuality | null): string =>
  playing !== null && playing.height !== null
    ? `Auto (${playing.height}p)`
    : 'Auto';

export type QualityMenuProps = ComponentPropsWithRef<'div'>;

/**
 * Preset assembly over `SettingsMenu`/`MenuRadioGroup`: lists the current
 * quality ladder plus an "Auto" option. Pass children to fully customize the
 * trigger/content; omit them to get the default quality list.
 */
export const QualityMenu = ({ children, ...props }: QualityMenuProps) => {
  const { autoStatus, playing, qualities, selectedId, status } = usePlayerState(
    (state) => ({
      autoStatus: state.capabilities.selectQualityAuto.status,
      playing: state.quality,
      qualities: state.qualities,
      selectedId: state.selectedQualityId,
      status: state.capabilities.selectQuality.status
    })
  );
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <SettingsMenu {...props}>
      {children ?? (
        <>
          {/* No dedicated quality icon exists (unlike CaptionsMenu's
              CaptionsIcon), so this relies on SettingsMenuTrigger's own
              fallback -- `{children ?? <SettingsIcon />}` in
              settings-menu.tsx -- the same way RateMenu
              (examples/react-menus.tsx) does for the identical case. */}
          <SettingsMenuTrigger aria-label="Quality" />
          <SettingsMenuContent>
            <MenuRadioGroup
              onValueChange={(value) => {
                void controller.selectQuality(value === '' ? null : value);
              }}
              value={selectedId ?? ''}
            >
              {/* Gated on `selectQualityAuto` rather than `selectQuality`
                  above: a provider can accept `selectQuality` for a real
                  rung while refusing `selectQuality(null)` -- see the
                  comment on `PlayerCapabilities.selectQualityAuto`. Showing
                  this row anyway would put a radio item in the menu that
                  silently does nothing when chosen. */}
              {autoStatus === 'available' && (
                <MenuRadioItem value="">{autoLabel(playing)}</MenuRadioItem>
              )}
              {qualities.map((quality) => (
                <MenuRadioItem key={quality.id} value={quality.id}>
                  {qualityLabel(quality)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </SettingsMenuContent>
        </>
      )}
    </SettingsMenu>
  );
};
