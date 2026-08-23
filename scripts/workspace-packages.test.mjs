import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import {
  publishableBaseline,
  publishablePackages,
  selectPublishable,
  workspaceProjects
} from './workspace-packages.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Every tracked `package.json`, repository-relative -- the `audit` job's
 * enumeration, matched by the same expression against the index rather than
 * against `main`'s tree. Not one manifest per workspace project: the job takes
 * every manifest there is, because which paths the workspace matches is
 * precisely what the comparison must not let the pull request decide (#373).
 * @returns {string[]}
 */
const trackedManifests = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter((path) => /(^|\/)package\.json$/.test(path));

/**
 * The directory a repository-relative manifest sits in, '' for the root.
 * @param {string} manifest
 */
const directoryOf = (manifest) => manifest.replace(/(^|\/)package\.json$/, '');

/**
 * This repository's tree, reduced to `pnpm-workspace.yaml` and every tracked
 * `package.json` -- no lockfile, no `node_modules`, no sources. That is what
 * the `audit` job's `git archive` of `main` produces, down to the fixture
 * manifests the workspace globs do not match, and reproducing it here rather
 * than describing it is the point: the shape is the CI step's premise, not
 * this test's convenience.
 * @returns {string}
 */
const manifestsOnlyTree = () => {
  const tree = mkdtempSync(join(tmpdir(), 'playdeck-baseline-'));
  cpSync(
    join(repoRoot, 'pnpm-workspace.yaml'),
    join(tree, 'pnpm-workspace.yaml')
  );
  for (const manifest of trackedManifests()) {
    // dirname('package.json') is '.', which joins away to the tree root --
    // where the root manifest belongs.
    mkdirSync(join(tree, dirname(manifest)), { recursive: true });
    cpSync(join(repoRoot, manifest), join(tree, manifest));
  }
  return tree;
};

test('keeps the workspace projects that are not private', () => {
  assert.deepEqual(
    selectPublishable([
      { name: 'playdeck', path: '/w', private: true },
      {
        name: '@playdeck/core',
        version: '0.0.0',
        path: '/w/packages/core',
        private: false
      },
      { name: '@playdeck/storybook', path: '/w/apps/storybook', private: true }
    ]).map((entry) => entry.name),
    ['@playdeck/core']
  );
});

// selectPublishable reads one field of pnpm's output, and both gates that
// depend on it would go quiet rather than red if `pnpm list -r` stopped
// reporting that field. Only a real invocation can catch that, so run one.
test('discovers this workspace with the field the rule turns on', () => {
  const projects = workspaceProjects(repoRoot);
  assert.ok(projects.length > 1);
  for (const project of projects) {
    assert.equal(typeof project.name, 'string', JSON.stringify(project));
    assert.equal(typeof project.private, 'boolean', JSON.stringify(project));
  }
  // The root is a project too, and it is never publishable.
  assert.deepEqual(
    projects.find((project) => project.path === repoRoot.replace(/\/$/, ''))
      ?.private,
    true
  );
  // Every publishable package carries the version npm needs to accept it.
  for (const pkg of selectPublishable(projects)) {
    assert.match(pkg.version, /^\d+\.\d+\.\d+/, pkg.name);
  }
});

// The boundary comparison (#373) computes `main`'s side of it by pointing this
// same discovery at a directory holding `main`'s manifests and nothing else.
// Whether `pnpm list -r` answers at all without a lockfile or an install is a
// property of pnpm, not of this repository, and no other test would notice
// pnpm withdrawing it -- the comparison would simply start throwing in CI, or
// worse, stop finding anything to compare. Same reasoning as the real
// invocation above.
test('discovers a workspace from a tree holding its manifests alone', (t) => {
  const tree = manifestsOnlyTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  assert.deepEqual(
    publishableBaseline(tree)
      .map((pkg) => pkg.name)
      .sort(),
    publishablePackages(repoRoot)
      .map((pkg) => pkg.name)
      .sort()
  );
});

// The other half of the CI step's premise, and the one that makes taking every
// manifest safe: the manifests the workspace globs do not match must be inert
// in the baseline, present in the tree and reported as nothing. If pnpm ever
// discovered a project from a manifest its `packages:` list does not name, the
// baseline would carry names this repository never publishes and the gate
// would report them all as departures on every run.
test('the manifests outside the workspace globs are not projects in it', (t) => {
  const tree = manifestsOnlyTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const projectDirectories = new Set(
    workspaceProjects(repoRoot).map((project) =>
      relative(repoRoot, project.path)
    )
  );
  const outside = trackedManifests().filter(
    (manifest) => !projectDirectories.has(directoryOf(manifest))
  );
  // The six audit fixtures and the packaging one. Pinned rather than merely
  // non-empty: it is the count .github/workflows/ci.yml states when it says
  // the extra manifests are inert, so a new fixture manifest lands on both.
  assert.equal(outside.length, 7, JSON.stringify(outside));
  const discovered = workspaceProjects(tree);
  const names = new Set(discovered.map((project) => project.name));
  for (const manifest of outside) {
    assert.ok(
      existsSync(join(tree, manifest)),
      `${manifest} is not in ${tree}`
    );
    const { name } = JSON.parse(readFileSync(join(tree, manifest), 'utf8'));
    assert.ok(!names.has(name), `${manifest} is a project as ${name}`);
  }
  // And nothing else arrived either: the tree holds seven manifests more than
  // the workspace has projects, and discovery still answers with the projects.
  assert.equal(discovered.length, projectDirectories.size);
});

test('refuses a baseline directory that carries no workspace file', () => {
  // Not pedantry, and not a check pnpm makes for us: `pnpm list -r` run from a
  // directory with no `pnpm-workspace.yaml` searches *upward* for one. Measured
  // against an empty directory inside this repository it returns this
  // repository's own projects. A baseline that failed to materialise would
  // therefore compare the pull request's tree against itself, agree with
  // itself, and report a boundary that had not moved -- the silent skip this
  // whole comparison exists to remove. So an absent baseline throws here
  // rather than resolving to whatever workspace happens to sit above it.
  const empty = mkdtempSync(join(tmpdir(), 'playdeck-baseline-empty-'));
  try {
    assert.throws(
      () => publishableBaseline(empty),
      /baseline.*pnpm-workspace\.yaml/s
    );
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('refuses a listing with nothing publishable in it', () => {
  // An empty result is never a legitimate answer here: it means the discovery
  // command changed shape, and every caller would then silently check nothing.
  assert.throws(
    () => selectPublishable([{ name: 'playdeck', path: '/w', private: true }]),
    /No publishable workspace packages were discovered/
  );
});
