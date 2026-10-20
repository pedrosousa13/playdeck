// @vitest-environment node
//
// No DOM, for the same reason eager-video-ssr.test.tsx gives for its own
// `node` environment: `renderToString` needs none of it, and `priority`'s
// server-side claims -- the `<link rel="preload">` hint and the poster
// `<img>`'s own attributes -- are false the moment rendering them needs a
// `window`.
//
// Demonstrated red: run with `packages/react/src` reverted to the commit
// before this one (`priority` not yet a prop `Root` reads at all), 6 of the 8
// tests below failed --
//
//   expected '<div data-playdeck-part="viewport"…' to contain '<link
//   rel="preload" href="https://exa…'
//
// for the first ("renders a preload link…", where no explicit call means no
// link with `fetchPriority` at all -- React's own automatic `<img>`
// preloading, confirmed by the two tests this file does not expect to fail,
// still emits a bare one), and the same shape for the srcSet/sizes,
// explicit-field, video-`preload` and refused-URL tests -- each missing
// `fetchPriority`, `<video`, or the explicit override, because nothing yet
// read `priority` at all. Restored once `root.tsx` read `priority` and
// resolved `loading`/`preload`/the poster default from it.

import { renderToString } from 'react-dom/server';
import { expect, test } from 'vitest';
import * as Player from '../src/index';

const fixture = (props: Partial<Omit<Player.RootProps, 'children'>> = {}) => (
  <Player.Root priority source="/tracer.mp4" {...props}>
    <Player.Viewport>
      <Player.Media />
      <Player.Poster />
    </Player.Viewport>
  </Player.Root>
);

test('priority renders a preload link and a high-priority, eager poster image', () => {
  const markup = renderToString(
    fixture({ poster: 'https://example.com/poster.jpg' })
  );

  expect(markup).toContain(
    '<link rel="preload" href="https://example.com/poster.jpg" as="image" fetchPriority="high"'
  );
  expect(markup).toContain('data-playdeck-part="poster-image"');
  expect(markup).toContain('fetchPriority="high"');
  expect(markup).toContain('loading="eager"');
});

test('priority carries the resolved srcSet and sizes onto the preload link as imageSrcSet/imageSizes', () => {
  const markup = renderToString(
    fixture({
      poster: {
        src: 'https://example.com/a.jpg',
        srcSet: 'https://example.com/a.jpg 1x, https://example.com/b.jpg 2x',
        sizes: '100vw'
      }
    })
  );

  // `rel="preload"`/`imageSrcSet` alone would also pass on an `<img>` with no
  // `priority` at all -- React's own automatic image preloading carries
  // `srcSet`/`sizes` onto a bare `<img>`'s link the same way (see the
  // byte-identical test below). `fetchPriority="high"` is the one part of
  // this link only `priority` adds, so it is what this test turns on.
  expect(markup).toContain('rel="preload"');
  expect(markup).toContain('fetchPriority="high"');
  expect(markup).toContain(
    'imageSrcSet="https://example.com/a.jpg 1x, https://example.com/b.jpg 2x"'
  );
  expect(markup).toContain('imageSizes="100vw"');
});

// A `ResponsivePoster` that already names its own `fetchPriority`/`loading`
// keeps them: `priority` fills in a default, and does not override a value
// the consumer set. The preload link's own `fetchPriority` is unaffected --
// it is Root's own hint, not a mirror of the poster's displayed priority.
test('an explicit fetchPriority or loading on the poster is not overridden', () => {
  const markup = renderToString(
    fixture({
      poster: {
        src: 'https://example.com/a.jpg',
        fetchPriority: 'low',
        loading: 'lazy'
      }
    })
  );

  expect(markup).toContain('fetchPriority="low"');
  expect(markup).toContain('loading="lazy"');
  // The poster image itself, not the preload link beside it (which always
  // asks for high priority, below) -- the two attributes travel together on
  // the real `<img>` React emits for `PosterImage`.
  expect(markup).toContain(
    'data-state="loading" fetchPriority="low" loading="lazy"'
  );
  expect(markup).toContain(
    '<link rel="preload" href="https://example.com/a.jpg" as="image" fetchPriority="high"'
  );
});

test('priority resolves preload to auto for a video file source', () => {
  const markup = renderToString(fixture());

  expect(markup).toContain('<video');
  expect(markup).toContain('preload="auto"');
});

test('an explicit preload still wins over priority', () => {
  const markup = renderToString(fixture({ preload: 'none' }));

  expect(markup).toContain('<video');
  expect(markup).toContain('preload="none"');
  expect(markup).not.toContain('preload="auto"');
});

// Paired with the positive cases above rather than asserted alone: a refused
// poster URL producing no link also holds, vacuously, on code that has no
// preload link at all -- demonstrated-red.md's "reads a default as a result"
// trap. The other tests in this file are what rule that reading out here.
//
// Demonstrated red by a substitute mutation (docs/agents/demonstrated-red.md):
// with `root.tsx`'s `posterPreloadHref` temporarily computed as
// `defaultPoster.src` directly (the `permittedUrl` call removed), this
// failed --
//
//   expected '<link rel="preload" href="javascript:throw new Error(...)"…'
//   not to contain 'rel="preload"'
//
// (a real preload link reached the server HTML, its `href` React's own
// separate `javascript:` neutralisation rewrote rather than this package's
// own allowlist refusing it) -- reverted once `permittedUrl` was restored.
test('a refused poster URL produces no preload link', () => {
  const markup = renderToString(fixture({ poster: 'javascript:alert(1)' }));

  expect(markup).not.toContain('rel="preload"');
  // Still prioritised -- the refusal is of the URL, not of the hint.
  expect(markup).toContain('fetchPriority="high"');
});

// `poster: 'provider'` resolves to a URL only once a provider still arrives,
// which `renderToString` never runs long enough to see -- so this is the one
// surface `priority` has nothing to hint yet, the same way `Player.Poster`
// itself renders no default image for it (root.tsx's own `defaultPoster`
// comment).
test('an unresolved provider poster produces no preload link', () => {
  const markup = renderToString(
    fixture({
      poster: 'provider',
      source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    })
  );

  expect(markup).not.toContain('rel="preload"');
});

// Without `priority`, neither poster attribute default applies, and `Root`
// itself calls `preload()` for neither. React's own server renderer still
// emits a bare `<link rel="preload" as="image">` for the plain `<img>`
// `PosterImage` always renders -- its own automatic image preloading,
// present with or without this feature and unrelated to it -- so this checks
// what `priority` changes rather than asserting no link of any kind exists.
test('without priority, no poster priority defaults appear', () => {
  const markup = renderToString(
    <Player.Root loading="eager" poster="/poster.jpg" source="/tracer.mp4">
      <Player.Viewport>
        <Player.Media />
        <Player.Poster />
      </Player.Viewport>
    </Player.Root>
  );

  expect(markup).not.toContain('fetchPriority');
  expect(markup).not.toContain('loading="eager"');
  expect(markup).toContain('preload="metadata"');
});
