import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  departedPackages,
  flooredName,
  gate,
  parseAuditOutput,
  shippedVersions,
  workspaceOverrides,
  workspaceSuppressions
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
 * @returns {Omit<import('./audit.mjs').AuditInputs, 'publishable' | 'baseline' | 'overrides' | 'suppressions'>}
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

// The capture holds command output only. `publishable`, `overrides` and
// `suppressions` are the inputs gather() derives and reads rather than
// captures, so produce them here through the same exports it calls -- the last
// two from the variant's own workspace file, neither of which declares any
// override or any `auditConfig`. `baseline` is null because there is no
// baseline on the ordinary path: gather() reads one only when CI points it at
// `main`'s manifests (#373), and every assertion below that leaves it null is
// asserting what a developer running `pnpm test:audit` sees.
/** @param {string} variant */
const fixture = (variant) => {
  const captured = capture(variant);
  const workspaceYaml = readFileSync(
    new URL(
      `../tests/audit/fixture/${variant}/pnpm-workspace.yaml`,
      import.meta.url
    ),
    'utf8'
  );
  return {
    ...captured,
    publishable: selectPublishable(captured.workspace),
    baseline: null,
    overrides: workspaceOverrides(workspaceYaml),
    suppressions: workspaceSuppressions(workspaceYaml)
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

// An npm alias -- `"foo": "npm:bar@1.0.0"` -- installs one package under
// another name. pnpm reports the node under the alias and carries the package
// actually installed in `from`, and `pnpm audit` names that package and only
// that package in `module_name`. So the closure has to be keyed on `from`: keyed
// on the alias, the entry cannot be joined to any advisory by construction, and
// an advisory against something a publishable package really does ship reads as
// `not shipped` while the gate exits 0.
//
// Every node below is the verbatim shape of `pnpm list --prod --no-optional
// --depth Infinity --json` on pnpm 11.20.0, with the fields these assertions do
// not turn on dropped -- `resolved`, which the walk never reads, and `path`,
// which it does read on every node, both for the `descended` guard and to join
// a deduped node back to its subtree (#377), but which changes nothing here:
// these trees carry no deduped node to join and no repeated node for the guard
// to stop.
test('an aliased dependency is keyed on the package installed, not the alias', () => {
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: {
          'safe-name': { from: 'cookie', version: '0.4.0' }
        }
      }
    ]),
    new Map([['cookie@0.4.0', ['@playdeck/audit-fixture-publishable']]])
  );
});

test('an advisory against an aliased dependency is reachable and fails the gate', () => {
  // `development-only` ships one clean dependency and passes today, and its
  // captured report carries three real advisories against shell-quote@1.7.2 --
  // reached, in the workspace it was taken from, only through a private
  // package. Alias that same version into the publishable package's own
  // `dependencies` and the gate has to see it.
  const result = gate({
    ...developmentOnly,
    prodTrees: [
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: {
          'safe-shell': { from: 'shell-quote', version: '1.7.2' }
        }
      }
    ]
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    result.advisories
      .filter((advisory) => advisory.shipped)
      .map((advisory) => advisory.module),
    ['shell-quote@1.7.2', 'shell-quote@1.7.2', 'shell-quote@1.7.2']
  );
  // Named by the package the advisory is against, and attributed to the
  // publishable package that reaches it -- not to the alias, which names no
  // package at all.
  assert.match(result.report, /SHIPPED\s+critical\s+shell-quote@1\.7\.2/);
  assert.match(
    result.report,
    /reachable from: @playdeck\/audit-fixture-publishable/
  );
  assert.ok(!result.report.includes('safe-shell'));
});

test('an alias standing in for a vulnerable name does not join to its advisories', () => {
  // The other direction, and the reason the alias key is not recorded
  // alongside `from` as a second key: aliasing away from a vulnerable package
  // to a patched fork leaves the vulnerable name as the key over a package
  // that is not it. Recording `shell-quote@1.7.2` here would report a module
  // this closure does not contain, and fail the gate on the change that fixed
  // the problem.
  const result = gate({
    ...developmentOnly,
    prodTrees: [
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: {
          'shell-quote': { from: 'safe-shell-quote', version: '1.7.2' }
        }
      }
    ]
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    result.advisories.filter((advisory) => advisory.shipped),
    []
  );
});

test('a scoped package is keyed on its scope in either direction across an alias', () => {
  // A scope's `@` sits inside a package name and never separates one, so both
  // directions have to survive: a scoped package installed under an unscoped
  // alias, and an unscoped one installed under a scoped alias. Both shapes are
  // real -- `"aliased-player": "npm:@vimeo/player@2.30.4"` and `"@safe/scoped":
  // "npm:@sindresorhus/is@7.0.1"` produce exactly these nodes.
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: {
          'aliased-player': { from: '@vimeo/player', version: '2.30.4' },
          '@safe/scoped': { from: '@sindresorhus/is', version: '7.0.1' },
          '@safe/unscoped': { from: 'cookie', version: '0.4.0' }
        }
      }
    ]),
    new Map([
      ['@vimeo/player@2.30.4', ['@playdeck/audit-fixture-publishable']],
      ['@sindresorhus/is@7.0.1', ['@playdeck/audit-fixture-publishable']],
      ['cookie@0.4.0', ['@playdeck/audit-fixture-publishable']]
    ])
  );
});

test('a dependency installed under its own name is keyed on that name', () => {
  // The regression the alias key is traded for. `from` equals the key on every
  // node of this repository's own trees, so this is the shape the walk almost
  // always meets, and keying on `from` must leave it exactly where it was.
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: {
          'hls.js': { from: 'hls.js', version: '1.6.16' },
          '@vimeo/player': { from: '@vimeo/player', version: '2.30.4' }
        }
      }
    ]),
    new Map([
      ['hls.js@1.6.16', ['@playdeck/audit-fixture-publishable']],
      ['@vimeo/player@2.30.4', ['@playdeck/audit-fixture-publishable']]
    ])
  );
});

test('every node shape the walk meets is keyed on the package installed', () => {
  // The four shapes `pnpm list` produces, in one tree, each with an alias on
  // it where an alias can occur:
  //
  // - a workspace link, whose `from` is its own name whatever the dependency
  //   was written as -- a `file:` value pointing at a directory resolves to a
  //   `link:` version under the key, with `from` left on the key rather than
  //   on the linked package's real name. Skipped either way: a link is not a
  //   registry package and carries no advisory. What it pulls in is the point,
  //   so the walk goes through it.
  // - a transitive node several levels down, which carries `from` like any
  //   other.
  // - a deduped node, which carries `from` and drops `dependencies`.
  // - a scoped package under an unscoped alias.
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: {
          '@playdeck/core': {
            from: '@playdeck/core',
            version: 'link:../core',
            dependencies: {
              'aliased-player': {
                from: '@vimeo/player',
                version: '2.30.4',
                dependencies: {
                  'safe-promise': {
                    from: 'native-promise-only',
                    version: '0.8.1'
                  }
                }
              }
            }
          },
          'aliased-file': { from: 'aliased-file', version: 'link:../local' },
          'aliased-deduped': {
            from: '@vimeo/player',
            version: '2.30.4',
            deduped: true,
            dedupedDependenciesCount: 2
          }
        }
      }
    ]),
    // No `link:` key of either kind, and the deduped node keyed on the same
    // `name@version` its undeduped twin above produced, so the two collapse to
    // one entry rather than to one real and one aliased.
    new Map([
      ['@vimeo/player@2.30.4', ['@playdeck/audit-fixture-publishable']],
      ['native-promise-only@0.8.1', ['@playdeck/audit-fixture-publishable']]
    ])
  );
});

test('a node carrying no `from` is keyed on the name it is installed under', () => {
  // `from` is on every node pnpm 11.20.0 emits, at every depth and for every
  // shape above. The fallback is for a pnpm that stops emitting it: the join
  // is then no worse than it was before aliases were handled at all, rather
  // than the closure being dropped or the walk throwing.
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: { 'hls.js': { version: '1.6.16' } }
      }
    ]),
    new Map([['hls.js@1.6.16', ['@playdeck/audit-fixture-publishable']]])
  );
});

// pnpm prints each physical package's subtree once. Every later occurrence is
// marked `deduped` and carries no `dependencies` at all -- only a
// `dedupedDependenciesCount` -- so a walk that reads `dependencies` alone has
// nothing to descend and loses the whole closure beneath that node, for that
// owner (#377). `--depth Infinity` does not prevent it.
//
// The nodes below carry `path` because that is the key the subtree is looked up
// under. It is the one field every deduped node has: the two the current tree
// produces for a workspace link carry `path` and no `resolved` at all.
test('a deduped node is descended by splicing in the subtree pnpm printed elsewhere', () => {
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/provider-vimeo',
        path: '/w/packages/provider-vimeo',
        dependencies: {
          '@vimeo/player': {
            from: '@vimeo/player',
            version: '2.30.4',
            path: '/w/node_modules/.pnpm/@vimeo+player@2.30.4/node_modules/@vimeo/player',
            dependencies: {
              'native-promise-only': {
                from: 'native-promise-only',
                version: '0.8.1',
                path: '/w/node_modules/.pnpm/native-promise-only@0.8.1/node_modules/native-promise-only'
              }
            }
          }
        }
      },
      {
        name: '@playdeck/react',
        path: '/w/packages/react',
        dependencies: {
          '@vimeo/player': {
            from: '@vimeo/player',
            version: '2.30.4',
            path: '/w/node_modules/.pnpm/@vimeo+player@2.30.4/node_modules/@vimeo/player',
            deduped: true,
            dedupedDependenciesCount: 1
          }
        }
      }
    ]),
    // `@playdeck/react` reaches the polyfill through the deduped node and is an
    // owner of it, exactly as `@playdeck/provider-vimeo` is.
    new Map([
      ['@vimeo/player@2.30.4', ['@playdeck/provider-vimeo', '@playdeck/react']],
      [
        'native-promise-only@0.8.1',
        ['@playdeck/provider-vimeo', '@playdeck/react']
      ]
    ])
  );
});

test('a package whose only dependency is a deduped workspace link is named on what the link reaches', () => {
  // The thinnest shape the under-reporting takes. A deduped node can be a
  // workspace link -- two of the three this repository produces are -- and a
  // link is not recorded as a module, so before the splice a package whose sole
  // dependency is one recorded an empty closure and was named on nothing.
  //
  // Empty for that owner, not for the gate. `@playdeck/provider-hls` carries
  // the full print, is publishable like every root here, and recorded
  // `shell-quote` on its own; the map is a union, so `shipped` was true either
  // way and no advisory read `not shipped`. What was wrong, and what this pins,
  // is which packages the `reachable from:` line names (#377).
  //
  // Also the reason the `descended` set that bounds the walk is per owner rather
  // than shared. Shared, `@playdeck/react` would claim the subtree first and
  // `@playdeck/provider-hls` would be skipped over it, losing the owner the
  // walk used to get right.
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/react',
        path: '/w/packages/react',
        dependencies: {
          '@playdeck/provider-native': {
            from: '@playdeck/provider-native',
            version: 'link:../provider-native',
            path: '/w/packages/provider-native',
            deduped: true,
            dedupedDependenciesCount: 1
          }
        }
      },
      {
        name: '@playdeck/provider-hls',
        path: '/w/packages/provider-hls',
        dependencies: {
          '@playdeck/provider-native': {
            from: '@playdeck/provider-native',
            version: 'link:../provider-native',
            path: '/w/packages/provider-native',
            dependencies: {
              'shell-quote': {
                from: 'shell-quote',
                version: '1.7.2',
                path: '/w/node_modules/.pnpm/shell-quote@1.7.2/node_modules/shell-quote'
              }
            }
          }
        }
      }
    ]),
    // Neither `link:` version is a key: a link is still walked through and
    // still not recorded, spliced or not.
    new Map([
      ['shell-quote@1.7.2', ['@playdeck/react', '@playdeck/provider-hls']]
    ])
  );
});

test('an advisory reached through a deduped node names every package that reaches it', () => {
  // `development-only` carries three real advisories against shell-quote@1.7.2
  // and passes today because nothing publishable reaches that version. Put it
  // one level under a deduped node and both packages have to be named -- the
  // attribution line is what an operator reads to decide what to do about the
  // advisory, and it is the line the elided subtree shortens.
  const link = {
    from: '@playdeck/audit-fixture-internal',
    version: 'link:../internal',
    path: '/w/packages/internal'
  };
  const result = gate({
    ...developmentOnly,
    prodTrees: [
      {
        name: '@playdeck/audit-fixture-publishable',
        path: '/w/packages/publishable',
        dependencies: {
          '@playdeck/audit-fixture-internal': {
            ...link,
            deduped: true,
            dedupedDependenciesCount: 1
          }
        }
      },
      {
        name: '@playdeck/audit-fixture-second',
        path: '/w/packages/second',
        dependencies: {
          '@playdeck/audit-fixture-internal': {
            ...link,
            dependencies: {
              'shell-quote': {
                from: 'shell-quote',
                version: '1.7.2',
                path: '/w/node_modules/.pnpm/shell-quote@1.7.2/node_modules/shell-quote'
              }
            }
          }
        }
      }
    ]
  });
  assert.equal(result.exitCode, 1);
  assert.match(
    result.report,
    /reachable from: @playdeck\/audit-fixture-publishable, @playdeck\/audit-fixture-second/
  );
  // The owner the walk already got right keeps its place; splicing adds owners
  // and takes none away.
  assert.deepEqual(
    result.advisories
      .filter((advisory) => advisory.shipped)
      .map((advisory) => advisory.reachableFrom),
    [
      ['@playdeck/audit-fixture-publishable', '@playdeck/audit-fixture-second'],
      ['@playdeck/audit-fixture-publishable', '@playdeck/audit-fixture-second'],
      ['@playdeck/audit-fixture-publishable', '@playdeck/audit-fixture-second']
    ]
  );
});

test('a deduped node pointing back at a subtree already descended does not recur forever', () => {
  // Splicing is what makes this reachable: before it, the tree pnpm printed was
  // finite by construction and the walk could not revisit anything. A spliced
  // subtree can carry a deduped node naming a package the walk is already
  // inside, and the walk would then splice that one in too, forever.
  //
  // The `descended` set is keyed on `path` -- the same key the splice joins on, and
  // the identity of the physical package. Two nodes at one path have one
  // subtree, so a second descent can record nothing the first did not, and
  // skipping it costs nothing. That bounds the work at one descent per distinct
  // path per owner rather than one per route to it.
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/audit-fixture-publishable',
        path: '/w/packages/publishable',
        dependencies: {
          alpha: {
            from: 'alpha',
            version: '1.0.0',
            path: '/w/node_modules/.pnpm/alpha@1.0.0/node_modules/alpha',
            dependencies: {
              beta: {
                from: 'beta',
                version: '2.0.0',
                path: '/w/node_modules/.pnpm/beta@2.0.0/node_modules/beta',
                dependencies: {
                  alpha: {
                    from: 'alpha',
                    version: '1.0.0',
                    path: '/w/node_modules/.pnpm/alpha@1.0.0/node_modules/alpha',
                    deduped: true,
                    dedupedDependenciesCount: 1
                  }
                }
              }
            }
          }
        }
      }
    ]),
    new Map([
      ['alpha@1.0.0', ['@playdeck/audit-fixture-publishable']],
      ['beta@2.0.0', ['@playdeck/audit-fixture-publishable']]
    ])
  );
});

test('a deduped node carrying no path is recorded and left undescended', () => {
  // `path` is on every node pnpm 11.20.0 emits. The fallback is for a pnpm that
  // stops emitting it, or for a deduped node naming a subtree that is not in
  // these trees at all: there is then nothing to join on and nothing to splice,
  // so the walk is left exactly where it was before this rather than throwing
  // or dropping the closure.
  assert.deepEqual(
    shippedVersions([
      {
        name: '@playdeck/audit-fixture-publishable',
        dependencies: {
          '@vimeo/player': {
            from: '@vimeo/player',
            version: '2.30.4',
            deduped: true,
            dedupedDependenciesCount: 2
          }
        }
      }
    ]),
    new Map([['@vimeo/player@2.30.4', ['@playdeck/audit-fixture-publishable']]])
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

// An `auditConfig` block is the other way a workspace setting voids the
// measurement, and it is the quieter of the two: a floor at least leaves the
// floored module in the tree for `flooredModules` to find, whereas pnpm applies
// `ignoreGhsas` and `ignoreCves` while building the report, so what this file
// receives is a tree with the advisory simply not in it. `development-only`
// passes today, which isolates the new failure from the advisory gate the same
// way the floor tests above do.
test('an auditConfig entry fails an otherwise clean gate', () => {
  const result = gate({
    ...developmentOnly,
    suppressions: [
      { key: 'auditConfig.ignoreGhsas', identifiers: ['GHSA-vh95-rmgr-6w4m'] }
    ]
  });
  assert.equal(result.exitCode, 1);
  // Not the advisory gate doing the failing, and not the floor gate either.
  assert.deepEqual(
    result.advisories.filter((advisory) => advisory.shipped),
    []
  );
  assert.ok(!result.report.includes('FLOORED'));
});

test('the report names the suppressed identifiers and why the count above them cannot be read', () => {
  const report = gate({
    ...developmentOnly,
    suppressions: [
      {
        key: 'auditConfig.ignoreCves',
        identifiers: ['CVE-2020-7598', 'CVE-2021-44906']
      }
    ]
  }).report;
  assert.match(report, /SUPPRESSED\s+auditConfig\.ignoreCves/);
  // The identifiers themselves, so a reader can look up what was hidden rather
  // than only learn that something was.
  assert.ok(report.includes('CVE-2020-7598, CVE-2021-44906'));
  assert.ok(report.includes('pnpm-workspace.yaml'));
  assert.equal(
    lastLine(report),
    "No advisory is reachable from a publishable package's dependencies. 1 auditConfig entry above suppresses advisories, so the count this report opens with is not the count pnpm found."
  );
});

test('a floor and a suppression are counted and worded separately', () => {
  // Both at once, because they are reported through the same list and the same
  // summary: one must not swallow the other's line or its sentence.
  const report = gate({
    ...developmentOnly,
    overrides: { 'ms@<2.1.3': '>=2.1.3' },
    suppressions: [
      { key: 'auditConfig.ignoreGhsas', identifiers: ['GHSA-a', 'GHSA-b'] },
      { key: 'auditConfig.ignoreCves', identifiers: ['CVE-1'] }
    ]
  }).report;
  assert.match(report, /FLOORED\s+ms@2\.1\.3/);
  assert.match(report, /SUPPRESSED\s+auditConfig\.ignoreGhsas/);
  assert.match(report, /SUPPRESSED\s+auditConfig\.ignoreCves/);
  assert.ok(
    lastLine(report).endsWith(
      '1 module(s) above are floored. A floor does not travel to a consumer, so what a consumer resolves was never measured. 2 auditConfig entries above suppress advisories, so the count this report opens with is not the count pnpm found.'
    )
  );
});

test('a workspace declaring no auditConfig leaves both variants as they are', () => {
  assert.deepEqual(shipped.suppressions, []);
  assert.deepEqual(developmentOnly.suppressions, []);
  for (const variant of [shipped, developmentOnly]) {
    assert.ok(!gate(variant).report.includes('SUPPRESSED'));
  }
  // Same reasoning as the floor case: absent means the summary is the advisory
  // sentence alone, not one that has gained a second counting zero.
  assert.match(
    lastLine(gate(developmentOnly).report),
    /^No advisory is reachable from a publishable package's dependencies\.$/
  );
});

test('the auditConfig block is read out of a workspace file, and its absence is empty', () => {
  assert.deepEqual(
    workspaceSuppressions(
      'packages:\n  - packages/*\nauditConfig:\n  ignoreGhsas:\n    - GHSA-vh95-rmgr-6w4m\n  ignoreCves:\n    - CVE-2020-7598\n'
    ),
    // Sorted by key, so the report does not reorder when the file does.
    [
      { key: 'auditConfig.ignoreCves', identifiers: ['CVE-2020-7598'] },
      { key: 'auditConfig.ignoreGhsas', identifiers: ['GHSA-vh95-rmgr-6w4m'] }
    ]
  );
  // Keyed on the block, not on the two names pnpm reads today: a key a later
  // pnpm adds has to fail closed rather than pass unnoticed.
  assert.deepEqual(
    workspaceSuppressions('auditConfig:\n  ignoreSomethingNew:\n    - X-1\n'),
    [{ key: 'auditConfig.ignoreSomethingNew', identifiers: ['X-1'] }]
  );
  // pnpm tests `ignoreGhsas` with `.includes`, which a bare string answers, so
  // one suppresses for real and has to count as an entry.
  assert.deepEqual(
    workspaceSuppressions('auditConfig:\n  ignoreGhsas: GHSA-only-one\n'),
    [{ key: 'auditConfig.ignoreGhsas', identifiers: ['GHSA-only-one'] }]
  );
  // Carrying nothing is not a suppression. An empty list hides no advisory, so
  // failing on one would be a false alarm -- and it is no foothold either,
  // since the change that adds the first identifier is the one that fails.
  assert.deepEqual(
    workspaceSuppressions('auditConfig:\n  ignoreCves: []\n'),
    []
  );
  assert.deepEqual(workspaceSuppressions('auditConfig: {}\n'), []);
  assert.deepEqual(workspaceSuppressions('auditConfig:\n  ignoreCves:\n'), []);
  // And the shapes the overrides read has to survive too: no block, an empty
  // file, and a file of comments, which parses to null rather than an object.
  assert.deepEqual(workspaceSuppressions('packages:\n  - packages/*\n'), []);
  assert.deepEqual(workspaceSuppressions(''), []);
  assert.deepEqual(workspaceSuppressions('# no settings yet\n'), []);
});

test("the repository's own workspace file declares no audit suppression", () => {
  // The counterpart to the overrides fact above, and the one that matters most
  // if it ever changes: this file legitimately carries a security block, so an
  // `auditConfig` added to it reads as routine triage rather than as a bypass.
  // The gate would fail on it -- this says the tree is clean today, so that
  // failure means something new rather than something already tolerated.
  assert.deepEqual(
    workspaceSuppressions(
      readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
    ),
    []
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

// The boundary this gate measures against is declared by the pull request it
// judges (#373), so it is compared against `main`'s. Both sides run through
// `selectPublishable`, so these listings are the two inputs that definition
// reads -- the entry's `private` field, and whether the entry is in the
// listing at all -- which are the two routes a pull request has to narrow the
// boundary without touching a single dependency.
const mainListing = [
  { name: 'playdeck', path: '/w', private: true },
  {
    name: '@playdeck/core',
    version: '0.1.0',
    path: '/w/packages/core',
    private: false
  },
  {
    name: '@playdeck/react',
    version: '0.1.0',
    path: '/w/packages/react',
    private: false
  }
];

test('a package the pull request marked private has left the boundary', () => {
  // The first route: one field, no change to any dependency. Every advisory
  // reachable only through @playdeck/core is reclassified from shipped to not
  // shipped, and before this the gate reported the narrower tree as clean.
  const marked = mainListing.map((entry) =>
    entry.name === '@playdeck/core' ? { ...entry, private: true } : entry
  );
  assert.deepEqual(
    departedPackages(selectPublishable(mainListing), selectPublishable(marked)),
    ['@playdeck/core']
  );
});

test('a package a removed workspace glob dropped from the listing has left the boundary', () => {
  // The second route, by a different door and to the same place: the manifest
  // is untouched and still says `private: false`, but `pnpm-workspace.yaml` no
  // longer matches its directory, so `pnpm list -r` never reports it and the
  // boundary loses it just the same.
  assert.deepEqual(
    departedPackages(
      selectPublishable(mainListing),
      selectPublishable(
        mainListing.filter((entry) => entry.name !== '@playdeck/react')
      )
    ),
    ['@playdeck/react']
  );
});

test('a new publishable package has not narrowed the boundary', () => {
  // Widening is the ordinary way a package is added and is not a departure:
  // nothing that was measured has stopped being measured.
  assert.deepEqual(
    departedPackages(selectPublishable(mainListing), [
      ...selectPublishable(mainListing),
      {
        name: '@playdeck/provider-hls',
        version: '0.1.0',
        path: '/w/packages/provider-hls',
        private: false
      }
    ]),
    []
  );
});

test('an unchanged boundary reports no departure', () => {
  assert.deepEqual(
    departedPackages(
      selectPublishable(mainListing),
      selectPublishable(mainListing)
    ),
    []
  );
  // And a package that was never on `main` cannot have departed from it: the
  // comparison runs in one direction only, so a name only `current` carries is
  // not a name `baseline` lost.
  assert.deepEqual(
    departedPackages(
      selectPublishable(
        mainListing.filter((entry) => entry.name !== '@playdeck/react')
      ),
      selectPublishable(mainListing)
    ),
    []
  );
});

test('a departed package fails an otherwise clean gate', () => {
  // `development-only` passes today, which isolates this failure from the
  // advisory gate the same way the floor and suppression tests above do.
  const result = gate({
    ...developmentOnly,
    baseline: [
      ...developmentOnly.publishable,
      {
        name: '@playdeck/audit-fixture-departed',
        version: '0.0.0',
        path: './packages/departed',
        private: false
      }
    ]
  });
  assert.equal(result.exitCode, 1);
  // Not the advisory gate, not the floor gate, and not the suppression gate.
  assert.deepEqual(
    result.advisories.filter((advisory) => advisory.shipped),
    []
  );
  assert.ok(!result.report.includes('FLOORED'));
  assert.ok(!result.report.includes('SUPPRESSED'));
});

test('the report names the packages that left the boundary and why that voids it', () => {
  const report = gate({
    ...developmentOnly,
    baseline: [
      ...developmentOnly.publishable,
      {
        name: '@playdeck/audit-fixture-departed',
        version: '0.0.0',
        path: './packages/departed',
        private: false
      },
      {
        name: '@playdeck/audit-fixture-unglobbed',
        version: '0.0.0',
        path: './packages/unglobbed',
        private: false
      }
    ]
  }).report;
  // Named, not counted: "the set shrank" leaves a reader to diff two manifests
  // to find out which package stopped being measured.
  assert.match(report, /DEPARTED\s+@playdeck\/audit-fixture-departed/);
  assert.match(report, /DEPARTED\s+@playdeck\/audit-fixture-unglobbed/);
  assert.equal(
    lastLine(report),
    "No advisory is reachable from a publishable package's dependencies. 2 package(s) above are publishable on main and are not publishable here, so this report measures a narrower boundary than the one consumers resolve."
  );
});

test('a widened boundary passes', () => {
  const result = gate({
    ...developmentOnly,
    baseline: developmentOnly.publishable,
    publishable: [
      ...developmentOnly.publishable,
      {
        name: '@playdeck/audit-fixture-new',
        version: '0.0.0',
        path: './packages/new',
        private: false
      }
    ]
  });
  assert.equal(result.exitCode, 0);
  assert.ok(!result.report.includes('DEPARTED'));
});

test('an unchanged boundary adds nothing to the report', () => {
  // The comparison runs here -- `baseline` is set -- and still prints nothing,
  // so a CI run against an unmoved boundary reads exactly as it did before
  // this existed. Byte-identical to the no-baseline report is the assertion
  // that catches a summary sentence counting zero departures.
  for (const variant of [shipped, developmentOnly]) {
    assert.equal(
      gate({ ...variant, baseline: variant.publishable }).report,
      gate(variant).report
    );
  }
  assert.equal(
    gate({ ...developmentOnly, baseline: developmentOnly.publishable })
      .exitCode,
    0
  );
});

test('no baseline runs no comparison', () => {
  // The local path: `pnpm test:audit` on a developer machine has no `main`
  // manifests to compare against, and must stay usable. Skipping is safe only
  // because CI never takes it -- when the environment variable is set, a
  // baseline that cannot be read is an error rather than an absent one. See
  // gather() in audit.mjs and publishableBaseline in workspace-packages.mjs.
  for (const variant of [shipped, developmentOnly]) {
    assert.equal(variant.baseline, null);
    assert.ok(!gate(variant).report.includes('DEPARTED'));
  }
  assert.match(
    lastLine(gate(developmentOnly).report),
    /^No advisory is reachable from a publishable package's dependencies\.$/
  );
});
