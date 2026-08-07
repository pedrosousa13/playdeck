# Hover scrub preview and a thumbnail source

Reely ships no hover preview over the seek bar, and no thumbnail track for one
to draw from. `SeekSlider` reports position and lets you compose whatever you
like on top of it; it does not render a preview, and no provider hands reely
frames to build one out of.

## Why this is out of scope

The request has two halves, and each fails for its own reason.

**The preview is already buildable.** `SeekSlider` accepts children and exposes
its range through the underlying input's `min` and `max`. A consumer can map a
pointer position against the element's bounding rect, resolve it to a time, and
render whatever they want at that offset — a thumbnail, a timestamp, a chapter
title. Nothing in reely blocks it and nothing new is needed to allow it. Adding
a reely-drawn preview would not unlock a capability; it would substitute reely's
presentation for the consumer's, in a component whose whole point is that the
consumer composes it. That is the same reasoning as
[default-presentation-on-blocked-autoplay](./default-presentation-on-blocked-autoplay.md).

**No provider can supply the frames.** The half that would be genuine new
capability — a thumbnail source reely could offer — has nothing behind it.
There is no sprite handling, no trick-play support, no
`EXT-X-IMAGE-STREAM-INF` parsing, and no provider that reports a preview track.
Building a thumbnail vocabulary with no provider able to populate it produces a
type nobody can use, and a seek bar that reads it always finds it empty.

So the useful half is redundant and the novel half has no data source.

## The composition recipe

For anyone arriving here wanting the feature: the seek bar's underlying range
input carries `min` and `max` in seconds. On pointer move over the slider,
take the pointer's x offset within the element's bounding rect, divide by its
width, scale into the `min`–`max` range, and you have the hovered time. Render
your own preview element positioned at that offset, sourced from whatever
thumbnails your own pipeline produces. Player state gives you `buffered` and
`seekable` if you want to suppress the preview outside a seekable range.

## What would reopen this

A provider that actually reports a thumbnail or trick-play track, making the
data-source half real — HLS image stream playlists are the most likely route. At
that point the question becomes whether reely surfaces that track in player
state, which is a different question from whether reely draws a preview, and
should be raised as that.

Also reopening: a concrete case where the composition recipe above is not
sufficient. That would be a gap in what `SeekSlider` exposes, and should be
raised as that rather than as a request for a preview.

## Prior requests

- [#183](https://github.com/pedrosousa13/reely/issues/183) — No hover scrub
  preview, and no thumbnail source to build one from.
