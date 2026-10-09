---
title: "Provider setup"
description: "Which source values each provider accepts, which it refuses, and what its own options are."
---

Which source values each provider accepts, which it refuses, and what its own options are. Native files and HLS share a page, because the setup document covers them in one passage and one extension table.

## [YouTube](./youtube.md)

- `@playdeck/provider-youtube` YouTube IFrame Player API provider for Playdeck.

## [Vimeo](./vimeo.md)

- `@playdeck/provider-vimeo` Vimeo player SDK provider for Playdeck.

## [Wistia](./wistia.md)

- `@playdeck/provider-wistia` Wistia player SDK provider for Playdeck.

## [Native files and HLS](./native-files-and-hls.md)

- `@playdeck/provider-native` HTMLMediaElement provider for Playdeck: progressive files and native HLS.
- `@playdeck/provider-hls` HLS provider for Playdeck, over hls.js or the browser’s native HLS.

## What each provider can answer

Every cell below is read out of `docs/provider-setup.md`. Five providers in four columns — native files and HLS share one, because that document covers them in one passage. They do not answer the same question equally well, so the table does not pretend that they do: where a fact cannot be known, the cell says so and carries the document's own reason for it.

| | [YouTube](./youtube.md) `@playdeck/provider-youtube` | [Vimeo](./vimeo.md) `@playdeck/provider-vimeo` | [Wistia](./wistia.md) `@playdeck/provider-wistia` | [Native files and HLS](./native-files-and-hls.md) `@playdeck/provider-native` `@playdeck/provider-hls` |
| --- | --- | --- | --- | --- |
| Which hosts it answers to | **available** (8): `youtu.be`, `www.youtu.be`, `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com`, `www.youtube-nocookie.com` | **available** (3): `vimeo.com`, `www.vimeo.com`, `player.vimeo.com` | **unknown** (2): `wistia.com`, `wistia.net`. Hosts are `wistia.com`, `wistia.net` and any subdomain of either — matched on the suffix, because the account subdomain is per-customer and cannot be enumerated. | **unavailable**. These have no host list at all — the extension of the path decides, on any host and on relative paths too. |
| Which source forms it reads | **available** (5): `https://www.youtube.com/watch?v=<id>`, `https://www.youtube.com/embed/<id>`, `https://www.youtube.com/live/<id>`, `https://www.youtube.com/shorts/<id>`, `https://youtu.be/<id>` | **available** (5): `https://vimeo.com/<id>`, `https://vimeo.com/<id>/<hash>`, `https://player.vimeo.com/video/<id>`, `https://player.vimeo.com/video/<id>/<hash>`, `any of the above with ?h=<hash>` | **available** (3): `/medias/<id>`, `/embed/medias/<id>`, `/embed/iframe/<id>` | **available** (3): `.mp4`, `.webm`, `.m3u8` |
| Which options are its own | **available** (3): `host`, `https://www.youtube-nocookie.com`, `https://www.youtube.com` | **available** (3): `dnt`, `customControls`, `suppressSeoMetadata` | **available** (6): `controls`, `dnt`, `playerColor`, `swatch`, `poster`, `transparentLetterbox` | **available** (1): `build` |
