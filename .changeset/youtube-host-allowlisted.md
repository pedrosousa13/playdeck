---
'@playdeck/provider-youtube': patch
---

The YouTube provider now checks `host` where it resolves the option, rather
than handing any string to the iframe API as the origin the embed is built
from. A `host` is kept only if its parsed origin is `https://www.youtube.com`
or `https://www.youtube-nocookie.com`; a trailing slash or upper-case spelling
of either resolves to the same origin and is accepted. Any other origin — and
a malformed or empty value, which does not parse — falls back to the
privacy-enhanced `https://www.youtube-nocookie.com` default rather than
throwing, so a misconfigured host degrades to the safe embed instead of
breaking the page. This matters beyond the iframe's own location: the embedding
page's origin is declared to the player for `postMessage` validation, and a
host outside YouTube would have received it. The option type is unchanged: it
stays an optional `string`, so a computed value still compiles.
