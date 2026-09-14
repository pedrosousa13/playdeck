import { usePlayer, usePlayerState } from './player-context.js';
import {
  MenuRadioGroup,
  MenuRadioItem,
  SettingsMenu,
  SettingsMenuContent,
  SettingsMenuTrigger
} from './settings-menu.js';
import type { ComponentPropsWithRef } from 'react';

export type AudioTrackMenuProps = ComponentPropsWithRef<'div'>;

/**
 * Preset assembly over `SettingsMenu`/`MenuRadioGroup`: lists the published
 * audio tracks (`PlayerState.audioTracks`), marking the active one. Renders
 * nothing until `capabilities.selectAudioTrack` resolves `available`. Pass
 * children to fully customize the trigger/content; omit them to get the
 * default track list.
 */
export const AudioTrackMenu = ({ children, ...props }: AudioTrackMenuProps) => {
  const { audioTracks, status } = usePlayerState((state) => ({
    audioTracks: state.audioTracks,
    status: state.capabilities.selectAudioTrack.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  // Unlike `QualityMenu`'s `selectedQualityId`, there is no sibling
  // `selectedAudioTrackId` field to read `MenuRadioGroup`'s `value` from --
  // `AudioTrack.active` carries selection per entry instead (see the comment
  // above `AudioTrack`, types.ts). The active entry's id stands in for it,
  // falling back to `''` for "no active track", which both providers keep
  // from actually happening while this capability reads `available` (each
  // enforces at most, and at least, one active track once it has a list to
  // report) but which `MenuRadioGroup` still needs some value for.
  const activeId = audioTracks.find((track) => track.active)?.id ?? '';

  return (
    <SettingsMenu {...props}>
      {children ?? (
        <>
          {/* No dedicated audio-track icon exists, so this relies on
              SettingsMenuTrigger's own fallback -- `{children ?? <SettingsIcon
              />}` in settings-menu.tsx -- the same way QualityMenu and
              PlaybackRateMenu do for the identical case. */}
          <SettingsMenuTrigger aria-label="Audio track" />
          <SettingsMenuContent>
            <MenuRadioGroup
              onValueChange={(value) => {
                void controller.selectAudioTrack(value);
              }}
              value={activeId}
            >
              {audioTracks.map((track) => (
                <MenuRadioItem key={track.id} value={track.id}>
                  {track.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </SettingsMenuContent>
        </>
      )}
    </SettingsMenu>
  );
};
