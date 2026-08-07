# @reely/provider-native

The `HTMLMediaElement` provider for [Reely](https://github.com/pedrosousa13/reely):
progressive MP4/WebM, and HLS in browsers that play it natively (Safari, iOS).

```sh
pnpm add @reely/provider-native
```

`@reely/react` loads this for you when the source resolves to `video`. Install
it directly only if you are driving a `PlayerController` yourself.

<!-- example:provider-native -->

```ts
import { PlayerController } from '@reely/core';
import { createNativeProvider } from '@reely/provider-native';

declare const videoElement: HTMLVideoElement;

const controller = new PlayerController();

// Plays anything the element itself can play — MP4, WebM, and HLS on Safari,
// where the browser has its own HLS support.
controller.setProvider(
  createNativeProvider(videoElement, {
    loop: true,
    // A clip out of a longer file: playback is clamped to this window.
    startTime: 30,
    endTime: 45
  })
);

export const play = (): Promise<unknown> => controller.play();
```

<!-- /example -->

## Exports

| Export                  | What it is                                      |
| ----------------------- | ----------------------------------------------- |
| `createNativeProvider`  | Builds the adapter over a `<video>` element.    |
| `NativePlaybackOptions` | `loop`, `startTime`, `endTime`.                 |
| `NativeProviderAdapter` | The adapter's own type, if you need to name it. |

## What it reports honestly

- **Seeking** is clamped to the element's `seekable` ranges intersected with any
  `startTime`/`endTime` you configured. A seek with nowhere legal to land is
  refused with `provider-error` rather than snapped somewhere outside your
  bounds.
- **`selectQuality`** is `unavailable` with reason `source`: the browser picks
  its own rendition for native HLS and there is nothing to enumerate. It is not
  `unknown`, because that would promise an answer that never comes.
- **`airPlay`** follows WebKit's `webkitplaybacktargetavailabilitychanged`, so
  it means "there is a receiver to cast to", not "this browser has the picker
  API". It goes back to `unavailable` when the route disappears.
- **Captions** are Reely's to draw by default (`captionRendering: 'custom'`);
  `setCaptionRenderer('native')` hands them back to the browser's own renderer.
- **`live`** comes from the element's own signals: an endless `duration` and the
  moving `seekable` window, measured against the playhead. Never from the source
  URL. A file with a finite duration reports `null`, and the value is published
  again only when it changes.
- **`commandsReady`** is declared after `media.load()`, because `load()` resets
  `playbackRate` and anything applied earlier would be silently undone.

## License

[MIT](LICENSE).
