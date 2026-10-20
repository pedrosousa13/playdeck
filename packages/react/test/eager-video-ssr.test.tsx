// @vitest-environment node
//
// No DOM at all, deliberately -- the same reason youtube-poster-ssr.test.tsx
// gives for its own `node` environment: `renderToString` needs none of it,
// and the whole claim under test is false the moment rendering it needs a
// `window`. #911's claim is that `loading="eager"` puts the native `<video>`
// and its `<source>` children in the server HTML for a `video` file source,
// without waiting on an effect -- which this file proves for real rather
// than alongside a DOM that happens not to be touched.
//
// Demonstrated red: run against the code as it stood before this commit
// (`sourceCommitted` derived only from `committedIdentity`, which starts
// `undefined` and is set only by the `eager` effect -- an effect
// `renderToString` never runs), the first two assertions below failed:
//
//   expected '<div data-playdeck-part="viewport"…' to contain '<video'
//
// (`markup` contained no `<video` and no `<source` at all -- `Media`
// returned `null`.) Restored once `use-activation.ts`'s `sourceCommitted`
// also reads a render-time commit for `eager` + a successfully detected
// `video` source.

import { renderToString } from 'react-dom/server';
import { expect, test } from 'vitest';
import * as Player from '../src/index';

const fixture = (
  props: Partial<Omit<Player.RootProps, 'children' | 'source'>> = {}
) => (
  <Player.Root source="/tracer.mp4" {...props}>
    <Player.Viewport>
      <Player.Media />
    </Player.Viewport>
  </Player.Root>
);

test('eager loading renders the native video element with its sources in server HTML', () => {
  const markup = renderToString(fixture({ loading: 'eager', preload: 'auto' }));

  expect(markup).toContain('<video');
  expect(markup).toContain('data-playdeck-part="media"');
  expect(markup).toContain('<source');
  expect(markup).toContain('src="/tracer.mp4"');
  expect(markup).toContain('preload="auto"');
});

test.each([['viewport'], ['interaction']] as const)(
  '%s loading still renders no video in server HTML',
  (loading) => {
    const markup = renderToString(fixture({ loading }));

    expect(markup).not.toContain('<video');
  }
);

// No `autoplay` attribute reaches the server HTML, with or without
// `autoplay` set on `Root` -- `EXCLUDED_MEDIA_PROPS` (`viewport-media.tsx`)
// already excludes both `muted` and `autoPlay` from JSX passthrough, and
// `Root` sets
// `muted` imperatively after mount rather than through a JSX prop (React does
// not reliably emit `muted` as a boolean attribute -- facebook/react#10389).
// Paired with the assertion that a real `<video>` is actually there, so this
// is not the vacuous "no video, so no autoplay either" reading that would
// also pass on the unfixed code.
test.each([[false], ['audible']] as const)(
  'renders no autoplay attribute in server HTML regardless of the autoplay prop (%s)',
  (autoplay) => {
    const markup = renderToString(fixture({ autoplay, loading: 'eager' }));

    expect(markup).toContain('<video');
    expect(markup).not.toContain('autoplay');
    expect(markup).not.toContain('autoPlay');
  }
);

// A refused source must never reach the server HTML, the same way
// `permittedUrl`/`isPermittedSourceUrl` already keep one out of every other
// surface this package renders. An explicit `{ type: 'video', sources }`
// object is the one case that exercises `isPermittedSourceUrl` itself rather
// than detectSource's separate, pattern-based refusal of an unrecognized
// bare string (a `javascript:` string is refused on the URL shape alone,
// never reaching the allowlist) -- so this uses that form, with one good
// candidate alongside the refused one. `sourceFromExplicitObject` refuses
// the WHOLE object when any one `sources` candidate fails
// `isPermittedSourceUrl` (its own `.every(...)` check) rather than dropping
// just that candidate, so a mixed valid/refused list is refused outright too
// -- there is no partial render to check for.
//
// Asserted as "no `<video>` at all", not "the refused string is absent":
// React has its own, separate `javascript:` URL neutralization that rewrites
// the attribute value regardless of this package's own allowlist, so a
// literal-string assertion would pass even with `isPermittedSourceUrl`
// bypassed entirely -- measured while demonstrating red below, where a
// string-literal assertion on the same markup already passed under the
// mutation and only the structural one failed.
//
// Demonstrated red by a substitute mutation (docs/agents/demonstrated-red.md):
// with `isPermittedSourceUrl` (`@playdeck/core`'s `source-detection.ts`)
// temporarily replaced with a function that always returns `true`, this
// failed --
//
//   expected '<div data-playdeck-part="viewport" …' not to contain '<video'
//
// -- recorded (markup held a real `<video>` with both `<source>` children),
// then reverted.
test('renders no refused source URL in server HTML under eager loading', () => {
  const markup = renderToString(
    <Player.Root
      loading="eager"
      source={{
        type: 'video',
        sources: [
          { src: '/tracer.mp4', mimeType: 'video/mp4' },
          { src: 'javascript:alert(1)', mimeType: 'video/mp4' }
        ]
      }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  expect(markup).not.toContain('<video');
});
