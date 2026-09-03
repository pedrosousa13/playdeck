import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { fixturePaths, storyFixtureProblems } from './story-fixtures.mjs';

// The fixtures the cases below address, as the set the rule takes: the paths
// under apps/storybook/public relative to it. Written out here rather than read
// off the repository, because what is under test is the judgement and not
// today's fixture tree -- the last test in this file is the one that holds the
// rule against the real one.
const fixtures = new Set(['tracer.mp4', 'poster.svg', 'hls/master.m3u8']);

test('reports a root-absolute literal naming a fixture', () => {
  assert.deepEqual(
    storyFixtureProblems('<Player.Root source="/tracer.mp4" />\n', fixtures),
    [{ line: 1, path: '/tracer.mp4' }]
  );
});

test('reports one in a nested fixture directory, on the line it sits on', () => {
  assert.deepEqual(
    storyFixtureProblems(
      "const a = 1;\nconst src = '/hls/master.m3u8';\n",
      fixtures
    ),
    [{ line: 2, path: '/hls/master.m3u8' }]
  );
});

// The form the rule exists to keep: the fixture named as a bare path and
// resolved against the workbench's own base path.
test('leaves a fixture addressed through assetUrl alone', () => {
  assert.deepEqual(
    storyFixtureProblems("<img src={assetUrl('poster.svg')} />\n", fixtures),
    []
  );
});

// The scoping, and the half of the rule with no visible effect when it is
// working. stories/poster-image.stories.tsx addresses
// `/__playdeck__/pending.png` and `/__playdeck__/missing-poster.png` on
// purpose: they are stories about a poster that never loads, and the URLs are
// meant not to resolve. Nothing under public/ answers them, so they are not
// this defect and must not be flagged. A rule that fired on every
// root-absolute literal would still pass every other assertion in this file.
test('leaves a root-absolute literal that names no fixture alone', () => {
  assert.deepEqual(
    storyFixtureProblems(
      '<Player.PosterImage src="/__playdeck__/pending.png" />\n',
      fixtures
    ),
    []
  );
});

// Comments are where this repository writes down why the resolver exists, and
// stories/asset-url.ts's own doc comment names `/tracer.mp4` as the literal
// not to write. A scan that read comments would fail on the file that
// documents the rule.
test('reads no literal out of a comment', () => {
  assert.deepEqual(
    storyFixtureProblems(
      '// a literal "/tracer.mp4" resolves outside the workbench\n/* or `/tracer.mp4` in a block */\n',
      fixtures
    ),
    []
  );
});

// A template literal is a string the same way, and a query or a fragment names
// the same file -- so neither is a way to write the defect that the rule reads
// as something else.
test('reports one in a template literal, and past a query or fragment', () => {
  assert.deepEqual(
    storyFixtureProblems('const src = `/tracer.mp4`;\n', fixtures),
    [{ line: 1, path: '/tracer.mp4' }]
  );
  assert.deepEqual(
    storyFixtureProblems('const src = "/tracer.mp4?t=2#top";\n', fixtures),
    [{ line: 1, path: '/tracer.mp4' }]
  );
});

// A relative literal is not the defect: it resolves against the page it is
// served from rather than against the origin, and it is not what #435 was
// about.
test('leaves a relative literal alone', () => {
  assert.deepEqual(
    storyFixtureProblems('const src = "tracer.mp4";\n', fixtures),
    []
  );
});

// The rule scopes itself against a set read off the filesystem, which is what
// makes it silently disableable: point the reader at a directory that holds no
// fixtures and every case above still passes while no story is checked at all.
// So this asserts the reader finds the fixtures the stories actually address,
// not only that nothing it found is wrong.
test('the fixture reader finds what the stories address', () => {
  const paths = fixturePaths(
    fileURLToPath(new URL('../apps/storybook/public', import.meta.url))
  );
  assert.ok(paths.has('tracer.mp4'));
  assert.ok(paths.has('hls/master.m3u8'));
});
