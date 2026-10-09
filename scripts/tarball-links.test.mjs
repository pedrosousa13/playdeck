import assert from 'node:assert/strict';
import test from 'node:test';
import { linkTargets, unreachableLinks } from './tarball-links.mjs';

test('reads inline links, reference definitions and HTML attributes', () => {
  assert.deepEqual(
    linkTargets(
      [
        'See [a](./a.md) and [b][b].',
        '',
        '[b]: https://example.com/b',
        '',
        '<img src="assets/c.png">'
      ].join('\n')
    ),
    ['./a.md', 'https://example.com/b', 'assets/c.png']
  );
});

// A GFM footnote definition opens like a reference definition, but its label
// starts with `^` and what follows the colon is the note's text, never a
// destination. `docs/comparison/features.md` writes 192 of them, each opening
// `[^n]: **Feature — Library**: ...`, which reached @playdeck/docs's
// `guides/comparison.md` as "links to **Captions" and the like.
test('a footnote definition is not a link', () => {
  assert.deepEqual(
    linkTargets(
      [
        '| Captions | yes[^1] |',
        '| --- | --- |',
        '',
        '[^1]: **Captions — Playdeck**: yes. Source: packages/react/README.md'
      ].join('\n')
    ),
    []
  );
});

test('a link to a file the tarball does not carry is reported', () => {
  assert.deepEqual(
    unreachableLinks('guides/a.md', 'See [b](./b.md) and [c](../c.md).', [
      'guides/b.md',
      'c.md'
    ]),
    []
  );
  assert.deepEqual(
    unreachableLinks('guides/a.md', 'See [gone](./gone.md).', ['guides/a.md']),
    ['guides/a.md links to ./gone.md, which is not in the tarball']
  );
});

// A code span is text, so markup quoted in one is not a link. The comparison
// method quotes `<ReactPlayer src="…mp4" controls />` across a line break.
test('a code span is not read for links, across a line break too', () => {
  assert.deepEqual(
    linkTargets(
      [
        'It renders `<ReactPlayer',
        'src="…mp4" controls />` and `[x](y.md)`, and [z](z.md).'
      ].join('\n')
    ),
    ['z.md']
  );
});
