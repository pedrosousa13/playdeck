// @vitest-environment node
//
// No DOM, for the same reason eager-video-ssr.test.tsx gives for its own
// `node` environment: `renderToString` needs none of it, and `priority`'s
// server-side claims -- the `<link rel="preload">` hint and the poster
// `<img>`'s own attributes -- are false the moment rendering them needs a
// `window`.
//
// `root.tsx` renders this hint as a plain `<link>` element rather than
// calling `react-dom`'s own `preload()`: React 19 hoists a rendered `<link>`
// into `<head>` on its own (server and client alike), so the explicit call
// bought nothing but a `react-dom` import every consumer paid for whether or
// not they ever set `priority`. One side effect of the plain-element route:
// React's own automatic image preloading (triggered by any `<img src>` whose
// `fetchPriority` is not `'low'`) is a *separate* mechanism from the one the
// imperative `preload()` call would have deduped against, so a poster whose
// `<img>` ends up `fetchPriority="high"` gets two preload links in the
// server HTML -- one automatic (carrying a `referrerPolicy` attribute,
// `PosterImage`'s own default), one this file's own `<link>`. Several
// assertions below pin that rather than assume it away.
//
// Demonstrated red: run with `packages/react/src` reverted to the commit
// before this one (`priority` not yet a prop `Root` reads at all), the
// assertions naming `fetchPriority`, an explicit override, `preload="auto"`
// or `imageSrcSet`/`imageSizes` together with `fetchPriority="high"` failed
// across every test below that sets `priority` -- e.g. for the first test,
//
//   expected '<link rel="preload" as="image" href="…' to contain
//   'fetchPriority="high"'
//
// (React's own automatic link was there -- the bare `<img>` still got one --
// but carried no `fetchPriority`, since nothing yet read `priority` to put
// one on the image or render a second link). Restored once `root.tsx` read
// `priority` and resolved `loading`/`preload`/the poster default from it.

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

// This file's own `<link>`, exactly as `root.tsx` writes its JSX attributes
// -- distinguishes it from React's automatic one, which always carries
// `referrerPolicy` and never `rel`/`as` in this order.
const ownLinkCount = (markup: string): number =>
  (
    markup.match(/<link as="image" fetchPriority="high"[^>]*rel="preload"/g) ??
    []
  ).length;

test('priority renders a preload link and a high-priority, eager poster image', () => {
  const markup = renderToString(
    fixture({ poster: 'https://example.com/poster.jpg' })
  );

  expect(markup).toContain(
    '<link as="image" fetchPriority="high" href="https://example.com/poster.jpg" rel="preload"'
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

  expect(markup).toContain(
    '<link as="image" fetchPriority="high" href="https://example.com/a.jpg" imageSizes="100vw" imageSrcSet="https://example.com/a.jpg 1x, https://example.com/b.jpg 2x" rel="preload"'
  );
});

// A `ResponsivePoster` that already names its own `fetchPriority`/`loading`
// keeps them: `priority` fills in a default, and does not override a value
// the consumer set. The preload link's own `fetchPriority` is unaffected --
// it is Root's own hint, not a mirror of the poster's displayed priority.
//
// Also the one case in this file where React's automatic image preloading
// does not add a second link: it declines to preload an `<img>` whose own
// `fetchPriority` is `'low'` (confirmed directly against `react-dom`'s
// server renderer), which is exactly what this poster sets. So this markup
// carries exactly the one link below, not two.
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
  // asks for high priority) -- the two attributes travel together on the
  // real `<img>` React emits for `PosterImage`.
  expect(markup).toContain(
    'data-state="loading" fetchPriority="low" loading="lazy"'
  );
  expect(markup).toContain(
    '<link as="image" fetchPriority="high" href="https://example.com/a.jpg" rel="preload"'
  );
  expect(ownLinkCount(markup)).toBe(1);
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

// A YouTube source and an HLS source render no native `<video>` at all, but
// the poster is `Root`'s own concern, resolved from its `poster` prop
// regardless of which provider the source detects -- so `priority` still
// prioritises it, source type aside.
test.each([
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['hls', '/stream.m3u8']
] as const)(
  'priority prioritises the poster for a %s source',
  (_label, source) => {
    const markup = renderToString(
      fixture({ poster: 'https://example.com/embed-poster.jpg', source })
    );

    expect(markup).toContain(
      '<link as="image" fetchPriority="high" href="https://example.com/embed-poster.jpg" rel="preload"'
    );
    expect(markup).toContain('data-playdeck-part="poster-image"');
    expect(markup).toContain('fetchPriority="high"');
    expect(markup).toContain('loading="eager"');
  }
);

// Two players sharing one poster: `priority` renders one `<link>` per
// player, and React dedupes only a `<link rel="stylesheet">` by its own
// `precedence` mechanism -- never a preload -- so two identical links reach
// the server HTML. Named in the `priority` JSDoc as the reason to set it on
// one player, not a bug this package works around: pinned here rather than
// assumed away.
test('two priority players sharing a poster each render their own preload link', () => {
  const markup = renderToString(
    <>
      {fixture({ poster: 'https://example.com/shared.jpg' })}
      {fixture({ poster: 'https://example.com/shared.jpg' })}
    </>
  );

  expect(ownLinkCount(markup)).toBe(2);
});

// Paired with the positive cases above rather than asserted alone: a refused
// poster URL producing no link also holds, vacuously, on code that has no
// preload link at all -- demonstrated-red.md's "reads a default as a result"
// trap. The other tests in this file are what rule that reading out here.
//
// Demonstrated red by a substitute mutation (docs/agents/demonstrated-red.md):
// with `root.tsx`'s `posterPreloadHref` temporarily computed as
// `prioritizedPoster && prioritizedPoster.src` (the `permittedUrl` call
// removed), this failed --
//
//   expected '<link as="image" fetchPriority="high" href="javascript:throw
//   new Error(...)"…' not to contain 'rel="preload"'
//
// (this file's own link reached the server HTML with a `javascript:` href,
// React's own separate neutralisation rewriting it rather than this
// package's allowlist refusing it) -- reverted once `permittedUrl` was
// restored.
test('a refused poster URL produces no preload link', () => {
  const markup = renderToString(fixture({ poster: 'javascript:alert(1)' }));

  expect(ownLinkCount(markup)).toBe(0);
  // Still prioritised -- the refusal is of the URL, not of the hint.
  expect(markup).toContain('fetchPriority="high"');
});

// The shared allowlist refuses an `http:`/`https:` poster whose remainder is
// not `//` the same way it refuses `javascript:` above, so neither string
// ever reaches the server HTML -- not in the preload link's `href` and not
// on the poster `<img>` itself.
test.each(['http:evil.com/x', 'https:evil.com/x'])(
  'a poster URL whose scheme is not followed by // never reaches server HTML (%s)',
  (poster) => {
    const markup = renderToString(fixture({ poster }));

    expect(ownLinkCount(markup)).toBe(0);
    expect(markup).not.toContain('evil.com');
    expect(markup).toContain('fetchPriority="high"');
  }
);

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

  expect(ownLinkCount(markup)).toBe(0);
});

// Without `priority`, neither poster attribute default applies, and `Root`
// renders no `<link>` of its own. React's own server renderer still emits a
// bare `<link rel="preload" as="image">` for the plain `<img>`
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
  expect(ownLinkCount(markup)).toBe(0);
});
