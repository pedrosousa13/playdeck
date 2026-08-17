import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { gate, parseAuditOutput, shippedVersions } from './audit.mjs';
import { selectPublishable } from './workspace-packages.mjs';

// The repository's own tree is clean in both directions, so neither direction
// of the gate can be proved against it. `tests/audit/fixture` holds two real
// pnpm workspaces that differ in exactly one edge -- what the non-private
// package lists under `dependencies` -- and `captured/` holds the real output
// of the three pnpm commands `gather()` runs, taken against those workspaces.
// Regenerate a capture by running, from the variant's directory:
//
//   pnpm install --lockfile-only --ignore-scripts
//   pnpm list -r --depth -1 --json
//   pnpm list --prod --no-optional --depth Infinity --json --lockfile-only \
//     --filter @reely/audit-fixture-publishable
//   pnpm audit --json
//
// and storing them as `workspace`, `prodTrees` and `audit`, with the absolute
// fixture directory rewritten to `.`.
/**
 * @param {string} variant
 * @returns {Omit<import('./audit.mjs').AuditInputs, 'publishable'>}
 */
const capture = (variant) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../tests/audit/fixture/captured/${variant}.json`,
        import.meta.url
      ),
      'utf8'
    )
  );

// The capture holds command output only. `publishable` is the one input
// gather() derives rather than reads, so derive it here the same way.
/** @param {string} variant */
const fixture = (variant) => {
  const captured = capture(variant);
  return { ...captured, publishable: selectPublishable(captured.workspace) };
};

// Every directory `pnpm-workspace.yaml` matches, as the capture spells them.
/** @param {string} variant */
const projectDirectories = (variant) =>
  readdirSync(
    new URL(`../tests/audit/fixture/${variant}/packages`, import.meta.url),
    { withFileTypes: true }
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => `./packages/${entry.name}`);

/**
 * @param {string} variant
 * @param {string} path Fixture-relative directory holding the package.json.
 */
const manifest = (variant, path) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../tests/audit/fixture/${variant}/${path}/package.json`,
        import.meta.url
      ),
      'utf8'
    )
  );

// `packages/publishable` depends on cookie@0.4.0, whose only advisory is `low`.
const shipped = fixture('shipped');
// The same tree with that one dependency swapped for a clean one. Everything
// else -- a critical under the root's devDependencies, two criticals and a
// high under a private workspace package's `dependencies` -- is unchanged.
const developmentOnly = fixture('development-only');

test('a low-severity advisory reachable from a publishable package fails the gate', () => {
  const result = gate(shipped);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    result.advisories
      .filter((advisory) => advisory.shipped)
      .map((advisory) => `${advisory.severity} ${advisory.module}`),
    ['low cookie@0.4.0']
  );
});

test('critical advisories reachable only through development and private packages pass the gate', () => {
  const result = gate(developmentOnly);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    result.advisories.filter((advisory) => advisory.shipped),
    []
  );
  // Not vacuous: the tree really does carry criticals, they are just unshipped.
  assert.ok(
    result.advisories.some((advisory) => advisory.severity === 'critical')
  );
});

test("a private package's production dependency is not reachable", () => {
  // shell-quote sits under `packages/internal`, which is private, in its
  // `dependencies` -- the case a production-only audit gets wrong.
  assert.deepEqual(
    gate(shipped)
      .advisories.filter((advisory) =>
        advisory.module.startsWith('shell-quote')
      )
      .map((advisory) => advisory.shipped),
    [false, false, false]
  );
});

test('every advisory the tool found is printed with its severity and its label', () => {
  const result = gate(shipped);
  const ids = Object.keys(shipped.audit.advisories);
  assert.equal(result.advisories.length, ids.length);
  for (const id of ids) {
    const advisory = shipped.audit.advisories[id];
    assert.match(
      result.report,
      new RegExp(`${advisory.severity}\\s+${advisory.module_name}@`)
    );
    assert.ok(result.report.includes(advisory.github_advisory_id));
  }
  assert.match(result.report, /SHIPPED/);
  assert.match(result.report, /not shipped/);
});

test('the report names the dependency count and the packages the gate is drawn around', () => {
  const result = gate(shipped);
  assert.ok(result.report.includes('6 dependencies'));
  assert.ok(result.report.includes('@reely/audit-fixture-publishable'));
});

test('collects the transitive production closure of each publishable package', () => {
  assert.deepEqual(
    shippedVersions([
      {
        name: '@reely/react',
        dependencies: {
          '@reely/core': {
            version: 'link:../core',
            dependencies: { 'hls.js': { version: '1.6.16' } }
          }
        }
      }
    ]),
    // The workspace link itself is not a registry package and can carry no
    // advisory; what it pulls in transitively is the point.
    new Map([['hls.js@1.6.16', ['@reely/react']]])
  );
});

test('every advisory labelled SHIPPED names the packages it is reachable from', () => {
  // The label and the list are one fact stated twice, and the report prints
  // them separately. A run reporting SHIPPED over an empty `reachable from:`
  // is a broken gate, not a clean one, so pin the two together rather than
  // leaving it to be diagnosed from a report dump.
  for (const variant of [shipped, developmentOnly]) {
    for (const advisory of gate(variant).advisories) {
      assert.equal(
        advisory.shipped,
        advisory.reachableFrom.length > 0,
        `${advisory.module}: shipped=${advisory.shipped} reachableFrom=${JSON.stringify(advisory.reachableFrom)}`
      );
    }
  }
});

test('each capture still describes the workspace it was taken from', () => {
  // The captures are the only thing the tests read; the workspaces beside them
  // are what a regeneration runs against. Nothing else notices when the two
  // drift, so compare the part the gate turns on -- which projects exist and
  // which of them are private -- without reinstalling either workspace.
  for (const variant of ['shipped', 'development-only']) {
    const { workspace, prodTrees } = capture(variant);
    const declared = ['.', ...projectDirectories(variant)].map((path) => {
      const { name, private: isPrivate } = manifest(variant, path);
      // pnpm reports the absence of `private` as `false`.
      return [path, name, isPrivate === true];
    });
    assert.deepEqual(
      workspace.map((entry) => [entry.path, entry.name, entry.private]).sort(),
      declared.sort()
    );
    // And the trees the capture holds are those of the non-private projects.
    assert.deepEqual(
      prodTrees.map((tree) => tree.name),
      workspace
        .filter((entry) => entry.private === false)
        .map((entry) => entry.name)
    );
  }
});

test('fails closed when the registry could not be reached', () => {
  // Verbatim stdout of `pnpm audit --json --registry http://127.0.0.1:1/`,
  // which exits 1. Parseable JSON, no advisories -- an empty report here would
  // otherwise read as a clean tree.
  const outage = JSON.stringify({
    error: {
      code: 'ECONNREFUSED',
      message:
        'request to http://127.0.0.1:1/-/npm/v1/security/audits/quick failed, reason: connect ECONNREFUSED 127.0.0.1:1'
    }
  });
  assert.throws(
    () => parseAuditOutput(outage),
    /The audit did not run: ECONNREFUSED/
  );
});

test('fails closed when the audit printed something that is not a report', () => {
  assert.throws(
    () => parseAuditOutput('ERR_PNPM_FETCH_404\n'),
    /could not be read/
  );
  assert.throws(() => parseAuditOutput('{}'), /could not be read/);
});
