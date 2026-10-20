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

// #911 AC: no `autoplay` attribute in server HTML, with or without `autoplay`
// set on `Root` -- `EXCLUDED_MEDIA_PROPS` (`viewport-media.tsx`) already
// excludes both `muted` and `autoPlay` from JSX passthrough, and `Root` sets
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
