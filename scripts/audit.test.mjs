import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  flooredName,
  gate,
  parseAuditOutput,
  shippedVersions,
  workspaceOverrides
} from './audit.mjs';
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
//     --filter @playdeck/audit-fixture-publishable
//   pnpm audit --json
//
// and storing them as `workspace`, `prodTrees` and `audit`, with the absolute
// fixture directory rewritten to `.`.
/**
 * @param {string} variant
 * @returns {Omit<import('./audit.mjs').AuditInputs, 'publishable' | 'overrides'>}
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

// The capture holds command output only. `publishable` and `overrides` are the
// two inputs gather() derives and reads rather than captures, so produce them
// here through the same two exports it calls -- the second from the variant's
// own workspace file, neither of which declares any override.
/** @param {string} variant */
const fixture = (variant) => {
  const captured = capture(variant);
  return {
    ...captured,
    publishable: selectPublishable(captured.workspace),
    overrides: workspaceOverrides(
      readFileSync(
        new URL(
          `../tests/audit/fixture/${variant}/pnpm-workspace.yaml`,
          import.meta.url
        ),
        'utf8'
      )
    )
  };
};

/** @param {string} report */
const lastLine = (report) => report.slice(report.lastIndexOf('\n') + 1);

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
  assert.ok(result.report.includes('@playdeck/audit-fixture-publishable'));
});

test('collects the transitive production closure of each publishable package', () => {
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/react',
        dependencies: {
          '@playdeck/core': {
            version: 'link:../core',
            dependencies: { 'hls.js': { version: '1.6.16' } }
          }
        }
      }
    ]),
    // The workspace link itself is not a registry package and can carry no
    // advisory; what it pulls in transitively is the point.
    new Map([['hls.js@1.6.16', ['@playdeck/react']]])
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

// An override is a workspace-local resolution instruction: it rewrites the very
// graph `pnpm list --prod` reports and the very versions `pnpm audit` is asked
// about, and it is not written into any published package.json. So where one
// lands inside a publishable closure, the gate is measuring a graph no consumer
// resolves and its verdict on that module means nothing. `development-only`
// ships exactly `ms@2.1.3` and passes today, which isolates the new failure
// from the advisory gate.
test('a floored name inside a publishable closure fails an otherwise clean gate', () => {
  const result = gate({
    ...developmentOnly,
    overrides: { 'ms@<2.1.3': '>=2.1.3' }
  });
  assert.equal(result.exitCode, 1);
  // Not the advisory gate doing the failing: nothing here is reachable.
  assert.deepEqual(
    result.advisories.filter((advisory) => advisory.shipped),
    []
  );
});

test('the report names the floored module, the packages reaching it, and why the guarantee is void', () => {
  const report = gate({
    ...developmentOnly,
    overrides: { 'ms@<2.1.3': '>=2.1.3' }
  }).report;
  assert.match(report, /FLOORED\s+ms@2\.1\.3/);
  assert.match(report, /reachable from: @playdeck\/audit-fixture-publishable/);
  assert.ok(report.includes('pnpm-workspace.yaml'));
  // A floored module is a finding, printed among the advisories, and one
  // summary closes the report -- not a second one after the first.
  assert.equal(
    lastLine(report),
    "No advisory is reachable from a publishable package's dependencies. 1 module(s) above are floored. A floor does not travel to a consumer, so what a consumer resolves was never measured."
  );
});

// The captures ship one unscoped dependency each, so the two selector shapes
// that differ under a name comparison -- a scope's own `@`, and a key naming
// the parent a floor applies under -- only ever reach `flooredName` through the
// parser's own test. Drive them through the gate as well, on a tree written
// here, so the path from an override key to a floored dependency is proved for
// both and not only for `ms`.
// An override value may be a `link:` spec, and pnpm then reports the
// dependency at a `link:` version under the key's own name. `shippedVersions`
// drops those deliberately -- a workspace link is not a registry package and
// carries no advisory -- so the two questions need two walks: whether a
// resolved version can carry an advisory is not whether a floor touched this
// closure. Reading the advisory walk's output for the second question loses
// exactly this case, and loses it silently, as a clean tree.
test('a floored dependency that resolves to a workspace link fails the gate', () => {
  const prodTrees = [
    {
      name: '@playdeck/audit-fixture-publishable',
      dependencies: { ms: { version: 'link:../local-ms' } }
    }
  ];
  // Not vacuous: the advisory walk really does come back empty for this tree.
  assert.deepEqual(shippedVersions(prodTrees), new Map());
  const result = gate({
    ...developmentOnly,
    prodTrees,
    overrides: { ms: 'link:./local-ms' }
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.report, /FLOORED\s+ms@link:\.\.\/local-ms/);
});

test('a scoped dependency is floored by its scoped name', () => {
  const result = gate({
    ...developmentOnly,
    prodTrees: [
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: { '@scope/pkg': { version: '1.2.3' } }
      }
    ],
    overrides: { '@scope/pkg@1': '>=1.2.3' }
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.report, /FLOORED\s+@scope\/pkg@1\.2\.3/);
});

test('a parent>child key floors the child it names', () => {
  const result = gate({
    ...developmentOnly,
    prodTrees: [
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: {
          parent: {
            version: '1.0.0',
            dependencies: { child: { version: '4.5.6' } }
          }
        }
      }
    ],
    overrides: { 'parent>child': '4.5.6' }
  });
  assert.equal(result.exitCode, 1);
  // The child, reached through the parent -- not the parent the key opens with.
  assert.match(result.report, /FLOORED\s+child@4\.5\.6/);
  assert.ok(!result.report.includes('FLOORED      parent@'));
});

test('an override on a name outside every publishable closure changes nothing', () => {
  // A real floor from the repository's own workspace file. `development-only`
  // ships `ms` and nothing else, so this one rewrites no part of the closure
  // the gate measures and the gate's answer still stands.
  const result = gate({
    ...developmentOnly,
    overrides: { 'postcss@<8.5.23': '>=8.5.23' }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report, gate(developmentOnly).report);
});

test('a workspace declaring no overrides leaves both variants as they are', () => {
  // Neither fixture workspace has an `overrides` block, so the absence has to
  // read as an empty map rather than throw or match everything.
  assert.deepEqual(shipped.overrides, {});
  assert.deepEqual(developmentOnly.overrides, {});
  assert.equal(gate(shipped).exitCode, 1);
  assert.equal(gate(developmentOnly).exitCode, 0);
  for (const variant of [shipped, developmentOnly]) {
    assert.ok(!gate(variant).report.includes('FLOORED'));
  }
  // Absent means absent: with nothing floored the report ends where it ended
  // before floored modules were reported at all, on the advisory summary alone.
  // Asserting only that no `FLOORED` line appears would still pass over a
  // summary that had gained a second sentence counting zero of them.
  assert.match(
    lastLine(gate(developmentOnly).report),
    /^No advisory is reachable from a publishable package's dependencies\.$/
  );
  assert.match(
    lastLine(gate(shipped).report),
    /^1 of \d+ advisories are reachable from a publishable package's dependencies\. Severity is not the gate; reachability is\.$/
  );
});

test('the overrides block is read out of a workspace file, and its absence is empty', () => {
  assert.deepEqual(
    workspaceOverrides(
      'packages:\n  - packages/*\noverrides:\n  postcss@<8.5.23: ">=8.5.23"\n  js-yaml@3: ">=3.15.1 <4"\n'
    ),
    { 'postcss@<8.5.23': '>=8.5.23', 'js-yaml@3': '>=3.15.1 <4' }
  );
  // The shape of both fixture workspaces, read by `fixture()` above: other
  // keys, no `overrides`. The preceding test asserts what that absence yields
  // for them; this fixes the shape it is read from. Nothing to intersect is an
  // answer, not a failure.
  assert.deepEqual(workspaceOverrides('packages:\n  - packages/*\n'), {});
  // A file that is empty, or holds only comments, parses to null rather than
  // to an object -- so the absence has to survive that too.
  assert.deepEqual(workspaceOverrides(''), {});
  assert.deepEqual(workspaceOverrides('# no settings yet\n'), {});
});

test("the repository's own workspace file really does carry overrides to intersect", () => {
  // The synthetic strings above fix the shape; this fixes the fact. If this
  // read ever comes back empty -- the block renamed, moved, or the parse
  // silently failing -- the gate would report a clean tree for the same reason
  // it did before #335, and every overlap test above would still pass.
  const overrides = workspaceOverrides(
    readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
  );
  assert.ok(Object.keys(overrides).length > 0);
  // And every key parses to a package name rather than to a fragment of its
  // own range -- the shape a name can take, not the specific names, so a floor
  // may be added or removed without touching this. `postcss@>=8.5.23` read by
  // splitting on `>` yields `=8.5.23`, which this rejects.
  for (const key of Object.keys(overrides)) {
    assert.match(
      flooredName(key),
      /^(?:@[^@/\s]+\/)?[a-z0-9][^@<>=|\s/]*$/,
      key
    );
  }
});

test('an override selector key names the package it floors', () => {
  // `>` carries both meanings a key can hold -- a semver operator inside a
  // range, and the separator between path segments -- so every shape below
  // that contains one is a way of telling those two apart. A key whose range
  // is written `>=` binds exactly as one written `<` does, so reading its
  // operator as a separator would floor a package the gate then never looks
  // for: the failure would be silent and would read as a clean tree.
  const keys = {
    // A range, a bare major, and no selector at all.
    'postcss@<8.5.23': 'postcss',
    'postcss@>=8.5.23': 'postcss',
    'foo@>1': 'foo',
    'foo@>=1 <2': 'foo',
    'js-yaml@3': 'js-yaml',
    postcss: 'postcss',
    // The `@` of a scope opens the name; it never separates a range.
    '@scope/pkg': '@scope/pkg',
    '@scope/pkg@1': '@scope/pkg',
    '@scope/p@>=1': '@scope/p',
    // pnpm's override path syntax: the floor applies to the last segment, not
    // to the parent it is reached through. A parent carrying its own range puts
    // both meanings of `>` in one key, `qar@1>zoo` closing a range before the
    // separator that follows it.
    'parent>child@1': 'child',
    '@scope/parent>@scope/child': '@scope/child',
    'qar@1>zoo': 'zoo'
  };
  assert.deepEqual(
    Object.fromEntries(Object.keys(keys).map((key) => [key, flooredName(key)])),
    keys
  );
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
