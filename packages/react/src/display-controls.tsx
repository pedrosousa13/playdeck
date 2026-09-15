import { controlTargetStyle } from './loading-error.js';
import { usePlayer, usePlayerState } from './player-context.js';
import type { ComponentPropsWithRef } from 'react';

export type FullscreenButtonProps = ComponentPropsWithRef<'button'>;

export const FullscreenButton = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: FullscreenButtonProps) => {
  const { fullscreen, provider, status } = usePlayerState((state) => ({
    fullscreen: state.fullscreen,
    provider: state.provider,
    status: state.capabilities.fullscreen.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={
        ariaLabel ?? (fullscreen ? 'Exit fullscreen' : 'Enter fullscreen')
      }
      aria-pressed={fullscreen}
      data-provider={provider ?? undefined}
      data-playdeck-part="fullscreen-button"
      data-state={fullscreen ? 'active' : 'inline'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void (fullscreen
          ? controller.exitFullscreen()
          : controller.requestFullscreen());
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? (fullscreen ? 'Exit fullscreen' : 'Enter fullscreen')}
    </button>
  );
};

export type PipButtonProps = ComponentPropsWithRef<'button'>;

export const PipButton = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: PipButtonProps) => {
  const { pictureInPicture, provider, status } = usePlayerState((state) => ({
    pictureInPicture: state.pictureInPicture,
    provider: state.provider,
    status: state.capabilities.pictureInPicture.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={
        ariaLabel ??
        (pictureInPicture
          ? 'Exit picture-in-picture'
          : 'Enter picture-in-picture')
      }
      aria-pressed={pictureInPicture}
      data-provider={provider ?? undefined}
      data-playdeck-part="pip-button"
      data-state={pictureInPicture ? 'active' : 'inline'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void (pictureInPicture
          ? controller.exitPictureInPicture()
          : controller.requestPictureInPicture());
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ??
        (pictureInPicture
          ? 'Exit picture-in-picture'
          : 'Enter picture-in-picture')}
    </button>
  );
};

export type AirPlayButtonProps = ComponentPropsWithRef<'button'>;

/**
 * Opens the platform AirPlay route picker. Gated on the `airPlay` capability,
 * so it renders nothing outside Safari/iOS where AirPlay does not exist.
 *
 * Unlike `FullscreenButton` and `PipButton` this is **not** a toggle. Which
 * device the user picked is never exposed, and Playdeck does not currently
 * surface an active-route flag either: WebKit's
 * `webkitCurrentPlaybackTargetIsWireless` is deliberately unplumbed (see
 * `provider-native`). So there is no state to render today — no `aria-pressed`,
 * one static label, no `data-state`.
 *
 * That last part is current behaviour, not a permanent guarantee: if the
 * wireless-route flag is ever surfaced, this control gains a state.
 */
export const AirPlayButton = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: AirPlayButtonProps) => {
  const { provider, status } = usePlayerState((state) => ({
    provider: state.provider,
    status: state.capabilities.airPlay.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={ariaLabel ?? 'AirPlay'}
      data-provider={provider ?? undefined}
      data-playdeck-part="airplay-button"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void controller.showAirPlayPicker();
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? 'AirPlay'}
    </button>
  );
};

export type RemotePlaybackButtonProps = ComponentPropsWithRef<'button'>;

/**
 * Opens the browser's Remote Playback picker (the standards-based route to
 * Chromecast and other receivers). Gated on the `remotePlayback` capability,
 * so it renders nothing until a device is actually available.
 *
 * Structured like `AirPlayButton`: **not** a toggle. Which device the user
 * picked -- or whether they picked one at all -- is never exposed, so there is
 * no `aria-pressed` and one static label. `PlayerState.remotePlayback` does
 * carry the connection state once a session starts (`connecting` /
 * `connected` / `disconnected`), for a consumer who wants to render it, but
 * this button itself does not.
 */
export const RemotePlaybackButton = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: RemotePlaybackButtonProps) => {
  const { provider, status } = usePlayerState((state) => ({
    provider: state.provider,
    status: state.capabilities.remotePlayback.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={ariaLabel ?? 'Cast'}
      data-provider={provider ?? undefined}
      data-playdeck-part="remote-playback-button"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void controller.showRemotePlaybackPicker();
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? 'Cast'}
    </button>
  );
};
