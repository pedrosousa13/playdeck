import { usePlayer, usePlayerState } from './player-context.js';
import {
  MenuRadioGroup,
  MenuRadioItem,
  SettingsMenu,
  SettingsMenuContent,
  SettingsMenuTrigger
} from './settings-menu.js';
import type { ComponentPropsWithRef } from 'react';

// The repo's own sensible default, already stated by RateMenu
// (examples/react-menus.tsx) for the identical "list of rates" case.
const DEFAULT_RATES: readonly number[] = [0.5, 1, 1.5, 2];

export type PlaybackRateMenuProps = ComponentPropsWithRef<'div'> & {
  readonly rates?: readonly number[];
};

/**
 * Preset assembly over `SettingsMenu`/`MenuRadioGroup`: lists the playback
 * rates offered by `rates` (default `[0.5, 1, 1.5, 2]`), marking the active
 * one from `state.playbackRate`. Pass children to fully customize the
 * trigger/content; omit them to get the default rate list.
 */
export const PlaybackRateMenu = ({
  children,
  rates = DEFAULT_RATES,
  ...props
}: PlaybackRateMenuProps) => {
  const { playbackRate, status } = usePlayerState((state) => ({
    playbackRate: state.playbackRate,
    status: state.capabilities.setPlaybackRate.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <SettingsMenu {...props}>
      {children ?? (
        <>
          {/* No dedicated playback-rate icon exists, so this relies on
              SettingsMenuTrigger's own fallback -- `{children ?? <SettingsIcon
              />}` in settings-menu.tsx -- the same way QualityMenu does for
              the identical case. */}
          <SettingsMenuTrigger aria-label="Playback rate" />
          <SettingsMenuContent>
            <MenuRadioGroup
              onValueChange={(value) => {
                void controller.setPlaybackRate(Number(value));
              }}
              value={String(playbackRate)}
            >
              {rates.map((rate) => (
                <MenuRadioItem key={rate} value={String(rate)}>
                  {rate}×
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </SettingsMenuContent>
        </>
      )}
    </SettingsMenu>
  );
};
