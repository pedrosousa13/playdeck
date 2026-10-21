---
'@playdeck/core': minor
'@playdeck/react': patch
---

`VideoFileSource.sources` renders its first 32 entries, and a text-track list renders its first 128. An entry past either cap is dropped before `Player.Media` renders anything for it and before it reaches the native provider, under every loading strategy. Each cap that drops an entry publishes one `configuration` notice naming the cap and the count dropped, the same pattern a rejected `sources[].media` entry and a rejected `preferredTextTrackLanguage` already use. An array at or under its cap renders every entry and publishes nothing. `PlayerController` gains `reportSourcesCap` and `reportTextTracksCap`, each taking the notice a caller already built.
