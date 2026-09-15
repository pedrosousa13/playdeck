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
  // falling back to `''` for "no active track" -- a state that is reachable,
  // not merely guarded against. hls.js's `onAudioTracksUpdated`
  // (provider-hls/src/audio-tracks.ts) can report `available` with every
  // track still inactive: `AUDIO_TRACKS_UPDATED` fires before
  // `AudioTrackController.switchLevel` resolves a default, a window that
  // file's own header comment explains and `onAudioTrackSwitching` closes
  // moments later. The native provider enforces exclusivity only on
  // selection too (CONTEXT.md's **Audio track** glossary entry) -- nothing
  // guarantees one active track at rest on either provider, which is what
  // `MenuRadioGroup` still needs some value for.
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
