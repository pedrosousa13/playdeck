# @playdeck/provider-native

The `HTMLMediaElement` provider for [Playdeck](https://github.com/pedrosousa13/playdeck):
progressive MP4/WebM, and HLS in browsers that play it natively (Safari, iOS).

```sh
pnpm add @playdeck/provider-native
```

`@playdeck/react` loads this for you when the source resolves to `video` — an
`.mp4` or `.webm` path, or an explicit `{ type: 'video' }` source; see
[Provider setup](https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md#the-other-three-providers).
See "Without React" below for driving a `PlayerController` yourself.

<!-- example:provider-setup-native -->

```tsx
import * as Player from '@playdeck/react';

// A native source is an `.mp4`/`.webm` URL in the `source` prop.
// `loop`, `startTime` and `endTime` are `Player.Root`'s own props on every
// provider (ADR-0004), never keys in a provider's option bag — native takes no
// `providerOptions` key of its own at all.
export const ClipWithCaptions = () => (
  <Player.Root
    loop
    startTime={30}
    endTime={45}
    source="https://example.com/clip.mp4"
  >
    <Player.Viewport>
      {/* `textTracks` reaches native playback directly, unlike the embed
          providers, where only captions a provider discovers for itself are
          available. */}
      <Player.Media
        textTracks={[
          { src: '/captions.en.vtt', srcLang: 'en', label: 'English' }
        ]}
      />
      <Player.Captions />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.CaptionsButton />
        <Player.PipButton />
        {/* Renders only where there is a receiver to cast to. */}
        <Player.AirPlayButton />
        <Player.FullscreenButton />
      </Player.Controls>
      <Player.ErrorDisplay />
    </Player.Viewport>
  </Player.Root>
);
```

<!-- /example -->

## Without React

Reach for this package directly when you are writing a provider adapter, or
hosting a player somewhere other than React.

<!-- example:provider-native -->

```ts
import { PlayerController } from '@playdeck/core';
import { createNativeProvider } from '@playdeck/provider-native';

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
- **A `startTime` the source cannot be positioned at** publishes a non-fatal
  `configuration` notice on `PlayerState.error` rather than disappearing. The
  offset is considered exactly once per load, at the first `loadedmetadata`;
  it is bounded by the media's own duration, so an offset past the end of the
  clip is still refused, and the element's `seekable` ranges decide whether the
  element will move at all rather than where it lands — a window that does not
  reach the offset is a refusal, never a nudge onto its nearest edge. The
  playhead is then read back to confirm it arrived, so an element that takes
  the write and stays put is reported too. The notice is how you tell any of
  that apart from a setting you mis-wired. It does not make the offset apply.

  **The playhead is confirmed on the same tick, and again once the element
  reports it is no longer seeking, which is what makes the notice reliable on
  WebKit too.** The first read is in the same tick as the write; chromium and
  firefox clamp before the write's setter returns, so that read already sees a
  refusal there. Where it does not, the provider watches `media.seeking`, the
  same flag the HTML seek algorithm itself clears once a seek concludes,
  refusal or not, and takes its deferred read the moment that flag reads
  false -- catching an engine whose setter answers the write before its own
  seek has finished deciding.

  **A refusal at that single attempt is permanent for the load.** Nothing
  reconsiders it afterward — not a `seekable` window that later widens past
  the requested offset, not any other change of state before the next load.
  The `configuration` notice above is the record of the refusal: once it has
  fired for a load, nothing re-applies the offset or retracts the notice for
  that same load. Only a fresh load — a new source, or an explicit `retry` —
  gives the offset another attempt.

- **`selectQuality`** is `unavailable` with reason `source`: the browser picks
  its own rendition for native HLS and there is nothing to enumerate. It is not
  `unknown`, because that would promise an answer that never comes.
- **`airPlay`** follows WebKit's `webkitplaybacktargetavailabilitychanged`, so
  it means "there is a receiver to cast to", not "this browser has the picker
  API". It goes back to `unavailable` when the route disappears.
- **Captions** are Playdeck's to draw by default (`captionRendering: 'custom'`);
  `setCaptionRenderer('native')` hands them back to the browser's own renderer.
- **`live`** comes from the element's own signals: an endless `duration` and the
  moving `seekable` window, measured against the playhead. Never from the source
  URL. A file with a finite duration reports `null`, and the value is published
  again only when it changes.
- **`commandsReady`** is declared after `media.load()`, because `load()` resets
  `playbackRate` and anything applied earlier would be silently undone.
- **Chapters** come from a `kind="chapters"` text track. Its mode is moved to
  `hidden`, because a track's cues are never obtained while its mode is
  `disabled`, and its cues are read on the track's `cuechange` and the
  `<track>` element's `load` — not at the mode write, where there is nothing to
  read yet. The track stays out of `textTracks`: chapters are their own
  collection.

## License

[MIT](LICENSE).
