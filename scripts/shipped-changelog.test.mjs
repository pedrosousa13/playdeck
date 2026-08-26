import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { changelogProblems, shippedChangelog } from './shipped-changelog.mjs';
import { publishablePackages } from './workspace-packages.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Packs one workspace package and answers with the path of the tarball.
 *
 * Each package is packed into a directory of its own so the tarball can be
 * found by reading that directory back. The alternative is to rebuild the name
 * npm gives a tarball -- scope stripped, `/` folded to `-`, version appended --
 * and a rule restated in a test is a rule that can drift away from the one npm
 * actually applies.
 * @param {{ name: string }} pkg
 * @param {string} into
 */
const pack = (pkg, into) => {
  mkdirSync(into, { recursive: true });
  execFileSync(
    'pnpm',
    ['--filter', pkg.name, 'pack', '--pack-destination', into],
    { cwd: repoRoot, stdio: 'pipe' }
  );
  const [tarball] = readdirSync(into);
  return join(into, tarball);
};

// The acceptance criterion of #460, run against the bytes a consumer receives
// rather than against the `files` field that is supposed to produce them. It
// packs every publishable package rather than a list of names, so a new package
// is covered the moment it exists -- the same property scripts/audit.mjs and
// scripts/verify-packaging.mjs get from `publishablePackages`.
//
// A build is deliberately not run first. `pnpm pack` includes whatever `dist`
// holds and does not care whether it is fresh, and nothing this test asserts is
// in `dist`, so requiring a build here would buy nothing and cost a minute.
// scripts/verify-packaging.mjs is where the same rule runs against a built,
// linted tarball.
test('every publishable package ships a changelog naming the version it carries', (t) => {
  const packed = mkdtempSync(join(tmpdir(), 'playdeck-shipped-changelog-'));
  t.after(() => rmSync(packed, { recursive: true, force: true }));

  /** @type {string[]} */
  const problems = [];
  for (const pkg of publishablePackages(repoRoot)) {
    const tarball = pack(pkg, join(packed, pkg.name.replace('/', '-')));
    problems.push(
      ...changelogProblems(shippedChangelog(tarball), pkg.version).map(
        (problem) => `${pkg.name} ${problem}`
      )
    );
  }
  assert.deepEqual(problems, []);
});

test('accepts a changelog whose headings name the version being packed', () => {
  assert.deepEqual(
    changelogProblems(
      '# @playdeck/core\n\n## 0.2.0\n\n### Minor Changes\n\n- ecfef8b: A thing.\n',
      '0.2.0'
    ),
    []
  );
});

test('reports a tarball that carries no changelog at all', () => {
  assert.deepEqual(changelogProblems(undefined, '0.2.0'), [
    'ships no CHANGELOG.md, so an installed copy says nothing about what changed'
  ]);
});

test('reports a changelog that stops short of the version being packed', () => {
  assert.deepEqual(
    changelogProblems('# @playdeck/core\n\n## 0.1.1\n\n- older.\n', '0.2.0'),
    [
      'ships a CHANGELOG.md with no `## 0.2.0` heading, so the version installed is not the version it describes'
    ]
  );
});

// The version has to be found as a heading and not merely as text, because
// prose mentioning a version is exactly what a changelog is full of: the entry
// for 0.2.0 discusses 0.1.1 throughout without describing it. A rule that
// searched the whole document would pass a changelog that had never been
// regenerated for this release.
test('does not accept a version that appears only in prose', () => {
  assert.deepEqual(
    changelogProblems(
      '# @playdeck/core\n\n## 0.1.1\n\n- 0.2.0 will remove this.\n',
      '0.2.0'
    ).length,
    1
  );
});

// `0.2.1` is a prefix of `0.2.10`, and a prerelease carries the release it
// leads to as a prefix of its own. Both are versions this repository can
// actually reach -- `prerelease:enter` is a root script -- so the match is
// anchored at both ends rather than at the start alone.
test('does not read the version out of a longer one', () => {
  assert.equal(
    changelogProblems('## 0.2.10\n\n- a later patch.\n', '0.2.1').length,
    1
  );
  assert.equal(
    changelogProblems('## 0.3.0-next.0\n\n- a prerelease.\n', '0.3.0').length,
    1
  );
  assert.deepEqual(
    changelogProblems('## 0.3.0-next.0\n\n- a prerelease.\n', '0.3.0-next.0'),
    []
  );
});
