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

// The defect the hand-rolled scanner this replaced could not see: an
// apostrophe in JSX text is prose, not a string opener, and reading it as one
// desynced everything after it -- so a genuine bypass further down the file
// went unreported and the gate silently stopped gating. Today's stories are
// one line of copy away from that, which is why the parser is TypeScript's.
test('reports a bypass that follows an apostrophe in JSX text', () => {
  assert.deepEqual(
    storyFixtureProblems(
      '<p>it\'s a fixture</p>\n<img src="/tracer.mp4" />\n',
      fixtures
    ),
    [{ line: 2, path: '/tracer.mp4' }]
  );
});

// The same class as the apostrophe, and it was live: a quote inside a regular
// expression opened a phantom string for the scanner this replaced, and
// stories/parts.contract.test.ts:46 is
// `/data-playdeck-part="([^"]+)"/g` -- so everything after that line in that
// file went unread. To a parser a regular expression is a node and not a
// string, and the text inside it is never a candidate path.
test('reports a bypass that follows a regular expression holding a quote', () => {
  assert.deepEqual(
    storyFixtureProblems(
      'const part = /data-playdeck-part="([^"]+)"/g;\nconst src = "/tracer.mp4";\n',
      fixtures
    ),
    [{ line: 2, path: '/tracer.mp4' }]
  );
});

// A fixture is addressed in more shapes than a bare `src`, and the issue that
// asked for this check named `url()` among them. `srcSet` is not hypothetical
// either: player-fixture.stories.tsx already writes a descriptor-bearing one
// through the resolver, so the bypass form of that exact line has to be
// visible here. A descriptor list is read candidate by candidate, each up to
// its first space, and the same fixture named twice in one literal is one
// finding.
test('reports a fixture inside a srcSet descriptor list', () => {
  assert.deepEqual(
    storyFixtureProblems(
      '<img srcSet="/poster.svg 640w, /poster.svg 1280w" />\n',
      fixtures
    ),
    [{ line: 1, path: '/poster.svg' }]
  );
});

test('reports a fixture inside url(), quoted or bare', () => {
  assert.deepEqual(
    storyFixtureProblems(
      'const css = `background: url(/poster.svg)`;\n',
      fixtures
    ),
    [{ line: 1, path: '/poster.svg' }]
  );
  assert.deepEqual(
    storyFixtureProblems(
      '<div style={{ background: "url(\'/poster.svg\')" }} />\n',
      fixtures
    ),
    [{ line: 1, path: '/poster.svg' }]
  );
});

// A template with a hole is several literal chunks, and a bypass in any of
// them sits on its own line. The interpolated part is an expression rather
// than text, so nothing inside `${...}` is read as a path.
test('reports a bypass in an interpolated template, on its own line', () => {
  assert.deepEqual(
    storyFixtureProblems(
      'const css = `\n  background: url(${a});\n  mask: url(/poster.svg);\n`;\n',
      fixtures
    ),
    [{ line: 3, path: '/poster.svg' }]
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
