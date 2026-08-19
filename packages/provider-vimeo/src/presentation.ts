import type {
  Availability,
  CommandResult,
  PlayerCapabilities
} from '@playdeck/core';
import {
  asRecord,
  available,
  providerEvent,
  runVimeoCommand,
  type EmitProviderState
} from './adapter-values.js';
import type { VimeoSdkPlayer } from './loader.js';

// The slice of the player this seam drives: the four presentation commands.
// The SDK owns the fullscreen and picture-in-picture elements themselves, so
// nothing here touches the document.
export type VimeoPresentationPlayer = Pick<
  VimeoSdkPlayer,
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'requestPictureInPicture'
  | 'exitPictureInPicture'
>;

export type VimeoPresentationDeps = {
  readonly emit: EmitProviderState;
  readonly getPlayer: () => VimeoPresentationPlayer | undefined;
  // The host's capabilities snapshot, republished when a command proves this
  // embed cannot present picture-in-picture.
  readonly getCapabilities: () => PlayerCapabilities;
};

// The presentation seam: the fullscreen and picture-in-picture commands and
// the embed's own reports of entering and leaving both. Vimeo answers
// fullscreen on every embed, so the only capability held here is the
// picture-in-picture one a refused request disproves.
export type VimeoPresentation = {
  readonly requestFullscreen: () => Promise<CommandResult>;
  readonly exitFullscreen: () => Promise<CommandResult>;
  readonly requestPictureInPicture: () => Promise<CommandResult>;
  readonly exitPictureInPicture: () => Promise<CommandResult>;
  readonly handlers: {
    readonly onFullscreenChange: (data?: unknown) => void;
    readonly onEnterPictureInPicture: (data?: unknown) => void;
    readonly onLeavePictureInPicture: (data?: unknown) => void;
  };
  // The `pictureInPicture` facet of the host's capabilities.
  readonly pictureInPictureAvailability: () => Availability;
};

export const createVimeoPresentation = ({
  emit,
  getPlayer,
  getCapabilities
}: VimeoPresentationDeps): VimeoPresentation => {
  let pictureInPictureAvailability: Availability = available;

  return {
    requestFullscreen: () =>
      runVimeoCommand(getPlayer(), (player) => player.requestFullscreen()),
    exitFullscreen: () =>
      runVimeoCommand(getPlayer(), (player) => player.exitFullscreen()),
    requestPictureInPicture: async () => {
      const result = await runVimeoCommand(getPlayer(), (player) =>
        player.requestPictureInPicture()
      );
      if (!result.ok && result.reason === 'unsupported') {
        pictureInPictureAvailability = {
          status: 'unavailable',
          reason: 'provider'
        };
        emit({ capabilities: getCapabilities() });
      }
      return result;
    },
    exitPictureInPicture: () =>
      runVimeoCommand(getPlayer(), (player) => player.exitPictureInPicture()),
    handlers: {
      onFullscreenChange: (data) => {
        const fullscreen = asRecord(data).fullscreen === true;
        emit(
          { fullscreen },
          providerEvent('fullscreenchange', { fullscreen }, data)
        );
      },
      onEnterPictureInPicture: (data) =>
        emit(
          { pictureInPicture: true },
          providerEvent(
            'pictureinpicturechange',
            { pictureInPicture: true },
            data
          )
        ),
      onLeavePictureInPicture: (data) =>
        emit(
          { pictureInPicture: false },
          providerEvent(
            'pictureinpicturechange',
            { pictureInPicture: false },
            data
          )
        )
    },
    pictureInPictureAvailability: () => pictureInPictureAvailability
  };
};
