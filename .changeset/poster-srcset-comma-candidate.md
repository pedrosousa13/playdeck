---
'@playdeck/react': patch
---

Parse `Player.PosterImage`'s `srcSet` candidates the way browsers do, so a URL containing a comma no longer gets corrupted

`srcSet` candidates are now scanned per the HTML spec's own grammar: a
candidate's URL runs up to the next whitespace, and a comma only ends a
candidate once that candidate's URL and optional descriptor have already
been consumed. A candidate URL from an image-transformation service (a
Cloudinary-style `.../upload/w_400,c_fill/a.jpg 400w`, for instance) now
survives as one candidate instead of splitting at its embedded comma into
two malformed ones. Each candidate still goes through the same URL
allowlist as every other candidate.
