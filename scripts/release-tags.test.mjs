import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  releaseTag,
  remoteTagNames,
  tagPlan,
  tagRelease,
  uncommittedPaths
} from './release-tags.mjs';

test('names a tag the way changesets names one', () => {
  assert.equal(
    releaseTag({ name: '@playdeck/core', version: '0.2.0' }),
    '@playdeck/core@0.2.0'
  );
});

// A remote carrying no tags at all is not an error: `git ls-remote --tags
// origin` answers with nothing and exits 0. Splitting an empty string on
// newlines yields one empty element, and a set holding '' would make every
// `has` check against a real tag name still fail but would make the count this
// script reports wrong.
test('reads no tags out of an empty ls-remote', () => {
  assert.deepEqual([...remoteTagNames('')], []);
  assert.deepEqual([...remoteTagNames('\n')], []);
});

// An annotated tag -- which is what changesets creates, deliberately, so that
// `git push --follow-tags` carries it -- appears twice in `ls-remote` output:
// once as the tag object and once peeled to the commit, suffixed `^{}`. Both
// name the same tag, and a plain `push` of a name that is already on the remote
// under a different sha is rejected rather than moved, so reading the peeled
// line as a tag of its own would make the plan claim work that does not exist.
test('collapses the peeled ref an annotated tag adds', () => {
  assert.deepEqual(
    [
      ...remoteTagNames(
        [
          '9d3f1a0\trefs/tags/@playdeck/core@0.2.0',
          'ab12cd3\trefs/tags/@playdeck/core@0.2.0^{}',
          '77aa11b\trefs/tags/@playdeck/provider-hls@0.1.1'
        ].join('\n')
      )
    ].sort(),
    ['@playdeck/core@0.2.0', '@playdeck/provider-hls@0.1.1']
  );
});

// The acceptance criterion #460 states as "packages that move to different
// versions in one release are each identifiable". A single repo-wide tag names
// one version, so it cannot name a tree whose packages sit at two.
test('names every package at its own version', () => {
  const { toPush } = tagPlan({
    packages: [
      { name: '@playdeck/core', version: '0.2.0' },
      { name: '@playdeck/provider-hls', version: '0.1.1' }
    ],
    localTags: new Set([
      '@playdeck/core@0.2.0',
      '@playdeck/provider-hls@0.1.1'
    ]),
    remoteTags: new Set()
  });
  assert.deepEqual(toPush, [
    '@playdeck/core@0.2.0',
    '@playdeck/provider-hls@0.1.1'
  ]);
});

test('pushes nothing when the remote already carries every tag', () => {
  assert.deepEqual(
    tagPlan({
      packages: [{ name: '@playdeck/core', version: '0.2.0' }],
      localTags: new Set(),
      remoteTags: new Set(['@playdeck/core@0.2.0'])
    }),
    { toPush: [], unaccounted: [] }
  );
});

// Why a required tag existing in neither place has to be reported rather than
// skipped is `tagPlan`'s own doc comment in scripts/release-tags.mjs, which
// names the @changesets/git behaviour it compensates for. Stated there once: a
// changesets upgrade that falsifies it should have one comment to correct, not
// two that drift apart.
test('reports a required tag that exists in neither place', () => {
  assert.deepEqual(
    tagPlan({
      packages: [{ name: '@playdeck/core', version: '0.2.0' }],
      localTags: new Set(),
      remoteTags: new Set()
    }),
    { toPush: [], unaccounted: ['@playdeck/core@0.2.0'] }
  );
});

test('reads the paths out of git status porcelain output', () => {
  assert.deepEqual(uncommittedPaths(''), []);
  assert.deepEqual(
    uncommittedPaths(' M packages/core/package.json\n?? packages/new/x.json\n'),
    ['packages/core/package.json', 'packages/new/x.json']
  );
});

/**
 * A throwaway workspace with a bare repository standing in for `origin`, two
 * publishable packages at different versions, and the changesets configuration
 * this repository uses. Everything `tagRelease` touches is real: real git, real
 * `changeset tag`, real `pnpm list -r`. Nothing leaves the machine -- `origin`
 * is a path on disk, which is what lets `git ls-remote` answer offline.
 * @param {import('node:test').TestContext} t
 */
const fixtureWorkspace = (t) => {
  const work = mkdtempSync(join(tmpdir(), 'playdeck-release-tags-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const origin = join(work, 'origin.git');
  const repo = join(work, 'repo');

  /**
   * @param {readonly string[]} args
   * @param {string} [cwd]
   */
  const git = (args, cwd = repo) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' });

  /**
   * @param {string} path
   * @param {unknown} value
   */
  const writeJson = (path, value) => {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), `${JSON.stringify(value, null, 2)}\n`);
  };

  execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
  mkdirSync(repo, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'user.name', 'Fixture']);

  writeJson('package.json', { name: 'tag-fixture', private: true });
  writeFileSync(
    join(repo, 'pnpm-workspace.yaml'),
    "packages:\n  - 'packages/*'\n"
  );
  writeJson('.changeset/config.json', {
    changelog: '@changesets/cli/changelog',
    commit: false,
    fixed: [],
    linked: [],
    access: 'public',
    baseBranch: 'main',
    updateInternalDependencies: 'patch',
    ignore: []
  });
  writeJson('packages/alpha/package.json', {
    name: '@tag-fixture/alpha',
    version: '1.0.0'
  });
  writeJson('packages/beta/package.json', {
    name: '@tag-fixture/beta',
    version: '2.3.4'
  });

  git(['add', '-A']);
  git(['commit', '-m', 'fixture']);
  git(['remote', 'add', 'origin', origin]);
  git(['push', 'origin', 'main']);

  return {
    repo,
    git,
    /** Every tag name the bare repository standing in for `origin` carries. */
    originTags: () =>
      [...remoteTagNames(git(['ls-remote', '--tags', 'origin']))].sort()
  };
};

// The two criteria that only an end-to-end run can answer: a version reaches a
// tag *on the remote*, and running the same thing twice is a no-op rather than
// a failure or a duplicate. Both halves of the second one are load-bearing --
// `changeset tag` skips a tag it finds, and the plan pushes only what the
// remote lacks -- and neither is visible from the pure functions above.
test('puts a tag per package on the remote, and repeats without complaint', (t) => {
  const { repo, originTags } = fixtureWorkspace(t);

  assert.deepEqual(originTags(), []);
  assert.deepEqual(tagRelease({ repoRoot: repo }).sort(), [
    '@tag-fixture/alpha@1.0.0',
    '@tag-fixture/beta@2.3.4'
  ]);
  assert.deepEqual(originTags(), [
    '@tag-fixture/alpha@1.0.0',
    '@tag-fixture/beta@2.3.4'
  ]);

  assert.deepEqual(tagRelease({ repoRoot: repo }), []);
  assert.deepEqual(originTags(), [
    '@tag-fixture/alpha@1.0.0',
    '@tag-fixture/beta@2.3.4'
  ]);
});

// `changeset tag` tags HEAD, and a bump that has not been committed is not at
// HEAD. Running this straight after `pnpm version:packages` -- the mistake two
// scripts sitting next to each other invites, and one the `--list` output
// names the second of -- would push a tag onto a commit carrying the version
// before it. A tag already on the remote is not something this repository can
// take back quietly, so this refuses rather than tagging what is there.
test('refuses to tag a version that is not committed yet', (t) => {
  const { repo, originTags } = fixtureWorkspace(t);
  writeFileSync(
    join(repo, 'packages/alpha/package.json'),
    `${JSON.stringify({ name: '@tag-fixture/alpha', version: '1.1.0' }, null, 2)}\n`
  );

  assert.throws(
    () => tagRelease({ repoRoot: repo }),
    /packages\/alpha\/package\.json/
  );
  assert.deepEqual(originTags(), []);
});

// Committing the bump is not enough: `git push origin refs/tags/<tag>` carries
// the objects the tag needs, so pushing a tag from a `main` that is ahead of
// the remote would put a published version's tag on a commit no branch on the
// remote reaches. The version would be tagged and the code behind it would not
// be on `main` -- and a tag on the remote is not something this repository can
// take back quietly.
test('refuses to tag a commit the remote does not carry', (t) => {
  const { repo, git, originTags } = fixtureWorkspace(t);
  writeFileSync(
    join(repo, 'packages/alpha/package.json'),
    `${JSON.stringify({ name: '@tag-fixture/alpha', version: '1.1.0' }, null, 2)}\n`
  );
  git(['commit', '-am', 'bump alpha']);

  assert.throws(() => tagRelease({ repoRoot: repo }), /origin\/main/);
  assert.deepEqual(originTags(), []);
});
