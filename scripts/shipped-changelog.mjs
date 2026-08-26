// The rule that a packed tarball carries its own changelog, and that the
// changelog describes the version inside that tarball. #460 is the record of
// why: a consumer upgrading between two published versions had no reachable
// account of what changed between them. The repository holds a CHANGELOG.md per
// package, but `files` named `dist` and nothing else, so npm never shipped one
// and `node_modules/@playdeck/react` arrived carrying no history at all.
//
// The rule is split in two on purpose. `changelogProblems` is the whole of the
// judgement and touches no filesystem, so the near misses that matter -- a
// version that appears only in prose, a version that is a prefix of a longer
// one -- are tested directly rather than through a tarball. `shippedChangelog`
// is the one line of IO underneath it.
//
// Both gates that need the rule call it: scripts/verify-packaging.mjs, which is
// what the release workflow runs, and scripts/shipped-changelog.test.mjs, which
// packs the same set in a second and runs in the `static` CI job. Neither
// restates the rule, for the same reason scripts/workspace-packages.mjs exists.

import { execFileSync } from 'node:child_process';

// Every entry in an npm tarball is under `package/`, and npm ships this file
// from the package root or not at all -- it is not one of the names npm
// includes whatever `files` says (package.json, README, LICENSE), so a `files`
// list that does not name it ships a tarball with no changelog in it.
const changelogEntry = 'package/CHANGELOG.md';

/**
 * The changelog inside a packed tarball, or `undefined` if it carries none.
 *
 * `tar` is asked for the one member rather than for a listing to filter,
 * because the answer needed is the file's contents and a listing would be a
 * second process to reach them. A tarball that carries no such member exits
 * non-zero, which is the only failure this can distinguish -- a truncated or
 * unreadable archive reports the same way. That is acceptable here and only
 * here: every other reader in scripts/verify-packaging.mjs runs over the same
 * tarball moments later and none of them tolerates a broken one.
 * @param {string} tarball
 * @returns {string | undefined}
 */
export const shippedChangelog = (tarball) => {
  try {
    return execFileSync('tar', ['-xzOf', tarball, changelogEntry], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return undefined;
  }
};

/**
 * What is wrong with the changelog a tarball carries, as phrases that read
 * after a package name -- the voice `tarballProblems` in
 * scripts/verify-packaging.mjs already reports in.
 *
 * A heading is what counts, never a mention. Changesets writes each release as
 * `## <version>`, and the prose underneath discusses earlier versions freely. A
 * rule that searched the document would therefore pass a changelog that had
 * never been regenerated for the release being packed, which is the one thing
 * it exists to catch. The match is anchored at both ends of the line for the
 * same reason from the other side: `0.2.1` is a prefix of `0.2.10`, and `0.3.0`
 * is a prefix of the `0.3.0-next.0` that `prerelease:enter` produces.
 * @param {string | undefined} changelog
 * @param {string} version
 * @returns {string[]}
 */
export const changelogProblems = (changelog, version) => {
  if (changelog === undefined) {
    return [
      'ships no CHANGELOG.md, so an installed copy says nothing about what changed'
    ];
  }
  const heading = new RegExp(
    `^##[ \\t]+${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`,
    'm'
  );
  return heading.test(changelog)
    ? []
    : [
        `ships a CHANGELOG.md with no \`## ${version}\` heading, so the version installed is not the version it describes`
      ];
};
