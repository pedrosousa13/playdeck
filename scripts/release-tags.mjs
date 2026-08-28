#!/usr/bin/env node
// Creates the git tag that names each published version, and pushes it. #460 is
// the record of why this exists at all: `git ls-remote --tags origin` answered
// with nothing while seven packages carried published versions, so a consumer
// upgrading between two of them had no commit range to read, and a release that
// failed halfway had nothing to diff against.
//
// **One tag per package, never one for the repository.** These packages version
// independently -- `.changeset/config.json` declares no `fixed` and no `linked`
// group -- so one release can move them to different versions, and a single
// repository-wide `v0.2.0` would name a tree in which some of them are not at
// 0.2.0 at all.
//
// The names are not invented here. `changeset tag` creates them, so the
// vocabulary is changesets' own and follows changesets rather than this file if
// it ever changes. `releaseTag` restates the same rule, but only to decide what
// to push and what to complain about: if the two ever disagreed, every tag
// would come back `unaccounted` below rather than quietly go missing.
//
// **Why this is a step of its own rather than part of `changeset version`.** A
// tag has to point at the commit that carries the version, and under this
// repository's merge strategy that commit does not exist yet when the bump is
// made. Branches arrive squash-merged, so the local bump commit's sha is never
// the sha that lands on `main`. Tagging at `changeset version` time would put
// the tag on a commit `main` never receives. `version:packages` therefore ends
// by naming the tags the release will need -- `--list`, which reads the
// manifests and touches neither git nor the network -- and this runs on `main`
// once the bump has landed there.
//
// **Why not in .github/workflows/release.yml.** Pushing a tag from there needs
// `contents: write`, and the job that would host it is the one job holding
// `id-token: write` for trusted publishing. A second job would keep those
// apart, but it would also make the tag a product of the publish pipeline --
// and the whole point of #460's criterion is that the tag must exist for a
// release that failed to publish. Run from `main` by whoever cut the bump, the
// tag is on the remote before the workflow is dispatched at all, and no
// permission near the publish credential moves. What the workflow does carry is
// `--verify` below: a read that refuses a release whose versions this has not
// tagged yet. Checking is not creating, and it needs no permission the workflow
// did not already have.
//
// Idempotent in both halves, because a retried release is exactly when this
// gets run twice: `changeset tag` skips a tag that already exists locally or on
// the remote, and the push below carries only the tags the remote does not
// have, without `--force` -- so a name already there under a different sha is
// refused rather than moved.

import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { publishablePackages } from './workspace-packages.mjs';

const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Resolved from this file rather than left to `pnpm exec`, which resolves from
// the working directory. The two are the same for `pnpm tag:packages` and are
// deliberately not the same in scripts/release-tags.test.mjs, which drives
// `tagRelease` against a throwaway workspace that has no `node_modules` of its
// own -- the tool comes from this checkout, the repository it acts on is the
// one it was pointed at.
const changesetBin = fileURLToPath(
  new URL('../node_modules/.bin/changeset', import.meta.url)
);

/**
 * @typedef {{ name: string; version: string }} TaggablePackage
 */

/**
 * @param {TaggablePackage} pkg
 * @returns {string}
 */
export const releaseTag = (pkg) => `${pkg.name}@${pkg.version}`;

/**
 * Every tag name in `git ls-remote --tags` output.
 *
 * An annotated tag -- which is what changesets creates, so that
 * `git push --follow-tags` will carry it -- appears on two lines: the tag
 * object, and the commit it peels to, suffixed `^{}`. Both name one tag.
 * @param {string} lsRemote
 * @returns {Set<string>}
 */
export const remoteTagNames = (lsRemote) =>
  new Set(
    [...lsRemote.matchAll(/^\S+\s+refs\/tags\/(.+?)(?:\^\{\})?$/gm)].map(
      ([, name]) => name
    )
  );

/**
 * What this run has left to do: the tags the remote is missing and the local
 * repository can supply, and the ones nothing anywhere can account for.
 *
 * The second list is not defensive padding. `git.tag` in @changesets/git
 * (3.0.4, the copy this lockfile resolves) answers `gitCmd.code === 0` and the
 * `tag` command discards that answer, so a tag changesets failed to create is a
 * silent no-op. Without this the run would push what worked, report success,
 * and leave a published version untagged -- which is the whole failure this
 * script exists to prevent.
 * @param {{
 *   packages: readonly TaggablePackage[];
 *   localTags: ReadonlySet<string>;
 *   remoteTags: ReadonlySet<string>;
 * }} state
 */
export const tagPlan = ({ packages, localTags, remoteTags }) => {
  /** @type {string[]} */
  const toPush = [];
  /** @type {string[]} */
  const unaccounted = [];
  for (const pkg of packages) {
    const tag = releaseTag(pkg);
    if (remoteTags.has(tag)) continue;
    (localTags.has(tag) ? toPush : unaccounted).push(tag);
  }
  return { toPush, unaccounted };
};

/**
 * The paths in `git status --porcelain` output. Every line is two status
 * characters, a space, and the path.
 * @param {string} porcelain
 * @returns {string[]}
 */
export const uncommittedPaths = (porcelain) =>
  porcelain
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.slice(3));

/**
 * The tags every publishable package in a tree requires, whether or not any of
 * them exists yet. Reads the manifests and nothing else.
 * @param {string} tree
 * @returns {string[]}
 */
export const requiredTags = (tree) =>
  publishablePackages(tree).map((pkg) => releaseTag(pkg));

/**
 * Which required tags the remote does not carry.
 *
 * Deliberately not `tagPlan`, which answers a different question: that one
 * decides what *this checkout* can push, so it needs a local tag list. A
 * release runner has a fresh clone and no local tags, and no business creating
 * any -- the whole reason tagging stays out of the workflow is that a tag must
 * not be a product of the publish pipeline. All it can ask is whether the work
 * was already done somewhere else.
 * @param {{ required: readonly string[]; remoteTags: ReadonlySet<string> }} state
 * @returns {string[]}
 */
export const missingReleaseTags = ({ required, remoteTags }) =>
  required.filter((tag) => !remoteTags.has(tag));

/**
 * Throws unless the remote carries a tag for every publishable version in a
 * tree. Answers with the tags it checked, so a caller can report what it
 * covered rather than restating the list.
 *
 * Read-only, and that is a requirement rather than a property that happens to
 * hold: this runs inside .github/workflows/release.yml, whose jobs have
 * `contents: read`. `git ls-remote` needs nothing more.
 * @param {{ repoRoot: string }} options
 * @returns {string[]}
 */
export const verifyReleaseTags = ({ repoRoot: tree }) => {
  const required = requiredTags(tree);
  const missing = missingReleaseTags({
    required,
    remoteTags: remoteTagNames(
      execFileSync('git', ['ls-remote', '--tags', 'origin'], {
        cwd: tree,
        encoding: 'utf8'
      })
    )
  });

  if (missing.length > 0) {
    throw new Error(
      `The remote carries no tag for these versions, so publishing now would ship a version with no commit range to read:\n${missing
        .map((tag) => `  ${tag}`)
        .join('\n')}\n` +
        'Run `pnpm tag:packages` from a checkout of `main` that carries the ' +
        'version bump, then dispatch this workflow again.'
    );
  }
  return required;
};

/**
 * Tags every publishable version in a repository and pushes what the remote is
 * missing. Answers with the tags it pushed, which is empty on a repeat run.
 *
 * `repoRoot` is a parameter rather than this file's own `..` so the end-to-end
 * test can point it at a throwaway workspace with a bare repository standing in
 * for `origin`. The CLI below passes this checkout.
 * @param {{ repoRoot: string }} options
 * @returns {string[]}
 */
export const tagRelease = ({ repoRoot: tree }) => {
  const packages = publishablePackages(tree);

  /** @param {readonly string[]} args */
  const git = (args) =>
    execFileSync('git', args, { cwd: tree, encoding: 'utf8' });

  // A version that is not committed is not at HEAD, and HEAD is what
  // `changeset tag` tags. `pnpm version:packages` leaves exactly this state,
  // and it is the script named next to this one, so running the two back to
  // back is the easy mistake -- it would push a tag naming a version the
  // tagged commit does not carry. Only the manifests are examined: a dirty
  // working tree is normal and none of the rest of it decides a version.
  const uncommitted = uncommittedPaths(
    git([
      'status',
      '--porcelain',
      '--',
      ...packages.map((pkg) => join(relative(tree, pkg.path), 'package.json'))
    ])
  );
  if (uncommitted.length > 0) {
    throw new Error(
      `These manifests carry versions that are not committed, so no commit here holds them:\n${uncommitted
        .map((path) => `  ${path}`)
        .join('\n')}\n` +
        'Land the version bump on `main` and run this from there.'
    );
  }

  // Committed is still not enough: the tag goes on HEAD, and `git push origin
  // refs/tags/<tag>` carries the objects that tag needs with it. Run from a
  // `main` that is ahead of the remote, that would put a published version's
  // tag on a commit no branch on the remote reaches -- the version tagged, the
  // code behind it absent from `main`, and nothing about it quietly
  // retractable. The remote is asked directly rather than through a fetch and
  // `origin/main`: a remote-tracking ref is only as fresh as the last fetch,
  // and this reads the same way `ls-remote --tags` below does.
  const remoteMain = git(['ls-remote', 'origin', 'refs/heads/main'])
    .split('\t')[0]
    .trim();
  const head = git(['rev-parse', 'HEAD']).trim();
  if (head !== remoteMain) {
    throw new Error(
      'HEAD is not the commit `origin/main` points at, so a tag pushed from ' +
        'here would name a commit no branch on the remote reaches:\n' +
        `  HEAD         ${head}\n` +
        `  origin/main  ${remoteMain === '' ? 'the remote carries no `main`' : remoteMain}\n` +
        'Push the version bump to `main`, then run this from a checkout of it.'
    );
  }

  // Creates the missing tags on HEAD. It reads `.changeset/config.json` and
  // both `git tag` and `git ls-remote` out of its own working directory, so
  // `cwd` is what points it at the repository being tagged.
  execFileSync(changesetBin, ['tag'], { cwd: tree, stdio: 'inherit' });

  const { toPush, unaccounted } = tagPlan({
    packages,
    localTags: new Set(
      git(['tag', '--list'])
        .split('\n')
        .filter((name) => name !== '')
    ),
    remoteTags: remoteTagNames(git(['ls-remote', '--tags', 'origin']))
  });

  if (unaccounted.length > 0) {
    throw new Error(
      `changeset tag created none of these, and the remote does not carry them:\n${unaccounted
        .map((tag) => `  ${tag}`)
        .join('\n')}`
    );
  }
  if (toPush.length === 0) return [];

  // The refs are named in full, and one at a time. `git push origin --tags`
  // would push every tag in the working copy, including whatever a local
  // experiment left behind, and a bare `<tag>` argument is a refspec git may
  // resolve against a branch of the same name.
  execFileSync(
    'git',
    ['push', 'origin', ...toPush.map((tag) => `refs/tags/${tag}`)],
    { cwd: tree, stdio: 'inherit' }
  );
  return toPush;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--verify')) {
      const verified = verifyReleaseTags({ repoRoot });
      console.log(
        `Every publishable version is tagged on the remote:\n${verified
          .map((tag) => `  ${tag}`)
          .join('\n')}`
      );
    } else if (process.argv.includes('--list')) {
      for (const tag of requiredTags(repoRoot)) console.log(tag);
      console.log(
        '\nThe tag every publishable version needs. `pnpm tag:packages`, run ' +
          'from `main` once this bump has landed there, creates the ones that ' +
          'do not exist yet and pushes them.'
      );
    } else {
      const pushed = tagRelease({ repoRoot });
      console.log(
        pushed.length === 0
          ? '\nEvery published version is already tagged on the remote.'
          : `\nPushed ${pushed.length} tag(s): ${pushed.join(', ')}`
      );
    }
  } catch (error) {
    // Not every throw is an Error -- the same reason scripts/verify-packaging.mjs
    // guards this, where a spawned tool rejecting with a string printed an empty
    // line and exited 1 with no reason given.
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
