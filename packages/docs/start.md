---
title: "Start"
description: "Install one package, paste one composition, point it at a URL."
---

Install one package, paste one composition, point it at a URL. Every block below is a file this repository compiles, printed as it is on disk.

## Install

```sh
pnpm add @playdeck/react
```

Peers you supply: `react >=19 <20`, `react-dom >=19 <20`. Nothing else — the provider adapters are this package's own dependencies.

## The smallest player that works

A root, a viewport, the media element, and the controls a player needs to be usable. Paste it, change the URL, and there is a player on the page.

```tsx
import * as Player from '@playdeck/react';

// One API across MP4/WebM, HLS, YouTube, Vimeo and Wistia: the source decides
// which provider loads, and nothing else changes.
export const Clip = () => (
  <Player.Root source="https://example.com/clip.mp4">
    <Player.Viewport>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.FullscreenButton />
      </Player.Controls>
    </Player.Viewport>
  </Player.Root>
);
```

`examples/quickstart.tsx`

## Everything the primitives give you

The same shape with the rest of it: captions, a poster, and every control the package ships. Nothing here is styled — the primitives render no CSS of their own, and what each part puts in the DOM for you to style is in [the contract guide](./guides/contract.md). For a player that looks like something without writing any, add the optional default theme, `import '@playdeck/react/theme.css';`, which [the package reference](./reference/react.md) covers.

```tsx
import * as Player from '@playdeck/react';

export const Clip = () => (
  <Player.Root source="https://example.com/clip.mp4">
    <Player.Viewport>
      <Player.Media
        textTracks={[
          { src: '/captions.en.vtt', srcLang: 'en', label: 'English' }
        ]}
      />
      <Player.Poster>
        <Player.PosterImage alt="" src="/poster.jpg" />
      </Player.Poster>
      <Player.Captions />
      <Player.Controls>
        <Player.PlayButton />
        <Player.MuteButton />
        <Player.VolumeSlider />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.Time type="duration" />
        <Player.CaptionsButton />
        <Player.PipButton />
        {/* Renders only where there is somewhere to cast to. */}
        <Player.AirPlayButton />
        {/* Renders only where a Remote Playback API device is reachable. */}
        <Player.RemotePlaybackButton />
        <Player.FullscreenButton />
      </Player.Controls>
    </Player.Viewport>
  </Player.Root>
);
```

`examples/react-composition.tsx`

Controls draw themselves only where the provider behind them reports it can honour the command, so this composition is a different set of buttons against a YouTube video than against an MP4. Which capabilities each adapter reports is in [the capability matrix](./guides/capabilities-matrix.md).

## Every provider, one prop

The `source` value is what chooses an adapter, and it is the only thing that changes between them. An adapter is imported dynamically, so the one your source selects is the only one a reader of your site downloads — together with whatever that adapter brings with it, which for HLS is almost all of the cost.

| Provider | Adapter | Brings with it |
| --- | --- | --- |
| [YouTube](./providers/youtube.md) | [`@playdeck/provider-youtube`](./reference/provider-youtube.md) | — |
| [Vimeo](./providers/vimeo.md) | [`@playdeck/provider-vimeo`](./reference/provider-vimeo.md) | `@vimeo/player` |
| [Wistia](./providers/wistia.md) | [`@playdeck/provider-wistia`](./reference/provider-wistia.md) | — |
| [Native files and HLS](./providers/native-files-and-hls.md) | [`@playdeck/provider-native`](./reference/provider-native.md) | — |
| [Native files and HLS](./providers/native-files-and-hls.md) | [`@playdeck/provider-hls`](./reference/provider-hls.md) | `hls.js` |

A dependency is downloaded only when the adapter that imports it is, and hls.js not even then where the browser plays HLS itself — Safari and iOS never fetch it. YouTube and Wistia bring nothing because they load their player from their own origin at run time, which is a request rather than a package in your bundle. A provider name above links to the source values it accepts; the adapter beside it links to what that package reports about itself.

## Where to go next

- [Guides](./guides/index.md) — What a part is, what it puts in the DOM, and how to style one.
- [Reference](./reference/index.md) — Every published package, rendered from the README in its own tarball.
- [Provider setup](./providers/index.md) — Which source values each provider accepts, and which it refuses.
- [Examples](./examples.md) — Two finished players, running, printed beside the files they are.
