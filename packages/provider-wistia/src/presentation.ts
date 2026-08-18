import type { CommandResult } from '@playdeck/core';
import {
  providerEvent,
  runWistiaCommand,
  type EmitProviderState
} from './adapter-values.js';
import type { WistiaPlayerApi } from './loader.js';

// The slice of the handle this seam drives. Aurora owns the fullscreen element
// itself, so nothing here touches the document. There is no picture-in-picture
// counterpart: `PublicApi` declares none.
export type WistiaPresentationPlayer = Pick<
  WistiaPlayerApi,
  'requestFullscreen' | 'cancelFullscreen'
>;

export type WistiaPresentationDeps = {
  readonly emit: EmitProviderState;
  readonly getPlayer: () => WistiaPresentationPlayer | undefined;
};

// The presentation seam: the two fullscreen commands and the player's own
// reports of entering and leaving. It holds no capability of its own — Aurora
// answers fullscreen on every player, and picture-in-picture on none, so
// neither answer can be changed by anything that happens here.
export type WistiaPresentation = {
  readonly requestFullscreen: () => Promise<CommandResult>;
  readonly exitFullscreen: () => Promise<CommandResult>;
  readonly handlers: {
    readonly onEnterFullscreen: (detail?: unknown) => void;
    readonly onCancelFullscreen: (detail?: unknown) => void;
  };
};

export const createWistiaPresentation = ({
  emit,
  getPlayer
}: WistiaPresentationDeps): WistiaPresentation => {
  const publishFullscreen = (fullscreen: boolean, detail?: unknown): void =>
    emit(
      { fullscreen },
      providerEvent('fullscreenchange', { fullscreen }, detail)
    );

  return {
    requestFullscreen: () =>
      runWistiaCommand(getPlayer(), (player) => player.requestFullscreen()),
    exitFullscreen: () =>
      runWistiaCommand(getPlayer(), (player) => player.cancelFullscreen()),
    handlers: {
      onEnterFullscreen: (detail) => publishFullscreen(true, detail),
      onCancelFullscreen: (detail) => publishFullscreen(false, detail)
    }
  };
};
