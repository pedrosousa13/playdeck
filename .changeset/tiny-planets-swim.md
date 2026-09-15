---
'@playdeck/react': minor
---

Add a no-build entry, `@playdeck/react/browser`

Issue #448's second deliverable: a build a consumer loads from a plain HTML
page with a `<script type="module">` tag, no bundler and no package manager.
Nothing about the default `.` entry changes — its resolution, its tree-shaking
and its budget are all still what `pnpm test:bundle` and `pnpm test:budgets`
measured before this landed.

React 19 ships no UMD and no ESM build — `react`'s own `exports` carries only
a CommonJS `default` condition, so there is no script-tag-loadable React for
an import map to point at. `./browser` is therefore the one entry in this
package that bundles React, ReactDOM and the JSX runtime rather than leaving
them external, re-exporting `createElement` and `createRoot` alongside the
usual primitives so a page with nothing but a `<script>` tag can build a tree
with no JSX and mount it.

Only the native provider ships in this bundle. HLS, YouTube, Vimeo and Wistia
stay external, exactly as they are for the default entry: carrying every
provider would have put hls.js and `@vimeo/player` inside this package's own
tarball, downloaded by every consumer whether or not they load this entry, and
would have misrepresented the library's size to exactly the audience this
entry exists for. A source that needs one of the four fails at the point of
use with an unresolved import — an honest limitation, not a silent one.

Measured (gzip): `browser.js` 87.63 KB, the `@playdeck/core` chunk it shares
with the native provider 8.50 KB, the native provider itself 6.43 KB —
budgeted in `scripts/bundle-budgets.mjs`, alongside the default entry's own
figures. `tests/bundle/no-build/test.mjs` drives a real Chromium page over
this exact artifact — served with no build step of its own — and plays an MP4
end to end, while asserting that no HLS, YouTube, Vimeo or Wistia code is ever
requested.
