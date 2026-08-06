---
'@reely/provider-wistia': patch
---

The Wistia provider now checks `playerColor` and `poster` where it turns an
option into an attribute, rather than writing either verbatim onto
`<wistia-player>`. A `playerColor` is kept only if it is a hex colour (three or
six digits, hash optional) and a `poster` only if it parses as an `https:` URL;
`http:`, `data:`, relative and unparseable values are dropped. A dropped value
sets no attribute, which is the same element state as omitting the option, and
the drop is silent — one bad presentation option must not fail playback. The
option types are unchanged: both stay optional `string`, so a computed value
still compiles.
