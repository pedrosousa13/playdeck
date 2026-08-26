// The shape of the ESM-only guard every publishable package carries, and the
// one place its two files are written down. Both gates that need it -- the
// unit test (scripts/esm-only-guard.test.mjs) and the packaging harness
// (scripts/verify-packaging.mjs, which reads it out of the packed tarball) --
// compare against these, so no publishable package's copy can drift from
// another's, and a package added later is held to the same shape.
//
// Why the guard exists at all. These packages are ESM only, deliberately, and
// an export map that answers `import` and nothing else does not say so to a
// CommonJS consumer's type-checker: it resolves the `types` condition, reports
// nothing, and Node then refuses the `require` with a message about a missing
// export -- a description of a missing file rather than of a decision.
//
// Why nothing in the toolchain already says it. A `require` of an ES module is
// not categorically wrong -- Node resolves one and evaluates it -- so there is
// no call for a type-checker to object to. What a `require` needs is something
// behind the `require` condition to resolve to, and an ESM-only map offers it
// nothing. So the constraint is stated where each toolchain will look: a
// `.d.cts` that is not a module for the type-checker, a module that throws on
// load for Node. Neither half is left asserted here -- the unit test
// type-checks a CommonJS consumer against the installed TypeScript and
// `require()`s every package on the running Node, so a toolchain that stopped
// behaving this way fails a test rather than rotting this paragraph.
//
// Why the nesting rather than a flat `require` alongside `types`. Conditions
// are matched in the order the map writes them, and a `types` key at the top
// of the `.` entry matches a CommonJS consumer before `require` ever does --
// which is the silent pass, restored. The types have to sit *inside* each
// condition for the two consumers to be told different things.

export const guardTypes = 'esm-only.d.cts';
export const guardRuntime = 'esm-only.cjs';

/** The `require` condition of the `.` entry, and nothing else about the map. */
export const guardCondition = Object.freeze({
  types: `./${guardTypes}`,
  default: `./${guardRuntime}`
});

export const guardTypesSource = `// This file is deliberately NOT a module: it declares nothing and exports
// nothing. It is where the \`require\` condition of this package's export map
// sends TypeScript, and a \`.d.cts\` that is not a module makes the consumer's
// own import statement fail to compile. That is the point -- being ESM only is
// a position, and a position a consumer discovers from their build is a
// supported boundary, while one they discover from a crash is a trap.
//
// It declares nothing on purpose. A declaration in a script file is a global,
// and a global declared by more than one installed package collides.
//
// esm-only.cjs is the runtime half of the same guard.
`;

/** @param {string} name */
export const guardRuntimeSource = (
  name
) => `// The runtime half of the ESM-only guard; esm-only.d.cts is the type-checker
// half. This is where the \`require\` condition of the export map resolves, so a
// CommonJS consumer who gets past their own build is refused by name instead of
// by Node's report of an export this package does not define.
//
// It throws on load and exports nothing, so nothing can select it as an
// implementation of this package in place of the real ESM entry.
throw new Error(
  '${name} is ESM only and cannot be loaded with require(). Import it from an ES module, or reach it with a dynamic import().'
);
`;

/**
 * The fields of a package.json this reads. A manifest npm will accept always
 * carries a name; every other field here is read as `unknown` and narrowed
 * below, because a manifest that has it wrong or missing is the case this
 * function exists to report on.
 * @typedef {{ name: string; exports?: Record<string, unknown>; files?: unknown; sideEffects?: unknown }} GuardManifest
 */

/**
 * @param {unknown} manifest a parsed package.json
 * @param {(entry: string) => string | undefined} read the package's own files
 * @returns {string[]}
 */
export const guardProblems = (manifest, read) => {
  const { name, exports, files, sideEffects } = /** @type {GuardManifest} */ (
    manifest
  );
  /** @type {string[]} */
  const problems = [];

  const entry = exports?.['.'];
  if (entry === null || typeof entry !== 'object') {
    problems.push('has no "." entry in its exports map');
  } else {
    // Narrowed by the branch above: an object, and the only thing read out of
    // it is a key the check below is about to reject if it is not there.
    const conditions = /** @type {Record<string, unknown>} */ (entry);
    // Order and nesting are the guard, not decoration -- see the header.
    const keys = Object.keys(conditions);
    if (keys.join() !== 'import,require') {
      problems.push(
        `exports "." carries the conditions ${JSON.stringify(keys)}, but the ESM-only guard needs exactly ["import","require"], each with its own nested "types"`
      );
    } else if (
      JSON.stringify(conditions.require) !== JSON.stringify(guardCondition)
    ) {
      problems.push(
        `exports "." has the require condition ${JSON.stringify(conditions.require)}, not ${JSON.stringify(guardCondition)}`
      );
    }
  }

  // `"sideEffects": false` is a promise a bundler is entitled to act on: it
  // says every module here can be dropped when nothing imports a binding from
  // it, and the runtime guard exports nothing at all. A bundler that selected
  // the `require` condition could therefore prune the `throw` and hand the
  // consumer an empty namespace -- worse than the resolution failure this
  // replaced, because nothing would fail anywhere. Naming the guard is the one
  // exception; `dist` stays shakeable, which tests/bundle/native-only proves.
  if (
    sideEffects !== undefined &&
    !(Array.isArray(sideEffects) && sideEffects.includes(`./${guardRuntime}`))
  ) {
    problems.push(
      `declares "sideEffects": ${JSON.stringify(sideEffects)}, which lets a bundler prune ./${guardRuntime}; it has to list ./${guardRuntime}`
    );
  }

  for (const [file, expected] of [
    [guardTypes, guardTypesSource],
    [guardRuntime, guardRuntimeSource(name)]
  ]) {
    if (!Array.isArray(files) || !files.includes(file)) {
      problems.push(`does not ship ${file}: it is not in "files"`);
    }
    const source = read(file);
    if (source === undefined) {
      problems.push(`is missing ${file}`);
    } else if (source !== expected) {
      problems.push(
        `${file} is not the guard scripts/esm-only-guard.mjs defines`
      );
    }
  }

  return problems;
};
