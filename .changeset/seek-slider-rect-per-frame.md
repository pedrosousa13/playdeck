---
'@playdeck/react': patch
---

`SeekSlider` measures its track at most once per animation frame while the pointer hovers or drags. A burst of `pointermove` events sharing a frame reads one cached rect instead of forcing a fresh layout per event; the thumbnail preview and seek position stay exact for every event.
