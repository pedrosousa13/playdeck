// The one definition of "publishable" in this repo: a workspace project whose
// package.json does not set `private`. Both gates that need the boundary --
// the packaging harness (scripts/verify-packaging.mjs) and the audit gate
// (scripts/audit.mjs) -- import it from here, so they cannot drift apart on
// what does and does not ship.
//
// Discovery comes from `pnpm list -r`, never from a hardcoded list, so a new
// workspace package is covered the moment it exists.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A project entry from `pnpm list -r --depth -1 --json`. The workspace root
 * and other private projects carry no `version`.
 * @typedef {{ name: string; version?: string; path: string; private: boolean }} WorkspaceProject
 * @typedef {WorkspaceProject & { version: string }} PublishablePackage
 */

/**
 * @param {readonly WorkspaceProject[]} listing
 * @returns {PublishablePackage[]}
 */
export const selectPublishable = (listing) => {
  // A package npm will accept always has a version, so narrowing here is safe.
  const packages = /** @type {PublishablePackage[]} */ (
    listing.filter((entry) => entry.private === false)
  );
  if (packages.length === 0) {
    throw new Error('No publishable workspace packages were discovered.');
  }
  return packages;
};

/**
 * @param {string} repoRoot
 * @returns {WorkspaceProject[]}
 */
export const workspaceProjects = (repoRoot) =>
  JSON.parse(
    execFileSync('pnpm', ['list', '-r', '--depth', '-1', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
  );

/** @param {string} repoRoot */
export const publishablePackages = (repoRoot) =>
  selectPublishable(workspaceProjects(repoRoot));

/**
 * The publishable set of a tree that is not the working one -- `main`'s, in
 * the audit gate's boundary comparison (#373). The same discovery and the same
 * rule as above, deliberately: the comparison is only worth anything if both
 * sides are computed by one definition of publishable, so this adds a guard
 * and nothing else.
 *
 * The guard is what stops the comparison from quietly becoming a no-op.
 * `pnpm list -r` run from a directory with no `pnpm-workspace.yaml` searches
 * *upward* for one: measured, an empty directory inside this repository yields
 * this repository's own projects. A baseline that failed to materialise --
 * fetch skipped, archive empty, path misspelled -- would then be compared
 * against itself, agree, and report a boundary that had not moved. That is the
 * exact failure this comparison exists to catch, so a baseline directory that
 * carries no workspace file is an error rather than an empty answer.
 *
 * `pnpm list -r --depth -1 --json` needs no lockfile, no `node_modules` and no
 * install: the manifests and the workspace file are enough, which is what lets
 * the CI step build this directory with a single `git archive`.
 * @param {string} baselineDir
 * @returns {PublishablePackage[]}
 */
export const publishableBaseline = (baselineDir) => {
  if (!existsSync(join(baselineDir, 'pnpm-workspace.yaml'))) {
    throw new Error(
      `The publishable baseline at ${baselineDir} carries no pnpm-workspace.yaml, so no boundary could be read from it.`
    );
  }
  return publishablePackages(baselineDir);
};
